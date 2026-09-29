/**
 * doctor —— 环境与库自检（PRD 5.2.13）。
 *
 * 只读：不迁移、不修复、不改权限。否则 Agent 可以借"体检"产生写副作用。
 * 库层面的问题一律进 `problems` 数组而非抛出，好让一条命令看全貌；
 * `problems` 为空即健康。码值必须是 5.7.3 已有的错误码，不自造健康词表。
 */
import { accessSync, constants, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync, type Database } from '../../db/sqlite.js';
import { Code, WorkReportError, type Code as CodeT } from '../errors.js';
import { CLI_VERSION } from '../spec.js';
import { resolveFormat } from '../format.js';
import { CONFIG_PATH, resolveLocation } from '../../locations.js';
import { CURRENT_SCHEMA_VERSION } from '../../db/schema.js';

export interface DoctorReport {
  cli_version: string;
  node: string;
  data_dir: string;
  db_path: string;
  config_path: string;
  location_source: 'flag' | 'env' | 'config' | 'default';
  /**
   * 其余命令这一轮会以什么呈现形态输出，以及它的来源（PRD 5.4：改了配置要能
   * 解释为什么生效／不生效）。配置非法时这两个字段缺席，改由 `problems`
   * 里的 CONFIG_INVALID 说明原因 —— 缺席比编一个假值诚实。
   */
  format?: string;
  format_source?: 'flag' | 'config' | 'default';
  db_exists: boolean;
  db_open: boolean;
  schema_version: number | null;
  journal_mode: string | null;
  writable: boolean;
  item_count: number | null;
  deleted_count: number | null;
  problems: CodeT[];
}

function nearestExisting(p: string): string {
  let cur = p;
  while (!existsSync(cur)) {
    const parent = dirname(cur);
    if (parent === cur) return cur; // 到根了
    cur = parent;
  }
  return cur;
}

function scalar(db: Database, sql: string): number | string | null {
  const row = db.prepare(sql).get() as Record<string, unknown> | undefined;
  if (!row) return null;
  const v = Object.values(row)[0];
  return typeof v === 'bigint' ? Number(v) : (v as number | string | null);
}

export function runDoctor(opts: Record<string, unknown>): DoctorReport {
  const loc = resolveLocation(typeof opts.db === 'string' ? opts.db : undefined);
  const problems = new Set<CodeT>();

  const report: DoctorReport = {
    cli_version: CLI_VERSION,
    node: process.version,
    data_dir: loc.dataDir,
    db_path: loc.dbPath,
    config_path: CONFIG_PATH,
    location_source: loc.source,
    db_exists: existsSync(loc.dbPath),
    db_open: false,
    schema_version: null,
    journal_mode: null,
    writable: false,
    item_count: null,
    deleted_count: null,
    problems: [],
  };

  // 体检报告里带上"格式由谁决定"，好让"改了配置没生效"这类问题在一条命令里
  // 就能自证。配置非法不阻断体检：记进 problems 并让字段缺席。
  try {
    const f = resolveFormat(opts.format);
    report.format = f.format;
    report.format_source = f.source;
  } catch (e) {
    if (e instanceof WorkReportError && e.code === Code.CONFIG_INVALID) {
      problems.add(Code.CONFIG_INVALID);
    } else {
      throw e;
    }
  }

  // 目录可能还不存在（首次写入前不创建是有意为之）。对不存在的目录做 W_OK
  // 会失败，于是全新安装的第一次体检就误报"不可写" —— 改为向上找最近一个
  // 已存在的祖先，那一层才真正决定能否创建。
  try {
    accessSync(nearestExisting(dirname(loc.dbPath)), constants.W_OK);
    report.writable = true;
  } catch {
    problems.add(Code.PATH_NOT_WRITABLE);
  }

  if (!report.db_exists) {
    // 空目录不算错，但库确实还不存在——交给上层按需解读。
    problems.add(Code.DB_NOT_INITIALIZED);
    report.problems = [...problems];
    return report;
  }

  let db: Database | null = null;
  try {
    db = new DatabaseSync(loc.dbPath, { readOnly: true });
    report.db_open = true;
    report.journal_mode = String(scalar(db, 'PRAGMA journal_mode') ?? '');
    report.schema_version = Number(scalar(db, 'SELECT version FROM schema_version LIMIT 1') ?? NaN);

    const tables = new Set(
      (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{
        name: string;
      }>).map((r) => r.name),
    );
    if (!tables.has('work_items') || Number.isNaN(report.schema_version)) {
      report.schema_version = Number.isNaN(report.schema_version) ? null : report.schema_version;
      problems.add(Code.DB_NOT_INITIALIZED);
    } else {
      report.item_count = Number(scalar(db, 'SELECT COUNT(*) FROM work_items') ?? 0);
      report.deleted_count = Number(
        scalar(db, 'SELECT COUNT(*) FROM work_items WHERE deleted_at IS NOT NULL') ?? 0,
      );
      if (report.schema_version > CURRENT_SCHEMA_VERSION) problems.add(Code.SCHEMA_TOO_NEW);
    }
  } catch {
    problems.add(Code.DB_CORRUPT);
  } finally {
    try {
      db?.close();
    } catch {
      /* 只读连接的关闭失败不影响结论 */
    }
  }

  if (!report.writable) problems.add(Code.PATH_NOT_WRITABLE);
  report.problems = [...problems].sort();
  return report;
}
