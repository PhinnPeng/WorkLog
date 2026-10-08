/**
 * `add` —— 写入一条工作项（PRD 5.2.2）。
 *
 * 跨字段冲突一律**报错、不静默纠正**：调用方是 LLM，改写参数会产生
 * "库存了没人要的值 + Agent 按原意图复述 + 无任何信号"三重不可见错误。
 * 精确的 `CONFLICT_*` 必须由 CLI 前置校验给出 —— DB 层的 `CHECK` 失败
 * 在 `node:sqlite` 下恒为 errcode 275，分不出是哪条约束（D39）。
 */
import { ulid } from 'ulid';
import { CONFIG_PATH, readConfig } from '../../locations.js';
import { inImmediateTx, withSession } from '../../db/session.js';
import { insertItem, publicItem, type ItemType, type PublicItem, type WorkItem } from '../../db/items.js';
import { fromSqliteError, Code, WorkReportError } from '../errors.js';
import {
  checkContent,
  checkDate,
  checkEnum,
  checkTime,
  readStdinContent,
  todayLocal,
} from '../validate.js';
import { ITEM_TYPES, SOURCES, STATUSES } from '../spec.js';
import { assertRowCoherent } from '../rowchecks.js';

/** 状态缺省值：显式 flag > 配置的 `default_status`（仅对 log 生效）> 类型默认。 */
function fallbackStatus(itemType: ItemType, configStatus?: string | null): string {
  if (itemType === 'plan') return 'planned';
  if (configStatus === undefined || configStatus === null) return 'done';
  if (!STATUSES.includes(configStatus as (typeof STATUSES)[number])) {
    throw new WorkReportError(Code.CONFIG_INVALID, `config.default_status 取值非法：${configStatus}`, {
      path: CONFIG_PATH,
      allowed_values: STATUSES,
    });
  }
  return configStatus;
}

export function runAdd(opts: Record<string, unknown>): PublicItem {
  const raw = String(opts.content);
  // `--content -` 是 stdin 通道（5.2.2）：长内容／含引号内容不必挤进命令行。
  const content = checkContent(raw === '-' ? readStdinContent() : raw);

  const itemType = checkEnum(
    opts.itemType === undefined ? 'log' : String(opts.itemType),
    ITEM_TYPES,
    'item_type',
  );
  const date =
    opts.date === undefined ? todayLocal() : checkDate(String(opts.date), 'date');
  const time = opts.time === undefined ? null : checkTime(String(opts.time));
  const plannedFor =
    opts.plannedFor === undefined ? null : checkDate(String(opts.plannedFor), 'planned_for');
  const source = checkEnum(
    opts.source === undefined ? 'user' : String(opts.source),
    SOURCES,
    'source',
  );

  const { config } = readConfig();
  const givenCategory: string | undefined =
    opts.category === undefined
      ? config.default_category ?? undefined
      : String(opts.category);
  // 空白分类按"未分类"入库（NULL），而不是存一个看不见摸不着的空字符串分组。
  const category =
    givenCategory === undefined || givenCategory.trim() === '' ? null : givenCategory;

  const status = checkEnum(
    opts.status === undefined ? fallbackStatus(itemType, config.default_status) : String(opts.status),
    STATUSES,
    'status',
  );

  assertRowCoherent({ item_type: itemType, status, planned_for: plannedFor });

  const now = new Date().toISOString();
  const item: WorkItem = {
    id: ulid(),
    item_type: itemType,
    date,
    time,
    content,
    category,
    status,
    source,
    planned_for: plannedFor,
    created_at: now,
    updated_at: now,
    deleted_at: null,
  };

  const dbFlag = opts.db === undefined ? undefined : String(opts.db);
  try {
    return withSession(dbFlag, (db) =>
      inImmediateTx(db, () => {
        insertItem(db, item);
        return publicItem(item);
      }),
    );
  } catch (e) {
    throw fromSqliteError(e);
  }
}
