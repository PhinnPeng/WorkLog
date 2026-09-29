/**
 * `categories` —— 分类及其条目数（PRD 5.2.12），供 Agent 在 `add` 前做
 * 分类归一化。优先级高于 `report`：没有归一化手段，日报输出的是碎片。
 */
import { withSession } from '../../db/session.js';
import { queryCategories, type CategoryCount } from '../../db/items.js';

export function runCategories(opts: Record<string, unknown>): CategoryCount[] {
  const prefix = opts.prefix === undefined ? undefined : String(opts.prefix);
  return withSession(opts.db === undefined ? undefined : String(opts.db), (db) =>
    queryCategories(db, prefix),
  );
}
