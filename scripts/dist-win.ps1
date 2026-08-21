#Requires -Version 5.1
<#
DSH Buddy - Windows 打包入口主体（scripts\dist-win.bat 只是双击引导壳）。

职责（原 dist-win.bat 的全部逻辑迁移至此，bat 仅负责拉起 PowerShell）：
 1. 清掉 Electron 宿主 IDE（Qoder/VSCode...）注入终端的 ELECTRON_* 变量——
    它们会泄漏进构建链拉起的每个 electron.exe，把 GUI 进程变成纯 Node 进程
    （静默秒退无窗口），极难排查；CI 环境干净不受影响。
 2. 输出目录锁预检：dist\win-unpacked 被 IDE 索引或残留应用进程占住时，
    electron-builder 会在最后阶段报 "EBUSY: unlink app.asar"。开跑前用
    rename 探针彩排一次（IDE 文件映射允许读写但拒绝改名/删除，与 unlink
    需要的访问权一致），失败即时报出，不浪费一轮完整构建。
 3. 单行进度条：把 `npm run dist:win` 输出重定向到日志文件并 tail，按下方
    $Stages 表匹配已知输出行推进百分比，单行 \r 重绘（百分比 + 中文说明 +
    已用时间 + 转轮）；非交互终端退化为逐阶段单行日志。实现方式移植自
    ZBuddy 的 unsigned-test-progress.ps1（含 CJK 双宽字符截断）。
 4. 收尾：成功时提示按任意键，关窗前用 explorer 选中安装包；失败时回显
    日志尾部并停住等按键（双击运行的窗口否则直接关闭，看不到失败原因）。

