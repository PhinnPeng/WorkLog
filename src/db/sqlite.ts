/**
 * `node:sqlite` 的取用闸门。
 *
 * 为什么不直接 `import { DatabaseSync } from 'node:sqlite'`：
 * esbuild（tsup 的打包器）对内置模块**一律剥掉 `node:` 前缀**，把
 * `node:sqlite` 改写成 `sqlite`。fs/path/os 这样无害（存在同名遗留内置），
 * 但 Node 只在 `node:sqlite` 下暴露 SQLite —— 产物里会变成
 * `ERR_MODULE_NOT_FOUND: Cannot find package 'sqlite'`，且只在打包后暴露。
 *
 * 用计算说明符（非字面量）即可绕开静态改写；`typeof import(...)` 是纯类型，
 * 不参与打包，所以类型信息照常保留。
 */
const specifier = 'node:' + 'sqlite';

/**
 * 吞掉 `node:sqlite` 的实验特性警告。
 *
 * Node 22 把 `node:sqlite` 标为实验特性，进程第一次真正用它时（`new DatabaseSync`）
 * 会往 stderr 打一行 `ExperimentalWarning: SQLite is an experimental feature…`。
 * 这一行直接破坏 5.2.1 的契约：**错误行必须单行、可 `JSON.parse`** —— Agent 就是
 * 这样读 stderr 的，多一行就把它的解析打崩。
 *
 * 为什么在进程内过滤，而不是给 node 加 `--no-warnings`：bin 是 `#!/usr/bin/env node`，
 * 启动方式由调用方（宿主 Agent）决定，我们既改不了它的命令行，也不该要求它设
 * `NODE_OPTIONS`。这里是被 import 的最上游一处，能覆盖全部启动路径。
 *
 * 只过滤 `ExperimentalWarning` + 消息含 `SQLite`；其余警告原样放行 —— 否则把将来
 * 真正需要我们看见的实验特性变更一起吞掉了。
 */
const originalEmitWarning = process.emitWarning.bind(process) as (...args: unknown[]) => void;
const sqliteWarningFilter = (warning: string | Error, ...rest: unknown[]): void => {
  const first = rest[0];
  const type =
    typeof first === 'string'
      ? first
      : first && typeof first === 'object' && 'type' in first
        ? (first as { type?: string }).type
        : undefined;
  const message = typeof warning === 'string' ? warning : warning.message;
  if (type === 'ExperimentalWarning' && message.includes('SQLite')) return;
  originalEmitWarning(warning, ...rest);
};
process.emitWarning = sqliteWarningFilter as unknown as typeof process.emitWarning;

type SqliteModule = typeof import('node:sqlite');
const mod = (await import(specifier)) as unknown as SqliteModule;

export const DatabaseSync = mod.DatabaseSync;

/**
 * 实例类型走**纯类型再导出**取，不用 `SqliteModule['DatabaseSync']` 索引访问 ——
 * 后者在 @types/node 的声明形态下解析到构造器一侧，导致 tsc 报
 * "Property 'prepare' does not exist on type 'typeof DatabaseSync'"。
 * `export type ... from` 会被完全擦除，不进 bundle，因而不受 esbuild 改写影响。
 */
export type { DatabaseSync as Database } from 'node:sqlite';
export type { SQLInputValue } from 'node:sqlite';
