/**
 * `delete` / `restore` / `purge` —— 软删除三件套（PRD 5.2.6）。
 *
 * 删除一律是软的：调用方是会幻觉的 LLM，它可能从搜索结果里取错 `id`，而 `backup`
 * 是手动的 —— 在这个工具里物理删除等同不可恢复的数据丢失。`purge` 是唯一不可逆
 * 操作，所以 `--older-than` 无默认值且必须再给 `--yes`（双显式确认）。
 */
import {
  publicItem,
  purgeTombstones,
  resolveItem,
  setDeletedAt,
  type PublicItem,
} from '../../db/items.js';
import { Code, WorkReportError } from '../errors.js';
import { writeTx } from './common.js';

export interface PurgeResult {
  purged: number;
  older_than_days: number;
}

export function runDelete(opts: Record<string, unknown>): PublicItem {
  const id = String(opts.id);
  const dryRun = opts.dryRun === true;

  // --dry-run：只做 id 解析，返回"将要被删的完整条目"且**不写库**（5.5.1 要求
  // Agent 在真实删除前把这一份复述给用户确认）。
  if (dryRun) {
    return writeTx(opts, (db) => publicItem(resolveItem(db, id, false)));
  }
  return writeTx(opts, (db) => publicItem(setDeletedAt(db, resolveItem(db, id, false).id, new Date().toISOString())));
}

export function runRestore(opts: Record<string, unknown>): PublicItem {
  const id = String(opts.id);
  return writeTx(opts, (db) => {
    // 墓碑要能被读到才谈得上复原，所以这里带 includeDeleted；
    // 但"没被删过的项"要报清楚，而不是静默刷新 updated_at。
    const item = resolveItem(db, id, true);
    if (item.deleted_at === null) {
      throw new WorkReportError(Code.VALIDATION_ERROR, '该项并未被删除，无需 restore', {
        field: 'id',
        hint: '要改内容请用 workreport update',
      });
    }
    return publicItem(setDeletedAt(db, item.id, null));
  });
}

export function runPurge(opts: Record<string, unknown>): PurgeResult {
  const raw = String(opts.olderThan);
  const matched = /^(\d+)d?$/u.exec(raw.trim());
  if (!matched) {
    throw new WorkReportError(Code.VALIDATION_ERROR, `--older-than 需要形如 30d 的天数：${raw}`, {
      field: 'older_than',
    });
  }
  if (opts.yes !== true) {
    throw new WorkReportError(Code.VALIDATION_ERROR, 'purge 是不可逆操作，必须同时给出 --yes', {
      field: 'yes',
      hint: '先用 delete --dry-run 确认目标，再带 --yes 执行',
    });
  }
  const days = Number(matched[1]);
  return writeTx(opts, (db) => ({ purged: purgeTombstones(db, days), older_than_days: days }));
}
