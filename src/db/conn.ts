/**
 * 连接工厂：打开库并施加 PRAGMA。
 * 依据 PRD 第 6 节并发安全（D10）—— 只靠"SQLite 事务"不足以保证多进程写入安全。
 */
import { DatabaseSync, type Database } from './sqlite.js';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const BUSY_TIMEOUT_MS = 5000;

/**
 * WAL 下的持久化档位（D49）。NORMAL 的含义按 SQLite 文档：多数事务期间不做 sync，
 * 改为"checkpoint 前 sync WAL、checkpoint 完成后 sync 库文件"。
 *
 * 换来的是提交期间几乎不持锁 —— 实测 4×250 个 IMMEDIATE 事务从 139.75s／5 笔
 * `SQLITE_BUSY` 降到 1.27s／0 笔（spikes/o16-lock-contention）。
 * 代价是**掉电或 OS 崩溃时，最近若干笔已提交但尚未 checkpoint 的记录可能回滚**；
 * 应用崩溃不在此列（事务照常持久），库也不会损坏。用户 2026-09-29 明确接受。
 */
export const SYNCHRONOUS = 'NORMAL';

/** checkpoint 频率（页数）。默认 1000 页让尾延迟抖到 681ms，放宽后 258ms。 */
export const WAL_AUTOCHECKPOINT_PAGES = 10000;

export function open(dbPath: string): Database {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode=WAL');
  db.exec(`PRAGMA busy_timeout=${BUSY_TIMEOUT_MS}`);
  db.exec(`PRAGMA synchronous=${SYNCHRONOUS}`);
  db.exec(`PRAGMA wal_autocheckpoint=${WAL_AUTOCHECKPOINT_PAGES}`);
  return db;
}

/** 库是否已有内容表（用于区分"全新库"与"误指向的非本工具库"）。 */
export function hasUserTables(db: Database): boolean {
  const row = db
    .prepare(
      "SELECT COUNT(*) AS c FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
    )
    .get() as { c: number };
  return Number(row.c) > 0;
}

export function tableExists(db: Database, name: string): boolean {
  const row = db
    .prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(name) as { c: number };
  return Number(row.c) > 0;
}
