/**
 * DDL 与迁移数组 —— 全仓库唯一的 schema 真源。
 * 依据 PRD 5.1.4（建表约束逐字）、5.1.2（索引按查询形态）、5.3.2（迁移语义）。
 *
 * 迁移数组**只追加不改写**：已发布的历史迁移一旦被修改，老用户升上来会走到
 * 与当初不同的路径。要改结构就加一条新版本。
 */
import type { Database } from './sqlite.js';
/** v1：表与约束。CHECK 全部落 DB 层（D12）—— CLI 校验只负责给精确错误码。 */
const V1_TABLES = `
CREATE TABLE work_items (
  id           TEXT PRIMARY KEY,
  item_type    TEXT NOT NULL CHECK (item_type IN ('log','plan')),
  date         TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  time         TEXT CHECK (time IS NULL OR time GLOB '[0-9][0-9]:[0-9][0-9]'),
  content      TEXT NOT NULL CHECK (length(content) BETWEEN 1 AND 2000),
  category     TEXT,
  status       TEXT NOT NULL CHECK (status IN ('planned','in_progress','done','blocked')),
  source       TEXT NOT NULL DEFAULT 'user' CHECK (source IN ('user','screenshot','import')),
  planned_for  TEXT CHECK (planned_for IS NULL OR planned_for GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  deleted_at   TEXT,
  CHECK (item_type <> 'log'  OR planned_for IS NULL),
  CHECK (item_type <> 'log'  OR status      <> 'planned'),
  CHECK (item_type <> 'plan' OR planned_for IS NOT NULL)
);
CREATE TABLE schema_version (version INTEGER NOT NULL);
INSERT INTO schema_version (version) VALUES (1);
`;

/**
 * v2：索引。
 * 刻意不建 content 索引（LIKE 中缀走不到 B-tree，D1）；
 * 也刻意不建原稿那批单列低基数索引（idx_status/idx_item_type，D13）。
 * idx_active 用部分索引排除软删除墓碑（D23）。
 */
const V2_INDEXES = `
CREATE INDEX idx_date_type   ON work_items (date, item_type);
CREATE INDEX idx_planned     ON work_items (planned_for, item_type, status);
CREATE INDEX idx_category    ON work_items (category, date);
CREATE INDEX idx_active      ON work_items (date DESC, time DESC, created_at, id)
                                WHERE deleted_at IS NULL;
`;

export interface Migration {
  version: number;
  up(db: Database): void;
}

export const migrations: readonly Migration[] = [
  { version: 1, up: (db) => db.exec(V1_TABLES) },
  { version: 2, up: (db) => db.exec(V2_INDEXES) },
];

export const CURRENT_SCHEMA_VERSION = migrations[migrations.length - 1]!.version;

export const WORKREPORT_SCHEMA_VERSION_APPLIED = CURRENT_SCHEMA_VERSION;
