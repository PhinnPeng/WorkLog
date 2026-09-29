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
