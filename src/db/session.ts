/**
 * 会话工厂：定位 → 打开 → 迁移，一条命令一次连接。
 * 依据 5.3.2：除 `describe` 外，每次启动都要在一个事务内把库带到当前版本。
 */
import type { Database } from './sqlite.js';
import { open } from './conn.js';
import { ensureSchema } from './migrate.js';
import { resolveLocation } from '../locations.js';

export function openSession(dbFlag?: string): Database {
  const loc = resolveLocation(dbFlag);
  const db = open(loc.dbPath);
  ensureSchema(db);
  return db;
}

export function withSession<T>(dbFlag: string | undefined, fn: (db: Database) => T): T {
  const db = openSession(dbFlag);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

/**
 * `BEGIN IMMEDIATE` 事务：写命令一律用它。
 * 延迟取写锁意味着"读校验—写提交"之间存在竞态窗口，而 SQLite 的
 * deferred 事务升级写锁时可能直接 SQLITE_BUSY（第 6 节并发约定）。
 */
export function inImmediateTx<T>(db: Database, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* 回滚失败时原始错误才是因 */
    }
    throw e;
  }
}
