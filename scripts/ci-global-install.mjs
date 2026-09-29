#!/usr/bin/env node
/**
 * AC-8 后半：证明 `npm install -g` 这条路径**不需要编译工具链**。
 *
 * 真实打包产物 + 隔离 prefix（不污染 runner 的全局环境），装完从空目录跑一次
 * 入口。"无 node-gyp 记录"是 D38 去掉 better-sqlite3、改用内置 node:sqlite 的
 * 主要收益 —— 这条用例就是那笔收益的看门人。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * 调 npm 的两种形态：
 *   - 由 npm 生命周期唤起时（npm_execpath 存在）→ 直接用 node 跑 npm-cli.js，
 *     不需要 shell；
 *   - 否则 Windows 上只能落到 npm.cmd，而 Node 对 .cmd 强制要求 shell（CVE-2024-27980
 *     之后直接 spawn 会 EINVAL）。走 shell 就必须自己加引号：参数里是临时目录路径，
 *     可能含空格，shell 不做转义会拆错。
 */
const npmCli = process.env.npm_execpath;
const useShell = !npmCli && process.platform === 'win32';
const NPM = npmCli ? [process.execPath, npmCli] : [process.platform === 'win32' ? 'npm.cmd' : 'npm'];
const quote = (arg) => (useShell ? `"${String(arg).replaceAll('"', '')}"` : String(arg));

function npm(args, opts = {}) {
  const [cmd, ...pre] = NPM;
  return spawnSync(cmd, [...pre, ...args.map(quote)], {
    encoding: 'utf8',
    shell: useShell,
    ...opts,
  });
}

const work = mkdtempSync(join(tmpdir(), 'wl-gi-'));
let tarball = null;
let failed = false;
try {
  const packed = npm(['pack', '--silent'], { cwd: ROOT });
  if (packed.status !== 0) throw new Error(`npm pack 失败：${packed.stderr}`);
  const tarballName = packed.stdout.trim().split('\n').at(-1);
  if (!tarballName?.endsWith('.tgz')) throw new Error(`npm pack 未返回 tarball 名：${packed.stdout}`);
  tarball = join(ROOT, tarballName);
  console.log(`产物: ${tarballName}`);

  const prefix = join(work, 'prefix');
  const install = npm(['install', '-g', '--prefix', prefix, '--no-audit', '--no-fund', tarball], {
    cwd: work,
  });
  const output = `${install.stdout ?? ''}${install.stderr ?? ''}`;
  if (install.status !== 0) {
    console.error(`全局安装失败：\n${output}`);
    process.exit(1);
  }

  const GYP = /node-gyp|gyp ERR|prebuild-install|node-pre-gyp|gypinfo/i;
  const hits = output.split('\n').filter((line) => GYP.test(line));
  if (hits.length > 0) {
    console.error(`出现编译工具链调用（不该有）：\n${hits.join('\n')}`);
    failed = true;
  } else {
    console.log('OK 安装输出中无 node-gyp / prebuild 痕迹');
  }

  // 全局包根目录各平台不同：POSIX 是 <prefix>/lib/node_modules，Windows 是
  // <prefix>/node_modules。硬编码过一次，mac/linux 就死在"路径不存在"上，
  // 而且那行消息不在筛选关键词里，日志里看不见 —— 改为直接问 npm。
  const root = npm(['root', '-g', '--prefix', prefix], { cwd: work });
  const rootDir = root.stdout?.trim().split('\n').at(-1);
  if (root.status !== 0 || !rootDir) {
    console.error(`失败：npm root -g 没给出路径（status ${root.status}）\n${root.stdout}${root.stderr}`);
    process.exit(1);
  }
  const entry = join(rootDir, '@phinnpeng', 'workreport', 'dist', 'index.js');
  if (!existsSync(entry)) {
    console.error(`失败：产物未落到预期位置 ${entry}`);
    process.exit(1);
  }

  // 全局 bin 的位置与 `npm root -g` 不同源：POSIX 上包在 <prefix>/lib/node_modules，
  // 而命令入口在 <prefix>/bin —— 上一版从 rootDir 反推 '..'/bin，得到
  // <prefix>/lib/bin，mac/linux 都报"入口缺失"。Windows 则是 <prefix>/workreport.cmd。
  const binName = process.platform === 'win32' ? 'workreport.cmd' : 'workreport';
  const binPath =
    process.platform === 'win32' ? join(prefix, binName) : join(prefix, 'bin', binName);
  console.log(`${existsSync(binPath) ? 'OK' : '失败：缺失'} 全局命令入口: ${binPath}`);
  if (!existsSync(binPath)) failed = true;

  // 从一个空目录跑真实入口：既验证产物可执行，也验证"零运行目录污染"
  const emptyCwd = join(work, 'empty');
  mkdirSync(emptyCwd, { recursive: true });
  const describe = spawnSync(process.execPath, [entry, 'describe'], {
    cwd: emptyCwd,
    encoding: 'utf8',
  });
  if (describe.status !== 0) {
    console.error(`describe 退出码 ${describe.status}：${describe.stderr}`);
    process.exit(1);
  }
  const parsed = JSON.parse(describe.stdout);
  const lines = describe.stdout.trimEnd().split('\n');
  console.log(`OK describe：${lines.length} 行、可 parse、命令数 ${parsed.commands.length}`);
  if (lines.length !== 1) {
    console.error('describe 的 stdout 必须是单行');
    failed = true;
  }
  const leftovers = readdirSync(emptyCwd);
  if (leftovers.length > 0) {
    console.error(`运行目录被污染：${leftovers.join(', ')}`);
    failed = true;
  } else {
    console.log('OK 零运行目录污染');
  }
} finally {
  rmSync(work, { recursive: true, force: true });
  if (tarball) rmSync(tarball, { force: true });
}

process.exitCode = failed ? 1 : 0;
