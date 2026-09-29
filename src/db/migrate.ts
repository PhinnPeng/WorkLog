/**
 * Schema 迁移（PRD 5.3.2、D14）。
 *
 * 四条语义都是硬要求，对应 AC-2：
 *   1. 全新空库 → 引导到当前版本。
 *   2. 库存在且有别的表但没有 work_items → DB_NOT_INITIALIZED，**绝不静默建表**。
 *      静默建表会把一个误指向的非本工具库变成"看起来正常的空库"，
 *      用户的直接感受是历史记录全没了。
 *   3. 版本高于本 CLI → SCHEMA_TOO_NEW，不猜测新结构。
 *   4. 升级在单个事务内；任一步失败整体回滚，版本号与数据都保持原样。
 */
import type { Database } from './sqlite.js';
import { Code, WorkReportError } from '../cli/errors.js';
import { hasUserTables, tableExists } from './conn.js';
import { CURRENT_SCHEMA_VERSION, migrations } from './schema.js';

export function readVersion(db: Database): number | null {
  if (!tableExists(db, 'schema_version')) return null;
  const row = db.prepare('SELECT version FROM schema_version LIMIT 1').get() as
    | { version: number }
    | undefined;
  return row ? Number(row.version) : null;
}

function applyInRange(db: Database, from: number): void {
  const pending = migrations.filter((m) => m.version > from);
  if (pending.length === 0) return;
  db.exec('BEGIN');
  try {
    for (const m of pending) m.up(db);
    db.prepare('UPDATE schema_version SET version = ?').run(CURRENT_SCHEMA_VERSION);
    db.exec('COMMIT');
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* 回滚本身失败时，原始错误才是因；让上层看到它。 */
    }
    throw new WorkReportError(
      Code.MIGRATION_FAILED,
      `迁移失败，已回滚：${err instanceof Error ? err.message : String(err)}`,
      { from, to: CURRENT_SCHEMA_VERSION },
    );
  }
}

/** 把库带到 CURRENT_SCHEMA_VERSION；返回进入时的版本（新库为 0）。 */
export function ensureSchema(db: Database): number {
  if (!tableExists(db, 'work_items')) {
    if (hasUserTables(db)) {
      throw new WorkReportError(
        Code.DB_NOT_INITIALIZED,
        '目标库存在其他数据表但没有 work_items 表；这不是 workreport 数据库，拒绝在其中建表',
        { hint: '若要换库，用 --db 或 config set data_dir 指到正确路径' },
      );
    }
    applyInRange(db, 0);
    return 0;
  }

  const version = readVersion(db);
  if (version === null) {
    throw new WorkReportError(
      Code.DB_NOT_INITIALIZED,
      '库里有 work_items 但没有 schema_version 表，无法判断结构版本',
    );
  }
  if (version > CURRENT_SCHEMA_VERSION) {
    throw new WorkReportError(
      Code.SCHEMA_TOO_NEW,
      `库的结构版本 ${version} 高于本 CLI 支持的 ${CURRENT_SCHEMA_VERSION}，请升级 workreport`,
      { schema_version: version, cli_supports: CURRENT_SCHEMA_VERSION },
    );
  }
  if (version < CURRENT_SCHEMA_VERSION) applyInRange(db, version);
  return version;
}

export { CURRENT_SCHEMA_VERSION };
