/**
 * `show` —— 按 id 精确读取单条（PRD 5.2.7）。
 * 5.5.1 的 Agent 流程靠它做"改前先读"：此前命令面缺这个原语，
 * Agent 只能用 `list --keyword` 近似定位，是误删的直接来源。
 */
import { withSession } from '../../db/session.js';
import { publicItem, resolveItem, type PublicItem } from '../../db/items.js';
import { Code, WorkReportError } from '../errors.js';

export function runShow(opts: Record<string, unknown>): PublicItem {
  const id = String(opts.id);
  if (id.trim() === '') {
    throw new WorkReportError(Code.VALIDATION_ERROR, 'id 不能为空', {
      field: 'id',
      hint: '给出 ULID 或其唯一前缀',
    });
  }
  const includeDeleted = opts.includeDeleted === true;
  return withSession(
    opts.db === undefined ? undefined : String(opts.db),
    (db) => publicItem(resolveItem(db, id, includeDeleted)),
  );
}
