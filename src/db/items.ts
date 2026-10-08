/**
 * `work_items` 的行↔对象映射与查询／写入原语（PRD 5.1、5.2.3、5.3.1）。
 *
 * 三处刻意的取舍：
 *   1. 排序必须是**全序**（`date DESC, time DESC NULLS LAST, created_at ASC, id ASC`）——
 *      并列行没有确定次序时，`--offset` 翻页会重复和漏项（5.2.3）。
 *   2. 截断位由 **limit+1 探测**得出，不算 `COUNT(*)`（5.2.1）。
 *   3. 关键词一律 `LIKE ? ESCAPE '\'` + 占位符绑定，元字符先转义（5.3.1）——
 *      漏转义 `%`／`_` 会让含百分号的关键词返回错误结果**且不报错**。
 */
import type { Database, SQLInputValue } from './sqlite.js';
import { Code, WorkReportError } from '../cli/errors.js';

export type ItemType = 'log' | 'plan';

export interface WorkItem {
  id: string;
  item_type: ItemType;
  date: string;
  time: string | null;
  content: string;
  category: string | null;
  status: string;
  source: string;
  planned_for: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/** 输出契约里单条对象不带 `deleted_at`（除非它确实被删了）——由命令层裁剪。 */
export const COLUMNS =
  'id, item_type, date, time, content, category, status, source, planned_for, created_at, updated_at, deleted_at';

/**
 * 过滤条件。属性写成 `| undefined` 是仓库 `exactOptionalPropertyTypes` 的要求：
 * 命令层会显式把"未提供的 flag"传成 undefined。
 */
export interface ItemFilters {
  itemType?: string | undefined;
  date?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  category?: string | undefined;
  status?: string | undefined;
  keyword?: string | undefined;
  plannedFor?: string | undefined;
  /** `plan` 且 `planned_for < 今天` 且 `status != done`（5.2.3） */
  overdue?: boolean;
  /** --overdue 比较基准日 */
  today?: string | undefined;
  includeDeleted?: boolean;
}

function text(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return String(v);
}

export function rowToItem(row: Record<string, unknown>): WorkItem {
  return {
    id: String(row.id),
    item_type: String(row.item_type) as ItemType,
    date: String(row.date),
    time: text(row.time),
    content: String(row.content),
    category: text(row.category),
    status: String(row.status),
    source: String(row.source),
    planned_for: text(row.planned_for),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    deleted_at: text(row.deleted_at),
  };
}

export type PublicItem = Omit<WorkItem, 'deleted_at'> & { deleted_at?: string };

/**
 * 输出形态（5.2.1）：活记录不带 `deleted_at`，墓碑才带 ——
 * `delete` 的返回必须是"含 deleted_at 的完整条目"，好让调用方无损重放。
 */
export function publicItem(item: WorkItem): PublicItem {
  const { deleted_at, ...rest } = item;
  return deleted_at === null ? rest : { ...rest, deleted_at };
}

/** LIKE 元字符按 5.3.1 指定的顺序转义：先 `\`，再 `%`、`_`。 */
export function likePattern(keyword: string): string {
  const escaped = keyword.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
  return `%${escaped}%`;
}

function prefixPattern(prefix: string): string {
  const escaped = prefix.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
  return `${escaped}%`;
}

interface Where {
  sql: string;
  params: SQLInputValue[];
}

function buildWhere(f: ItemFilters): Where {
  const parts: string[] = [];
  const params: SQLInputValue[] = [];
  if (!f.includeDeleted) parts.push('deleted_at IS NULL');
  if (f.itemType) {
    parts.push('item_type = ?');
    params.push(f.itemType);
  }
  if (f.date) {
    parts.push('date = ?');
    params.push(f.date);
  }
  if (f.from) {
    parts.push('date >= ?');
    params.push(f.from);
  }
  if (f.to) {
    parts.push('date <= ?');
    params.push(f.to);
  }
  if (f.category) {
    parts.push('category = ?');
    params.push(f.category);
  }
  if (f.status) {
    parts.push('status = ?');
    params.push(f.status);
  }
  if (f.keyword) {
    parts.push("content LIKE ? ESCAPE '\\'");
    params.push(likePattern(f.keyword));
  }
  if (f.plannedFor) {
    parts.push('planned_for = ?');
    params.push(f.plannedFor);
  }
  if (f.overdue) {
    parts.push("item_type = 'plan' AND planned_for IS NOT NULL AND planned_for < ? AND status <> 'done'");
    params.push(f.today ?? '');
  }
  return { sql: parts.length ? `WHERE ${parts.join(' AND ')}` : '', params };
}

const ORDER_BY = 'ORDER BY date DESC, time DESC NULLS LAST, created_at ASC, id ASC';

export interface Page {
  items: WorkItem[];
  limit: number | null;
  offset: number;
  truncated: boolean;
}

/**
 * `limit = null` 表示 `--all`（不设上限）。否则取 `limit + 1` 行探测是否还有剩余。
 */
export function queryItems(db: Database, f: ItemFilters, limit: number | null, offset: number): Page {
  const where = buildWhere(f);
  let rows: Record<string, unknown>[];
  if (limit === null) {
    rows = db
      .prepare(`SELECT ${COLUMNS} FROM work_items ${where.sql} ${ORDER_BY} LIMIT -1 OFFSET ?`)
      .all(...where.params, offset) as Record<string, unknown>[];
    return { items: rows.map(rowToItem), limit: null, offset, truncated: false };
  }
  rows = db
    .prepare(`SELECT ${COLUMNS} FROM work_items ${where.sql} ${ORDER_BY} LIMIT ? OFFSET ?`)
    .all(...where.params, limit + 1, offset) as Record<string, unknown>[];
  const truncated = rows.length > limit;
  const kept = truncated ? rows.slice(0, limit) : rows;
  return { items: kept.map(rowToItem), limit, offset, truncated };
}

export function insertItem(db: Database, item: WorkItem): void {
  db.prepare(
    `INSERT INTO work_items (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    item.id,
    item.item_type,
    item.date,
    item.time,
    item.content,
    item.category,
    item.status,
    item.source,
    item.planned_for,
    item.created_at,
    item.updated_at,
    item.deleted_at,
  );
}

/** 墓碑命中时给出 DELETED，其余情形按 5.1.3 的 0／≥2 语义报 NOT_FOUND／AMBIGUOUS_ID。 */
export function resolveItem(db: Database, prefix: string, includeDeleted: boolean): WorkItem {
  const needle = prefix.toUpperCase();
  const matched = db
    .prepare(
      `SELECT ${COLUMNS} FROM work_items WHERE upper(substr(id, 1, length(?))) = ? ${includeDeleted ? '' : 'AND deleted_at IS NULL'}`,
    )
    .all(needle, needle) as Record<string, unknown>[];

  if (matched.length === 1) return rowToItem(matched[0]!);

  if (matched.length > 1) {
    // 这里给**完整 id**，不是 5.6 那种 8 字符显示前缀：8 字符恰好是 ULID 的时间段，
    // 同一次录入会话里的条目必然撞成同一个串 —— 列候选的意义就是让调用方能挑出一个
    // 来，给短前缀等于把歧义原样还回去。
    const matches = matched.map((r) => String(r.id)).sort();
    throw new WorkReportError(Code.AMBIGUOUS_ID, `--id 前缀 ${prefix} 命中 ${matched.length} 条`, {
      field: 'id',
      matches,
      hint: '补长前缀或给出完整 id',
    });
  }

  const tombstone = db
    .prepare(
      'SELECT id FROM work_items WHERE upper(substr(id, 1, length(?))) = ? AND deleted_at IS NOT NULL',
    )
    .get(needle, needle) as { id: string } | undefined;
  if (tombstone && !includeDeleted) {
    throw new WorkReportError(Code.DELETED, `目标已被软删除：${prefix}`, {
      field: 'id',
      hint: '用 --include-deleted 读取，或 restore 复原',
    });
  }
  throw new WorkReportError(Code.NOT_FOUND, `没有匹配的工作项：${prefix}`, { field: 'id' });
}

export interface CategoryCount {
  category: string;
  count: number;
}

/** 分类归一化的数据源（5.2.12）：无分类的行不计入，墓碑默认排除。 */
export function queryCategories(
  db: Database,
  prefix?: string,
  includeDeleted = false,
): CategoryCount[] {
  const params: SQLInputValue[] = [];
  const conds = ['category IS NOT NULL'];
  if (!includeDeleted) conds.push('deleted_at IS NULL');
  if (prefix) {
    conds.push("category LIKE ? ESCAPE '\\'");
    params.push(prefixPattern(prefix));
  }
  const rows = db
    .prepare(
      `SELECT category, COUNT(*) AS count FROM work_items WHERE ${conds.join(' AND ')} GROUP BY category`,
    )
    .all(...params) as Array<{ category: string; count: number | bigint }>;
  return rows
    .map((r) => ({ category: String(r.category), count: Number(r.count) }))
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));
}

/** 按完整 id 取整行（**含墓碑** —— 是否报 DELETED 由命令层裁决）。 */
export function loadItem(db: Database, id: string): WorkItem | undefined {
  const row = db.prepare(`SELECT ${COLUMNS} FROM work_items WHERE id = ?`).get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToItem(row) : undefined;
}

export interface ItemPatch {
  item_type?: ItemType;
  date?: string;
  time?: string | null;
  content?: string;
  category?: string | null;
  status?: string;
  source?: string;
  planned_for?: string | null;
}

/**
 * 部分更新：只写传进来的字段，`updated_at` 一律刷新。
 * 跨字段一致性不在这里判 —— 由命令层对"更新后的整行"调 assertRowCoherent，
 * 且必须发生在同一个 IMMEDIATE 事务里，否则校验与写入之间有竞态窗口。
 */
export function updateItem(db: Database, id: string, patch: ItemPatch, now: string): WorkItem {
  const keys = Object.keys(patch) as Array<keyof ItemPatch>;
  const sets = [...keys.map((k) => `${k} = ?`), 'updated_at = ?'].join(', ');
  db.prepare(`UPDATE work_items SET ${sets} WHERE id = ?`).run(
    ...keys.map((k) => patch[k] as SQLInputValue),
    now,
    id,
  );
  return loadItem(db, id)!;
}

/** 软删除与复原共用：置或清 `deleted_at`（5.2.6）。 */
export function setDeletedAt(db: Database, id: string, deletedAt: string | null): WorkItem {
  db.prepare('UPDATE work_items SET deleted_at = ?, updated_at = ? WHERE id = ?').run(
    deletedAt,
    new Date().toISOString(),
    id,
  );
  return loadItem(db, id)!;
}

/**
 * 物理删除过期墓碑（5.2.6）。`deleted_at` 是 UTC 带 Z 的 ISO 串，字典序即时间序，
 * 所以可以直接和 cutoff 串比较。返回删除条数。
 */
export function purgeTombstones(db: Database, olderThanDays: number): number {
  const cutoff = new Date(Date.now() - olderThanDays * 86_400_000).toISOString();
  const res = db.prepare('DELETE FROM work_items WHERE deleted_at IS NOT NULL AND deleted_at < ?').run(cutoff);
  return Number(res.changes);
}

/** 供 `backup` 回显 item_count（含墓碑时由调用方决定过滤口径）。 */
export function countItems(db: Database, includeDeleted = false): number {
  const sql = includeDeleted
    ? 'SELECT COUNT(*) AS c FROM work_items'
    : 'SELECT COUNT(*) AS c FROM work_items WHERE deleted_at IS NULL';
  return Number((db.prepare(sql).get() as { c: number | bigint }).c);
}
