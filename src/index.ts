#!/usr/bin/env node
/**
 * bin 入口。两件事：把 runMain 算出的退出码交回进程，以及**接住模块图加载失败**。
 *
 * 为什么入口必须自举而不是直接 `import { runMain } from './cli/main.js'`：
 *
 * `src/db/sqlite.ts` 在 ESM 顶层 `await import('node:sqlite')`。模块不存在（Node 20
 * 及更早）时**整条模块图在 main 之前就断了** —— `runMain` 的 try/catch 根本没机会
 * 执行，Node 抛的是自己的多行堆栈：
 *
 *     node:internal/modules/esm/translators:447
 *         throw new ERR_UNKNOWN_BUILTIN_MODULE(url);
 *     Error [ERR_UNKNOWN_BUILTIN_MODULE]: No such built-in module: node:sqlite
 *
 * 而 5.2.1／D3 要求错误恒为 stderr 单行 JSON、可 `JSON.parse` —— Agent 崩在堆栈第一行。
 * 把 import 改成**动态**之后失败变成可捕获的 Promise rejection，入口就能把它转成契约错误。
 *
 * 代价说明：动态 import 让 CLI 主体无法被打包器静态分析，但本产物本就是单 bundle
 * （tsup `splitting:false`），多出的只是一层薄外壳。
 *
 * `export {}` 不能删：入口刻意不静态 import 任何模块（那正是本文件存在的理由），
 * 而没有 import/export 的文件在 TS 眼里是脚本而非模块，顶层 `await` 直接报 TS1375。
 */
export {};

/** 与 package.json 的 engines 范围同步；如需改动，两处一起改（PRD 第 6 节）。 */
const REQUIRES = '>=22.22.0 <23 || >=23.4.0';

async function boot(argv: string[]): Promise<number> {
  try {
    const { runMain } = await import('./cli/main.js');
    return runMain(argv);
  } catch (e) {
    // 这里刻意**不 import 任何模块**（含 cli/errors.js）—— 走到这一支时模块解析已经
    // 出过问题，再去解析一个依赖就是重蹈覆辙。错误载荷按 5.2.1 的形状手写。
    //
    // `message` 可能已经是内层（db/sqlite.ts）写好的完整句子，所以外壳只补一次
    // "无法运行"这层前缀；再叠一层"无法提供 X"就会变成同义反复。
    const message = e instanceof Error ? e.message : String(e);
    process.stderr.write(
      `${JSON.stringify({
        error: message.startsWith('本机 Node')
          ? message
          : `本机 Node（${process.version}）无法运行 workreport：${message}`,
        code: 'RUNTIME_UNSUPPORTED',
        node: process.version,
        requires: REQUIRES,
        hint: '本工具的存储层依赖 Node 内置 node:sqlite（22.5 引入但需 --experimental-sqlite，23.4 起取消 flag）。升级 Node 后重试。',
      })}\n`,
    );
    return 3;
  }
}

process.exitCode = await boot(process.argv.slice(2));
