#!/usr/bin/env node
// 发版说明生成器:CHANGELOG.md 是唯一真源,本脚本把指定版本的段落提取为
// GitHub Release body(顶部加下载指引,尾部保留 Full Changelog 比对链接)。
// 正式版缺少对应 changelog 条目直接非零退出——把 changelog 纪律前移为发版门禁;
// 预发布 tag(版本带 - 后缀,流水线试跑用)允许缺条目,输出占位说明。
//
// 用法: node scripts/release-notes.js <version>   (如 0.4.3,不带 v 前缀)
// 输出到 stdout,由调用方重定向成 --notes-file 的输入。
const fs = require('fs');
const path = require('path');

const REPO_SLUG = 'HackSing/dsh-buddy';
const CHANGELOG = path.join(__dirname, '..', 'CHANGELOG.md');

const DOWNLOAD_GUIDE = [
  '> **下载指引**:macOS(Apple Silicon)下载 `.dmg`;Windows 下载 `Setup-*.exe`。',
  '> 其余文件(`.zip`/`.blockmap`/`latest*.yml`)是应用内自动更新机制的元数据与差量包,无需手动下载。',
].join('\n');

function extractSection(changelog, version) {
  // 段落从 "## [<version>]" 起,到下一个 "## [" 止;返回 { body, prevVersion }
  const lines = changelog.split('\n');
  const headRe = /^## \[([^\]]+)\]/;
  const start = lines.findIndex((l) => {
    const m = headRe.exec(l);
    return m && m[1] === version;
  });
  if (start === -1) return null;
  let end = lines.length;
  let prevVersion = null;
  for (let i = start + 1; i < lines.length; i += 1) {
    const m = headRe.exec(lines[i]);
    if (m) {
      end = i;
      prevVersion = m[1] === 'Unreleased' ? null : m[1];
      break;
    }
  }
  return { body: lines.slice(start + 1, end).join('\n').trim(), prevVersion };
}

function main() {
  const version = process.argv[2];
  if (!version) {
    console.error('usage: node scripts/release-notes.js <version>');
    process.exit(1);
  }
  const section = extractSection(fs.readFileSync(CHANGELOG, 'utf8'), version);
  if (!section || !section.body) {
    if (version.includes('-')) {
      // 预发布试跑:不占 /releases/latest,允许无正式条目
      console.log(`${DOWNLOAD_GUIDE}\n\n流水线预发布试跑版本,无正式更新说明。`);
      return;
    }
    console.error(
      `[release-notes] CHANGELOG.md 缺少 "## [${version}]" 段落——正式发版前必须补齐更新说明(changelog 纪律即发版门禁)。`
    );
    process.exit(1);
  }
  const compare = section.prevVersion
    ? `\n\n**Full Changelog**: https://github.com/${REPO_SLUG}/compare/v${section.prevVersion}...v${version}`
    : '';
  console.log(`${DOWNLOAD_GUIDE}\n\n${section.body}${compare}`);
}

main();