阶段匹配是对构建链既有输出行的只读消费：patch-*.js / build-web-profile.js
的行文案为本仓所有，pnpm 行取自真实构建日志，electron-builder 行已核对
app-builder-lib 26.x 源码（platformPackager.js "packaging"、packager.js
"electron-builder"、differentialUpdateInfoBuilder.js "building block map"）。
行文案变化时进度条最多停在上一阶段不再前进（转轮与计时仍在走，成功/失败
判定只看子进程退出码），不会误报。改上述脚本输出文案时请顺带核对本表。
#>
[CmdletBinding()]
param(
    # 测试接缝：可用回放脚本替换真实构建链（回归验证用）；日常构建勿传。
    [string]$BuildCommand = 'npm run dist:win',
    # 自动化场景跳过按键等待与资源管理器打开（非交互终端会自动跳过）。
    [switch]$NoPause
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$script:RepoRoot = Split-Path -Parent $PSScriptRoot
$script:LastFrameWidth = 0
$script:LastLoggedStage = ''

# 阶段表：pattern 逐行匹配构建日志，percent 只单调推进（早期阶段的行重复
# 出现——如第二次 pnpm install 的 "Done in"——不会把进度拉回去）。
$script:Stages = @(
    @{ name = 'start';          percent = 0;   pattern = $null;                           message = '正在启动打包链' }
    @{ name = 'patch-picker';   percent = 2;   pattern = '\[patch-dsh-picker\] check';    message = '已校验 dsh picker 补丁' }
    @{ name = 'patch-mm-ui';    percent = 4;   pattern = '\[patch-multimodal-ui\] check'; message = '已校验多模态 UI 补丁' }
    @{ name = 'profile-init';   percent = 6;   pattern = 'dsh: initialized profile';      message = '已初始化随包插件 profile' }
    @{ name = 'plugin-install'; percent = 12;  pattern = 'Progress: resolved';            message = '正在安装预装插件' }
    @{ name = 'plugin-done';    percent = 30;  pattern = '^Done in .+ using pnpm';        message = '插件安装完成，准备补齐跨平台分包' }
    @{ name = 'cross-platform'; percent = 38;  pattern = 'Lockfile is up to date';        message = '正在补齐跨平台分包并打包 profile（可能数分钟无新日志）' }
    @{ name = 'profile-tar';    percent = 52;  pattern = '\[build-web-profile\] wrote';   message = 'web profile 产物已生成' }
    @{ name = 'builder-start';  percent = 58;  pattern = 'electron-builder\s+version=';   message = 'electron-builder 已启动' }
    @{ name = 'packaging';      percent = 66;  pattern = 'packaging\s+platform=';         message = '正在打包应用目录 win-unpacked' }
    @{ name = 'nsis';           percent = 82;  pattern = 'building\s+target=nsis';        message = '正在压缩生成 NSIS 安装包（可能数分钟无新日志）' }
    @{ name = 'blockmap';       percent = 95;  pattern = 'building block map';            message = '正在生成差量更新 blockmap' }
    @{ name = 'complete';       percent = 100; pattern = $null;                           message = '安装包已生成' }
)

function Get-StageByName {
    param([Parameter(Mandatory = $true)][string]$Name)

    foreach ($stage in $script:Stages) {
        if ($stage.name -eq $Name) { return $stage }
    }
    throw "Unknown dist-win progress stage: $Name"
}

function Resolve-StageFromLine {
    param([AllowEmptyString()][string]$Line)

    foreach ($stage in $script:Stages) {
        if ($null -ne $stage.pattern -and $Line -match $stage.pattern) { return $stage }
    }
    return $null
}

# CJK 等宽字符在控制台占两列；按显示宽度计数/截断，避免 \r 重绘时残影或折行。
function Get-ConsoleTextWidth {
    param([AllowEmptyString()][string]$Text)

    $width = 0
    foreach ($character in $Text.ToCharArray()) {
        $codePoint = [int]$character
        if (($codePoint -ge 0x1100 -and $codePoint -le 0x115F) -or
            ($codePoint -ge 0x2E80 -and $codePoint -le 0xA4CF) -or
            ($codePoint -ge 0xAC00 -and $codePoint -le 0xD7A3) -or
            ($codePoint -ge 0xF900 -and $codePoint -le 0xFAFF) -or
            ($codePoint -ge 0xFE10 -and $codePoint -le 0xFE6F) -or
            ($codePoint -ge 0xFF00 -and $codePoint -le 0xFF60)) { $width += 2 } else { $width++ }
    }
    return $width
}

function Limit-ConsoleText {
    param(
        [AllowEmptyString()][string]$Text,
        [Parameter(Mandatory = $true)][int]$MaximumWidth
    )

    if ($MaximumWidth -le 0) { return '' }
    $builder = New-Object Text.StringBuilder
    $width = 0
    foreach ($character in $Text.ToCharArray()) {
        $characterWidth = Get-ConsoleTextWidth -Text ([string]$character)
        if ($width + $characterWidth -gt $MaximumWidth) { break }
        $null = $builder.Append($character)
        $width += $characterWidth
    }
    return $builder.ToString()
}

function Format-ProgressFrame {
    param(
        [Parameter(Mandatory = $true)]$Stage,
        [Parameter(Mandatory = $true)][datetime]$StartedAt,
        [Parameter(Mandatory = $true)][int]$ConsoleWidth,
        [int]$SpinnerIndex = 0
    )

    $usableWidth = [math]::Max(20, $ConsoleWidth - 1)
    $barWidth = [math]::Max(8, [math]::Min(24, $usableWidth - 48))
    $filled = [math]::Floor($barWidth * [int]$Stage.percent / 100)
    $bar = ('=' * $filled) + ('-' * ($barWidth - $filled))
    $elapsed = (Get-Date) - $StartedAt
    $spinner = @('|', '/', '-', '\')[$SpinnerIndex % 4]
    $text = "[{0}] {1,3}% {2}  已用 {3:00}:{4:00} {5}" -f $bar, [int]$Stage.percent, [string]$Stage.message, [math]::Floor($elapsed.TotalMinutes), $elapsed.Seconds, $spinner
    return Limit-ConsoleText -Text $text -MaximumWidth $usableWidth
}

function Test-InteractiveConsole {
    try {
        return (-not [Console]::IsOutputRedirected -and [Console]::BufferWidth -gt 0)
    } catch {
        return $false
    }
}

function Write-StageDisplay {
    param(
        [Parameter(Mandatory = $true)]$Stage,
        [Parameter(Mandatory = $true)][datetime]$StartedAt,
        [int]$SpinnerIndex = 0,
        [switch]$CompleteLine
    )

    if (-not (Test-InteractiveConsole)) {
        if ([string]$Stage.name -ne $script:LastLoggedStage) {
            Write-Host ("[{0,3}%] {1}" -f [int]$Stage.percent, [string]$Stage.message) -ForegroundColor Cyan
            $script:LastLoggedStage = [string]$Stage.name
        }
        return
    }

    $text = Format-ProgressFrame -Stage $Stage -StartedAt $StartedAt -ConsoleWidth ([Console]::BufferWidth) -SpinnerIndex $SpinnerIndex
    $textWidth = Get-ConsoleTextWidth -Text $text
    $clearWidth = [math]::Max($script:LastFrameWidth, $textWidth)
    $oldColor = [Console]::ForegroundColor
    try {
        [Console]::ForegroundColor = [ConsoleColor]::Cyan
        [Console]::Write("`r" + (' ' * $clearWidth) + "`r" + $text)
        if ($CompleteLine) { [Console]::WriteLine() }
    } finally {
        [Console]::ForegroundColor = $oldColor
    }
    if ($CompleteLine) { $script:LastFrameWidth = 0 } else { $script:LastFrameWidth = $textWidth }
}

function Test-DistOutputUnlocked {
    $asar = Join-Path $script:RepoRoot 'dist\win-unpacked\resources\app.asar'
    if (-not (Test-Path -LiteralPath $asar -PathType Leaf)) { return $true }
    $probe = "$asar.lockprobe"
    try {
        [IO.File]::Move($asar, $probe)
        [IO.File]::Move($probe, $asar)
        return $true
    } catch {
        return $false
    }
}

function Invoke-BuildWithProgress {
    param(
        [Parameter(Mandatory = $true)][string]$CommandLine,
        [Parameter(Mandatory = $true)][string]$LogPath,
        [Parameter(Mandatory = $true)][datetime]$StartedAt
    )

    $startInfo = New-Object Diagnostics.ProcessStartInfo
    $startInfo.FileName = Join-Path $env:SystemRoot 'System32\cmd.exe'
    $startInfo.Arguments = '/d /c ' + $CommandLine + ' 1>"' + $LogPath + '" 2>&1'
    $startInfo.UseShellExecute = $false
    $startInfo.WorkingDirectory = $script:RepoRoot
    $process = [Diagnostics.Process]::Start($startInfo)

    # cmd 的重定向会立即建出日志文件；给 10 秒兜底，超时仍无文件则退化为
    # 纯等待（不因进度条这种装饰功能杀掉真实构建）。
    $deadline = (Get-Date).AddSeconds(10)
    while (-not (Test-Path -LiteralPath $LogPath -PathType Leaf)) {
        if ($process.HasExited -or (Get-Date) -ge $deadline) { break }
        Start-Sleep -Milliseconds 50
        $process.Refresh()
    }
    if (-not (Test-Path -LiteralPath $LogPath -PathType Leaf)) {
        Write-Host '[dist-win] 未捕获到构建日志，进度显示不可用，等待构建结束...' -ForegroundColor Yellow
        $process.WaitForExit()
        return $process.ExitCode
    }

    $current = Get-StageByName -Name 'start'
    $spinnerIndex = 0
    $stream = [IO.File]::Open($LogPath, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
    $reader = New-Object IO.StreamReader($stream, [Text.Encoding]::UTF8, $true)
    try {
        while (-not $process.HasExited -or -not $reader.EndOfStream) {
            while (-not $reader.EndOfStream) {
                $candidate = Resolve-StageFromLine -Line $reader.ReadLine()
                if ($null -ne $candidate -and [int]$candidate.percent -ge [int]$current.percent) { $current = $candidate }
            }
            Write-StageDisplay -Stage $current -StartedAt $StartedAt -SpinnerIndex $spinnerIndex
            $spinnerIndex++
            if (-not $process.HasExited) { Start-Sleep -Milliseconds 250; $process.Refresh() }
        }
    } finally {
        $reader.Dispose()
        $stream.Dispose()
    }
    $process.WaitForExit()
    return $process.ExitCode
}

function Get-NewestInstaller {
    $distDir = Join-Path $script:RepoRoot 'dist'
    if (-not (Test-Path -LiteralPath $distDir -PathType Container)) { return $null }
    $installer = Get-ChildItem -LiteralPath $distDir -Filter '*.exe' -File |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($null -eq $installer) { return $null }
    return $installer.FullName
}

function Show-Completion {
    param(
        [Parameter(Mandatory = $true)][int]$ExitCode,
        [Parameter(Mandatory = $true)][string]$LogPath,
        [switch]$AllowPause
    )

    $installer = $null
    if ($ExitCode -eq 0) { $installer = Get-NewestInstaller }
    Write-Host ''
    Write-Host '========== DSH Buddy Windows 打包 =========='
    if ($ExitCode -eq 0) {
        Write-Host '结果: 成功' -ForegroundColor Green
        if ($null -ne $installer) { Write-Host "产物: $installer" }
    } else {
        Write-Host "结果: 失败（退出码 $ExitCode）" -ForegroundColor Red
        if (Test-Path -LiteralPath $LogPath -PathType Leaf) {
            Write-Host '最近日志（完整日志见下方路径）:'
            Get-Content -LiteralPath $LogPath -Encoding UTF8 -Tail 15 | ForEach-Object { Write-Host "  $_" }
        }
    }
    Write-Host "日志: $LogPath"
    Write-Host '============================================'
    if (-not $AllowPause) { return }
    # 失败时也停住等按键：双击运行的窗口否则直接关闭，用户看不到失败原因。
    if ($ExitCode -eq 0) {
        Write-Host '按任意键关闭此窗口并打开安装包所在文件夹...'
    } else {
        Write-Host '打包未完成；按任意键关闭此窗口...'
    }
    try { $null = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown') } catch { cmd.exe /d /c pause | Out-Null }
    if ($ExitCode -eq 0) {
        if ($null -ne $installer) {
            Start-Process -FilePath explorer.exe -ArgumentList "/select,`"$installer`""
        } else {
            Start-Process -FilePath explorer.exe -ArgumentList "`"$(Join-Path $script:RepoRoot 'dist')`""
        }
    }
}

# ---- 主流程 ----

foreach ($name in 'ELECTRON_RUN_AS_NODE', 'ELECTRON_NO_ATTACH_CONSOLE', 'ELECTRON_ENABLE_LOGGING', 'ELECTRON_FORCE_IS_PACKAGED') {
    [Environment]::SetEnvironmentVariable($name, $null)
}

if (-not (Test-DistOutputUnlocked)) {
    Write-Host '[dist-win] dist\win-unpacked 被其他进程占用（通常是 IDE 索引或残留的应用进程）。' -ForegroundColor Red
    Write-Host '[dist-win] 关闭占用进程后重试，或改用其他输出目录: npx electron-builder --win --publish never -c.directories.output=dist-release'
    exit 1
}

$logDir = Join-Path $script:RepoRoot 'build\logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logPath = Join-Path $logDir ('dist-win-{0:yyyyMMdd-HHmmss}.log' -f (Get-Date))
$startedAt = Get-Date
$allowPause = (Test-InteractiveConsole) -and -not $NoPause

Write-Host "[dist-win] 构建命令: $BuildCommand"
Write-Host "[dist-win] 完整日志: $logPath"
$exitCode = Invoke-BuildWithProgress -CommandLine $BuildCommand -LogPath $logPath -StartedAt $startedAt
if ($exitCode -eq 0) {
    Write-StageDisplay -Stage (Get-StageByName -Name 'complete') -StartedAt $startedAt -CompleteLine
} elseif (Test-InteractiveConsole) {
    Write-Host ''
}
Show-Completion -ExitCode $exitCode -LogPath $logPath -AllowPause:$allowPause
exit $exitCode
