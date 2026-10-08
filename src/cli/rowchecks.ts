/**
 * 跨字段一致性的唯一实现（PRD 5.1.1、5.2.2、5.2.4、5.2.5）。
 *
 * `add` / `update` / `convert` 三条写路径共用它 —— 这套联动规则只要存在两份，
 * 就会随版本演进漂移，出现"同一条数据两个入口结果不同"的 bug（这正是 5.2.4
 * 把类型迁移收敛到 `convert` 单入口的同一个理由）。
 *
 * 校验对象一律是**写入后的整行**：`update` 的契约就是"更新后的行必须满足 5.1.1"，
 * 而 `add` 的入参组合等价于它的结果行，所以三处能用同一个判据。
 * DB 层的 `CHECK` 只兜底"绕过 CLI 写入"，不能用来分码 —— `node:sqlite` 下所有
 * CHECK 违规的 `errcode` 恒为 275（D39）。
 */
import { Code, WorkReportError } from './errors.js';

export interface RowShape {
  item_type: string;
  status: string;
  planned_for: string | null;
}

export function assertRowCoherent(row: RowShape): void {
  if (row.item_type === 'log' && row.status === 'planned') {
    throw new WorkReportError(Code.CONFLICT_STATUS_PLANNED_FOR_LOG, 'item_type=log 时 status 不能为 planned', {
      field: 'status',
    });
  }
  if (row.item_type === 'log' && row.planned_for !== null) {
    throw new WorkReportError(Code.CONFLICT_PLANNED_FOR_ON_LOG, 'item_type=log 时不能带 planned_for', {
      field: 'planned_for',
    });
  }
  if (row.item_type === 'plan' && row.planned_for === null) {
    throw new WorkReportError(
      Code.CONFLICT_PLAN_MISSING_PLANNED_FOR,
      'item_type=plan 必须给出 planned_for',
      { field: 'planned_for' },
    );
  }
}
