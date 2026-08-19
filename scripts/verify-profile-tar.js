#!/usr/bin/env node
// 随包 profile tar 的产物断言:CI(ubuntu)与开发机(win32/darwin)共用同一份规则。
// 直接读 tar 条目判定,不解包——比"解包后 find"快,且不依赖 GNU find/realpath,
// Windows 本机也能在改断言前后自测。
//
// 四条断言:
//  1. 无绝对 linkname(构建机绝对路径会在用户机上指向不存在的位置)
//  2. 链接解析后仍在 profile 根内(防逃逸到构建机 pnpm store)
//  3. 平台二进制只允许来自 NATIVE_PACKAGES 声明的包,且各自覆盖 REQUIRED_PLATFORMS
//  4. profile 根目录存在
//
// 断言 3 的历史:原规则是"零平台二进制",预装 dsh-better-sidebar 后其传递依赖
// node-pty 带来跨平台 prebuilds,零二进制不再成立。放行的判据不是"有二进制就行",
// 而是"二进制只能来自登记在册的原生包,且每个包都同时覆盖两个发布目标"——发布目标是
// macOS 与 Windows,少任一平台说明产物只对单平台可用,与随包 profile 跨平台分发的
// 前提冲突,仍判 FAIL。@linxin666 六件套升到 0.2.x 后 skin-center 引入 lightningcss,
// 该包按平台拆分发,是这条断言第二次被真实产物触发(构建机之外的平台会 require 失败)。
//
// 用法: node scripts/verify-profile-tar.js [tar路径]  (默认 build/web-profile.tar.gz)
const path = require('path');
const tar = require('tar');

const REPO_ROOT = path.join(__dirname, '..');
const DEFAULT_TAR = path.join(REPO_ROOT, 'build', 'web-profile.tar.gz');
const PROFILE_NAME = require(path.join(REPO_ROOT, 'plugins', 'preinstall-manifest.json')).profile;

const BINARY_EXT = /\.(node|dll|exe|dylib|so)$/;
// 发布目标:macOS(arm64 dmg)与 Windows(x64 nsis);每个原生包都要同时覆盖两者才算跨平台可用
const REQUIRED_PLATFORMS = ['darwin-arm64', 'win32-x64'];

// 放行的原生包。两个包的跨平台布局不同,规则不能共用:
//  - node-pty 把各平台产物打在同一个包里(prebuilds/<plat>/ 的 pty.node、winpty,
//    以及 third_party/conpty/ 的 conpty.dll、OpenConsole.exe),装上就自带全平台;
//  - lightningcss(@linxin666/dsh-client-ui-skin-center 0.2.x 的运行时依赖)按平台拆成
//    optionalDependencies 分包,pnpm 默认只装构建机那一份,靠 profile package.json 的
//    pnpm.supportedArchitectures 强制装齐(见 scripts/build-web-profile.js)。
// requiredWhen 用"消费方是否在产物里"而不是"有没有二进制"做触发条件:平台分包全缺时
// 二进制数为 0,以二进制为触发条件会静默放过"只剩核心包、任何平台都跑不起来"的产物。
const NATIVE_PACKAGES = [
  {
    name: 'node-pty',
    requiredWhen: 'node_modules/node-pty/',
    prefix: 'node_modules/node-pty/',
    platformDirs: {
      'darwin-arm64': 'node_modules/node-pty/prebuilds/darwin-arm64/',
      'win32-x64': 'node_modules/node-pty/prebuilds/win32-x64/',
    },
  },
  {
    name: 'lightningcss',
    requiredWhen: 'node_modules/lightningcss/',
    prefix: 'node_modules/lightningcss-',
    platformDirs: {
      'darwin-arm64': 'node_modules/lightningcss-darwin-arm64/',
      'win32-x64': 'node_modules/lightningcss-win32-x64-msvc/',
    },
  },
];

function readEntries(tarPath) {
  const entries = [];
  tar.t({
    file: tarPath,
    sync: true,
    onentry: (e) => entries.push({ path: e.path, type: e.type, linkpath: e.linkpath || '' }),
  });
  return entries;
}

function isAbsolute(linkpath) {
  return linkpath.startsWith('/') || /^[a-zA-Z]:[\/]/.test(linkpath);
}

// tar 内路径一律 POSIX 风格;用 posix.resolve 判定链接目标是否仍在根内
function resolvesInsideRoot(entryPath, linkpath) {
  const target = path.posix.resolve(path.posix.dirname('/' + entryPath), linkpath);
  return target === '/' + PROFILE_NAME || target.startsWith('/' + PROFILE_NAME + '/');
}

function checkLinks(entries, fail) {
  const links = entries.filter((e) => e.type === 'SymbolicLink' || e.type === 'Link');
  for (const l of links) {
    if (isAbsolute(l.linkpath)) fail(`绝对 linkname: ${l.path} -> ${l.linkpath}`);
    else if (!resolvesInsideRoot(l.path, l.linkpath)) fail(`链接逃逸: ${l.path} -> ${l.linkpath}`);
  }
  return links.length;
}

/** profile 根下的绝对 tar 路径;tar 内路径一律以 profile 名开头。 */
function inProfile(relative) {
  return `${PROFILE_NAME}/${relative}`;
}

function checkBinaries(entries, fail) {
  const bins = entries.filter((e) => BINARY_EXT.test(e.path));

  for (const e of bins) {
    const owner = NATIVE_PACKAGES.some((p) => e.path.startsWith(inProfile(p.prefix)));
    if (!owner) fail(`白名单外的平台二进制: ${e.path}`);
  }

  for (const p of NATIVE_PACKAGES) {
    if (!entries.some((e) => e.path.startsWith(inProfile(p.requiredWhen)))) continue;
    for (const plat of REQUIRED_PLATFORMS) {
      const dir = p.platformDirs[plat];
      if (!dir) {
        fail(`${p.name} 未声明发布目标平台 ${plat} 的目录`);
      } else if (!bins.some((e) => e.path.startsWith(inProfile(dir)))) {
        fail(`${p.name} 缺少发布目标平台: ${plat}`);
      }
    }
  }
  return bins.length;
}

function main() {
  const tarPath = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_TAR;
  const failures = [];
  const fail = (msg) => failures.push(msg);

  const entries = readEntries(tarPath);
  const linkCount = checkLinks(entries, fail);
  const binCount = checkBinaries(entries, fail);
  if (!entries.some((e) => e.path === `${PROFILE_NAME}/`)) fail(`profile 根缺失: ${PROFILE_NAME}/`);

  if (failures.length > 0) {
    for (const f of failures) console.error(`FAIL: ${f}`);
    console.error(`PROFILE ASSERT FAIL: ${failures.length} 条`);
    process.exit(1);
  }
  console.log(
    `PROFILE ASSERT PASS: entries=${entries.length} links=${linkCount} binaries=${binCount} (${tarPath})`
  );
}

main();
