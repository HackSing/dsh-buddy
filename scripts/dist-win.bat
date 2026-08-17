@echo off
rem ============================================================
rem DSH Buddy - Windows packaging entry (use this for local builds,
rem do NOT run "npm run dist:win" directly from an IDE terminal).
rem
rem Why: Electron-based IDEs (Qoder, VSCode, ...) inject
rem ELECTRON_RUN_AS_NODE=1 etc. into their integrated terminals.
rem These leak into every electron.exe spawned by the build chain
rem and into any manual run of the packaged app, turning the GUI
rem process into a plain Node process (silent instant exit, no
rem window) -- very hard to diagnose. CI is clean and unaffected.
rem
rem Second known blocker: dist\win-unpacked locked by IDE indexing
rem or a leftover app process makes electron-builder fail late with
rem "EBUSY: unlink app.asar". We probe for that up front instead.
rem (Comments stay ASCII: cmd parses .bat as OEM/GBK, UTF-8 CJK
rem comments corrupt parsing.)
rem ============================================================
setlocal

rem Strip Electron-host-injected variables (empty assignment deletes
rem the variable for child processes).
set "ELECTRON_RUN_AS_NODE="
set "ELECTRON_NO_ATTACH_CONSOLE="
set "ELECTRON_ENABLE_LOGGING="
set "ELECTRON_FORCE_IS_PACKAGED="

rem Preflight: rename-probe the previous unpack output. IDE file
rem mappings allow read/write open but deny delete/rename -- exactly
rem the access electron-builder's unlink needs, so this is a faithful
rem rehearsal.
if exist "dist\win-unpacked\resources\app.asar" (
  node -e "const fs=require('fs');const p='dist/win-unpacked/resources/app.asar';const t=p+'.lockprobe';try{fs.renameSync(p,t);fs.renameSync(t,p);}catch(e){console.error('[dist-win] dist\\win-unpacked is locked by another process (usually IDE indexing or a leftover app process).');console.error('[dist-win] Close the locking process and retry, or pick another output dir: npx electron-builder --win --publish never -c.directories.output=dist-release');process.exit(1);}" || exit /b 1
)

call npm run dist:win
exit /b %errorlevel%
