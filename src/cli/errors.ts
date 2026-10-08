/**
 * 错误码的单点定义 —— 全仓库只有这里允许出现错误码字符串字面量（门禁 A）。
 * 依据 PRD 5.7.1（码表是稳定 API）、5.7.2（退出码按"谁能修"分档）、D39。
 */

export const Code = {
  USAGE_ERROR: 'USAGE_ERROR',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  CONFLICT_STATUS_PLANNED_FOR_LOG: 'CONFLICT_STATUS_PLANNED_FOR_LOG',
  CONFLICT_PLANNED_FOR_ON_LOG: 'CONFLICT_PLANNED_FOR_ON_LOG',
  CONFLICT_PLAN_MISSING_PLANNED_FOR: 'CONFLICT_PLAN_MISSING_PLANNED_FOR',
  NOT_FOUND: 'NOT_FOUND',
  AMBIGUOUS_ID: 'AMBIGUOUS_ID',
  CONVERT_SOURCE_TYPE_MISMATCH: 'CONVERT_SOURCE_TYPE_MISMATCH',
  DELETED: 'DELETED',
  PATH_EXISTS: 'PATH_EXISTS',
  DB_LOCKED: 'DB_LOCKED',
  DB_CORRUPT: 'DB_CORRUPT',
  DB_NOT_INITIALIZED: 'DB_NOT_INITIALIZED',
  SCHEMA_TOO_NEW: 'SCHEMA_TOO_NEW',
  MIGRATION_FAILED: 'MIGRATION_FAILED',
  PATH_NOT_WRITABLE: 'PATH_NOT_WRITABLE',
  CONFIG_INVALID: 'CONFIG_INVALID',
  RUNTIME_UNSUPPORTED: 'RUNTIME_UNSUPPORTED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type Code = (typeof Code)[keyof typeof Code];

/** 退出码分档（PRD 5.7.2）：0 成功 / 1 业务校验 / 2 用法 / 3 环境。 */
const EXIT_BY_CODE: Record<Code, 1 | 2 | 3> = {
  USAGE_ERROR: 2,
  VALIDATION_ERROR: 1,
  CONFLICT_STATUS_PLANNED_FOR_LOG: 1,
  CONFLICT_PLANNED_FOR_ON_LOG: 1,
  CONFLICT_PLAN_MISSING_PLANNED_FOR: 1,
  NOT_FOUND: 1,
  AMBIGUOUS_ID: 1,
  CONVERT_SOURCE_TYPE_MISMATCH: 1,
  DELETED: 1,
  PATH_EXISTS: 1,
  DB_LOCKED: 3,
  DB_CORRUPT: 3,
  DB_NOT_INITIALIZED: 3,
  SCHEMA_TOO_NEW: 3,
  MIGRATION_FAILED: 3,
  PATH_NOT_WRITABLE: 3,
  CONFIG_INVALID: 3,
  // 宿主 Node 不支持本工具所需的运行时能力（如无需 flag 的 node:sqlite）。
  // 归 3：这是环境错，Agent 无法自行修复，须交回人类换运行时。
  RUNTIME_UNSUPPORTED: 3,
  INTERNAL_ERROR: 3,
};

export function exitCodeOf(code: Code): number {
  return EXIT_BY_CODE[code];
}

export class WorkReportError extends Error {
  constructor(
    readonly code: Code,
    message: string,
    /** 可选字段（PRD 5.2.1）：field / hint / matches 等，增删为 minor。 */
    readonly extra?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'WorkReportError';
  }
}

/**
 * 把 node:sqlite 抛出的错误映射进契约。
 *
 * 关键实测事实（D39）：`err.code` 恒为笼统的 `ERR_SQLITE_ERROR`，**只有
 * `err.errcode` 可分支**；且所有 CHECK 违规的 errcode 都是 275，无法区分
 * 是哪条约束 —— 因此精确的 CONFLICT_* 必须由 CLI 前置校验产生，这里只兜底。
 */
const SQLITE_ERRCODE_TO_CODE: Record<number, Code> = {
  5: Code.DB_LOCKED, // SQLITE_BUSY
  6: Code.DB_LOCKED, // SQLITE_LOCKED
  8: Code.DB_CORRUPT, // SQLITE_READONLY
  11: Code.DB_CORRUPT, // SQLITE_CORRUPT
  14: Code.PATH_NOT_WRITABLE, // SQLITE_CANTOPEN
  26: Code.DB_NOT_INITIALIZED, // SQLITE_NOTADB（不是本工具的库）
  275: Code.VALIDATION_ERROR, // SQLITE_CONSTRAINT_CHECK
};

export function fromSqliteError(err: unknown, fallback = Code.INTERNAL_ERROR): WorkReportError {
  if (err instanceof WorkReportError) return err;
  const errcode = (err as { errcode?: number })?.errcode;
  const raw = err instanceof Error ? err.message : String(err);
  const mapped = typeof errcode === 'number' ? SQLITE_ERRCODE_TO_CODE[errcode] : undefined;
  const code: Code =
    mapped ??
    (errcode === 1 && /no such table: (main\.)?work_items/i.test(raw)
      ? Code.DB_NOT_INITIALIZED
      : fallback);
  return new WorkReportError(code, raw);
}
