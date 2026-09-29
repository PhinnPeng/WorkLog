/**
 * `list` —— 过滤查询（PRD 5.2.3），并作为 `search` 的同一实现（5.2.8 硬要求：
 * 两者不得各持一份 SQL）。
 */
import { withSession } from '../../db/session.js';
import { queryItems, publicItem, type Page, type WorkItem } from '../../db/items.js';
import { Code, WorkReportError } from '../errors.js';
import { ITEM_TYPES, LIMITS, STATUSES } from '../spec.js';
import { checkDate, checkEnum, checkInt, todayLocal } from '../validate.js';

export interface Envelope {
  items: ReturnType<typeof publicItem>[];
  /** `--all` 时无上限，此处为 null */
  limit: number | null;
  offset: number;
  truncated: boolean;
}

function str(value: unknown): string | undefined {
  return value === undefined ? undefined : String(value);
}

function bool(value: unknown): boolean {
  return value === true;
}

export function listCore(opts: Record<string, unknown>, keywordOverride?: string): Envelope {
  const date = str(opts.date);
  const from = str(opts.from);
  const to = str(opts.to);
  // `--date` 与 `--from`/`--to` 同时给出：报错，不做静默优先级裁决（5.2.3）。
  if (date !== undefined && (from !== undefined || to !== undefined)) {
    throw new WorkReportError(
      Code.VALIDATION_ERROR,
      '--date 与 --from/--to 互斥，不能同时给出',
      { field: 'date', hint: '区间用 --from/--to，单日用 --date' },
    );
  }

  const keywordRaw = keywordOverride ?? str(opts.keyword);
  if (keywordRaw !== undefined && keywordRaw.trim() === '') {
    throw new WorkReportError(Code.VALIDATION_ERROR, 'keyword 不能为空白', {
      field: 'keyword',
      hint: '空白关键词会退化成全表返回',
    });
  }

  const filters = {
    itemType: opts.itemType === undefined ? undefined : checkEnum(String(opts.itemType), ITEM_TYPES, 'item_type'),
    date: date === undefined ? undefined : checkDate(date, 'date'),
    from: from === undefined ? undefined : checkDate(from, 'from'),
    to: to === undefined ? undefined : checkDate(to, 'to'),
    category: str(opts.category),
    status: opts.status === undefined ? undefined : checkEnum(String(opts.status), STATUSES, 'status'),
    keyword: keywordRaw,
    plannedFor:
      opts.plannedFor === undefined ? undefined : checkDate(String(opts.plannedFor), 'planned_for'),
    overdue: bool(opts.overdue),
    today: todayLocal(),
    includeDeleted: bool(opts.includeDeleted),
  };

  const all = bool(opts.all);
  const limit = all ? null : checkInt(opts.limit, 'limit', LIMITS.default_limit);
  const offset = checkInt(opts.offset, 'offset', 0);

  const page = withSession(str(opts.db), (db) => queryItems(db, filters, limit, offset));
  return toEnvelope(page);
}

function toEnvelope(page: Page): Envelope {
  const items: ReturnType<typeof publicItem>[] = page.items.map((i: WorkItem) => publicItem(i));
  return { items, limit: page.limit, offset: page.offset, truncated: page.truncated };
}

export function runList(opts: Record<string, unknown>): Envelope {
  return listCore(opts);
}
