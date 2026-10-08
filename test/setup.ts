/**
 * 门禁前置：确认本机 Node 真的能提供 `node:sqlite`。
 *
 * 为什么需要这一步：本工具的存储层完全建立在 Node 内置的 `node:sqlite` 上（D38，零
 * 原生依赖）。它在 **22.5.0 引入但需要 `--experimental-sqlite`**，**23.4.0 起取消该
 * flag**；Node 20 及更早则完全没有这个模块。版本号本身不足以判断"能不能用"（同名模块
 * 在不同版本上存在性不同），所以这里直接**探测运行时的真实能力**，而不是比大小。
 *
 * 探测失败的报错必须点明根因：这套契约测试全是 `execFile` 跑真实产物、断言
 * "stderr 单行可 parse"，模块缺失时最先冒出来的往往是一堆 `JSON.parse(stderr)` 失败，
 * 报错文本全指向业务代码，没人能从那里逆推出"是 node 版本不对"。
 */
import { spawnSync } from 'node:child_process';

const probe = spawnSync(
  process.execPath,
  ['-e', "const s = require('node:sqlite'); if (typeof s.DatabaseSync !== 'function') process.exit(1);"],
  { stdio: 'ignore' },
);

if (probe.status !== 0) {
  throw new Error(
    [
      `本机 Node 无法提供 node:sqlite（v${process.versions.node}，${process.execPath}）。`,
      '本工具的存储层完全依赖 Node 内置 node:sqlite（D38）：它在 22.5.0 引入但需',
      '--experimental-sqlite，23.4.0 起取消该 flag，Node 20 及更早没有该模块。',
      'package.json 的 engines 声明 >=22.22.0 <23 || >=23.4.0（CI 矩阵跑 22 与 24，',
      '见 .github/workflows/ci.yml）。',
    ].join('\n'),
  );
}
