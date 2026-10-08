/**
 * 写命令的共用小工具：一个 IMMEDIATE 事务包住"读校验 → 写"，并把驱动错误映射进契约。
 *
 * 为什么必须同事务：`update`／`convert` 的判据是"更新后的整行合法"，如果先读校验、
 * 再另开事务写，两个进程可以各自看到合法的旧行却合写出非法的新行。
 */
import type { Database } from '../../db/sqlite.js';
import { inImmediateTx, withSession } from '../../db/session.js';
import { fromSqliteError } from '../errors.js';

export function dbFlagOf(opts: Record<string, unknown>): string | undefined {
  return opts.db === undefined ? undefined : String(opts.db);
}

export function writeTx<T>(opts: Record<string, unknown>, fn: (db: Database) => T): T {
  try {
    return withSession(dbFlagOf(opts), (db) => inImmediateTx(db, () => fn(db)));
  } catch (e) {
    throw fromSqliteError(e);
  }
}

/** 位置参数（`config set <key> <value>` 这类）由 program.ts 收进 `_args`。 */
export function positional(opts: Record<string, unknown>): string[] {
  return Array.isArray(opts._args) ? (opts._args as string[]) : [];
}

/** 空白转 NULL：`--category ""` / `--time ""` 表达的是"清掉这个值"，不是存空串。 */
export function blankToNull(value: string): string | null {
  return value.trim() === '' ? null : value;
}
