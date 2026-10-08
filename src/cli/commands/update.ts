/**
 * `update` —— 按 id 改字段（PRD 5.2.4）。
 *
 * 刻意不接受 `--item-type`：跨类型变更要同时裁决 `planned_for` 与 `status` 的联动，
 * 这套状态机若在 `update` 和 `convert` 各存一份，必然漂移成"同一条数据两个入口
 * 结果不同"。所以类型迁移的唯一入口是 `convert`，这里传了就报用法错。
 */
import { publicItem, resolveItem, updateItem, type ItemPatch, type PublicItem } from '../../db/items.js';
import { Code, WorkReportError } from '../errors.js';
import { assertRowCoherent } from '../rowchecks.js';
import { SOURCES, STATUSES } from '../spec.js';
import { checkContent, checkDate, checkEnum, checkTime } from '../validate.js';
import { blankToNull, writeTx } from './common.js';

export function runUpdate(opts: Record<string, unknown>): PublicItem {
  if (opts.itemType !== undefined) {
    throw new WorkReportError(Code.USAGE_ERROR, 'update 不接受 --item-type', {
      field: 'item_type',
      hint: '类型迁移请用 workreport convert --id <id> --to log|plan',
    });
  }

  const patch: ItemPatch = {};
  if (opts.content !== undefined) patch.content = checkContent(String(opts.content));
  if (opts.date !== undefined) patch.date = checkDate(String(opts.date), 'date');
  if (opts.time !== undefined) patch.time = blankToNull(checkTime(String(opts.time)));
  if (opts.category !== undefined) patch.category = blankToNull(String(opts.category));
  if (opts.status !== undefined) patch.status = checkEnum(String(opts.status), STATUSES, 'status');
  if (opts.source !== undefined) patch.source = checkEnum(String(opts.source), SOURCES, 'source');
  if (opts.plannedFor !== undefined) {
    const raw = String(opts.plannedFor);
    patch.planned_for = raw.trim() === '' ? null : checkDate(raw, 'planned_for');
  }

  if (Object.keys(patch).length === 0) {
    throw new WorkReportError(Code.VALIDATION_ERROR, '没有要更新的字段', {
      hint: '至少给一个 --content / --date / --time / --category / --status / --source / --planned-for',
    });
  }

  const id = String(opts.id);
  return writeTx(opts, (db) => {
    // resolveItem 已按 5.1.3 处理 NOT_FOUND／AMBIGUOUS_ID，并对墓碑报 DELETED（5.2.6）。
    const current = resolveItem(db, id, false);
    // 判"更新后的整行"，且不跨越类型边界：绝不自动改类型或静默改状态。
    assertRowCoherent({ ...current, ...patch });
    return publicItem(updateItem(db, current.id, patch, new Date().toISOString()));
  });
}
