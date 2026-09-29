#!/usr/bin/env node
/**
 * AC-8 前半：在真实 runner 上打印 `env-paths` 的实际落点，断言与 PRD 第 8 节
 * 的表相符，并把结果写进 job summary 供回填文档。
 *
 * 约定（PRD 5.3.2、S7）：**不符时改 PRD 第 8 节并同步 D27，不许改这里的断言**。
 * 尤其 macOS 的 `config` 究竟落 `Preferences` 还是 `Application Support` 是
 * O13 里明确存疑的一项 —— 这条用例就是为了让它现形。
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'index.js');

const report = JSON.parse(execFileSync(process.execPath, [BIN, 'doctor'], { encoding: 'utf8' }));

const platform = process.platform;
const home = process.env.HOME ?? process.env.USERPROFILE;
if (!home) throw new Error('runner 上找不到主目录环境变量');

/**
 * PRD 第 8 节的期望值。**按平台惰性求值** —— 上一版写成三行的对象字面量，
 * 于是 Linux 上也会去读 `process.env.LOCALAPPDATA`，还没比就先抛
 * ERR_INVALID_ARG_TYPE。
 *
 * XDG 两个变量是"替换基目录"而不是替换整条路径：`env-paths` 之后仍会追加应用名。
 * ubuntu runner 确实设了 XDG_CONFIG_HOME=/home/runner/.config，上一版直接拿它当
 * 完整期望值，于是少了 `workreport` 一段，被实测打回。
 */
function expectedPaths(platform, home) {
  if (platform === 'linux') {
    const base = process.env.XDG_DATA_HOME || join(home, '.local', 'share');
    const cfgBase = process.env.XDG_CONFIG_HOME || join(home, '.config');
    return { data: join(base, 'workreport'), config: join(cfgBase, 'workreport') };
  }
  if (platform === 'darwin') {
    return {
      data: join(home, 'Library', 'Application Support', 'workreport'),
      config: join(home, 'Library', 'Preferences', 'workreport'),
    };
  }
  if (platform === 'win32') {
    const local = process.env.LOCALAPPDATA ?? join(home, 'AppData', 'Local');
    const roaming = process.env.APPDATA ?? join(home, 'AppData', 'Roaming');
    return { data: join(local, 'workreport', 'Data'), config: join(roaming, 'workreport', 'Config') };
  }
  throw new Error(`未预期的平台：${platform}`);
}

const EXPECT = expectedPaths(platform, home);

const norm = (s) => String(s ?? '').replaceAll('\\', '/').replace(/\/+$/, '');
const actualConfigDir = dirname(report.config_path);
const tilde = (p) => norm(p).replace(norm(home), '~');

// 这一行是给 ci-diagnose 用的：作业日志要管理员权限才读得到，而 95 字符的
// status 描述放不下两端对比 —— 那就先把"实测值"挤进去，期望值 PRD 第 8 节本来就有。
console.log(`MEASURED ${platform} data=${tilde(report.data_dir)} cfg=${tilde(actualConfigDir)}`);

const rows = [
  ['平台', platform],
  ['data_dir（实际）', report.data_dir],
  ['db_path（实际）', report.db_path],
  ['config_path（实际）', report.config_path],
  ['期望 data_dir', EXPECT.data],
  ['期望 config_dir', EXPECT.config],
  ['location_source', report.location_source],
  ['problems', JSON.stringify(report.problems)],
];

for (const [k, v] of rows) console.log(`${k}: ${v}`);

const summary = process.env.GITHUB_STEP_SUMMARY;
if (summary) {
  appendFileSync(
    summary,
    `### env-paths 落点实测 · ${platform}\n\n| 项 | 值 |\n| :--- | :--- |\n${rows
      .map(([k, v]) => `| ${k} | \`${v}\` |`)
      .join('\n')}\n\n`,
    'utf8',
  );
}

let mismatch = false;
for (const [label, actual, expected] of [
  ['data_dir', report.data_dir, EXPECT.data],
  ['config_dir', actualConfigDir, EXPECT.config],
]) {
  if (norm(actual) === norm(expected)) {
    console.log(`OK ${label} = ${actual}`);
  } else {
    mismatch = true;
    console.error(
      `\n${label} 与 PRD 第 8 节不符：实际 ${actual} / 期望 ${expected}\n` +
        `按 PRD 5.3.2 与 M0 S7 的约定：改 docs/PRD.md 第 8 节并同步 D27，不要改本断言。`,
    );
  }
}
process.exitCode = mismatch ? 1 : 0;
