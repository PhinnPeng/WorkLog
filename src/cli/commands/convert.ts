/**
 * `convert` —— 类型迁移的唯一入口，双向（PRD 5.2.5）。
 *
 * 这里是全项目**唯一允许推导**的地方：`--to log` 时 `status` 缺省取 `done`，
 * 因为"把计划转为已完成的工作项"这一动作本身蕴含 `planned → done` 的语义迁移。
 * 其余写路径一律不推导（5.2.2 的"不静默纠正"）。
 */
import { publicItem, resolveItem, updateItem, type ItemPatch, type PublicItem } from '../../db/items.js';
import { Code, WorkReportError } from '../errors.js';
import { assertRowCoherent } from '../rowchecks.js';
import { ITEM_TYPES, STATUSES } from '../spec.js';
import { checkContent, checkDate, checkEnum, checkTime } from '../validate.js';
import { blankToNull, writeTx } from './common.js';

export function runConvert(opts: Record<string, unknown>): PublicItem {
  const to = checkEnum(opts.to === undefined ? 'log' : String(opts.to), ITEM_TYPES, 'to');
  const id = String(opts.id);

  return writeTx(opts, (db) => {
    const src = resolveItem(db, id, false);
    if (src.item_type === to) {
      throw new WorkReportError(
        Code.CONVERT_SOURCE_TYPE_MISMATCH,
        `源项 item_type=${src.item_type}，无法 --to ${to}`,
        { expected: to, actual: src.item_type, hint: `该项已经是 ${to}，需要的可能是 update` },
      );
    }

    const patch: ItemPatch = { item_type: to };
    if (to === 'log') {
      // 落哪一天必须说清：计划的登记日不等于它变成工作项的那天。
      if (opts.date === undefined) {
        throw new WorkReportError(Code.VALIDATION_ERROR, 'convert --to log 需要 --date YYYY-MM-DD', {
          field: 'date',
          hint: '要转成"今天的实际记录"就传 --date <今天>（--date 缺省不会自动补，避免记错日子）',
        });
      }
      patch.date = checkDate(String(opts.date), 'date');
      patch.planned_for = null;
      patch.status =
        opts.status === undefined ? 'done' : checkEnum(String(opts.status), STATUSES, 'status');
      if (opts.content !== undefined) patch.content = checkContent(String(opts.content));
      if (opts.category !== undefined) patch.category = blankToNull(String(opts.category));
      if (opts.time !== undefined) patch.time = blankToNull(checkTime(String(opts.time)));
    } else {
      // plan：planned_for 必填，缺失交给 assertRowCoherent 报精确码；date 保留原记录日。
      if (opts.plannedFor !== undefined) {
        patch.planned_for = checkDate(String(opts.plannedFor), 'planned_for');
      }
      patch.status =
        opts.status === undefined ? 'planned' : checkEnum(String(opts.status), STATUSES, 'status');
      if (opts.content !== undefined) patch.content = checkContent(String(opts.content));
      if (opts.category !== undefined) patch.category = blankToNull(String(opts.category));
    }

    assertRowCoherent({ ...src, ...patch });
    return publicItem(updateItem(db, src.id, patch, new Date().toISOString()));
  });
}
