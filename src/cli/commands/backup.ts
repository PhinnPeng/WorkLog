/**
 * `backup` —— 快照到文件（PRD 5.2.11）。
 *
 * 实现走 `VACUUM INTO`，不用文件复制：实测它的产物是**已合并 WAL 的单文件**，
 * 不附带 `-wal`/`-shm`，正好是备份想要的形态；`node:sqlite` 没有 `backup()` 方法
 * （附录 B）。目标目录不存在时自动建；已存在默认**拒绝覆盖**并报 PATH_EXISTS ——
 * 同日多次备份若互相冲掉，等于没有备份。
 */
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from '../../db/sqlite.js';
import { openSession } from '../../db/session.js';
import { resolveLocation } from '../../locations.js';
import { Code, WorkReportError } from '../errors.js';
import { expandPath } from '../paths.js';
import { todayLocal } from '../validate.js';
import { dbFlagOf } from './common.js';

export interface BackupResult {
  path: string;
  size_bytes: number;
  item_count: number;
}

function countSnapshot(dbFile: string): number {
  const snap = new DatabaseSync(dbFile, { readOnly: true });
  try {
    const row = snap
      .prepare('SELECT COUNT(*) AS c FROM work_items WHERE deleted_at IS NULL')
      .get() as { c: number | bigint };
    return Number(row.c);
  } finally {
    snap.close();
  }
}

export function runBackup(opts: Record<string, unknown>): BackupResult {
  const dbFlag = dbFlagOf(opts);
  const loc = resolveLocation(dbFlag);
  const target =
    opts.output === undefined
      ? join(loc.dataDir, 'backups', `workreport-${todayLocal()}.db`)
      : expandPath(String(opts.output), { requireAbsolute: true });

  if (existsSync(target) && opts.force !== true) {
    throw new WorkReportError(Code.PATH_EXISTS, `备份目标已存在，默认不覆盖：${target}`, {
      path: target,
      hint: '确认要替换该文件时加 --force',
    });
  }
  mkdirSync(dirname(target), { recursive: true });

  const db = openSession(dbFlag);
  try {
    // VACUUM INTO 遇已存在文件即报错，--force 的语义就是替换它。
    if (existsSync(target)) rmSync(target);
    db.exec(`VACUUM INTO '${target.replaceAll("'", "''")}'`);
  } finally {
    db.close();
  }

  return { path: target, size_bytes: statSync(target).size, item_count: countSnapshot(target) };
}
