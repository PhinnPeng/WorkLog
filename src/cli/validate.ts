/**
 * 字段级校验（PRD 5.1.4、5.7.3）。
 *
 * 校验正则与 DDL 的 `GLOB` 逐条同形 —— DB 层是兜底，CLI 层负责给出精确错误码。
 * 枚举非法值由这里裁决成 VALIDATION_ERROR（退出 1），而不是让 commander
 * 以 USAGE_ERROR（退出 2）拦下：按 5.7.3，"枚举值非法"属业务校验，
 * Agent 改参数即可重试。
 */
import { readFileSync } from 'node:fs';
import { Code, WorkReportError } from './errors.js';
import { LIMITS } from './spec.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

/** 本地日历日 `YYYY-MM-DD`：`--date` 缺省值与 `--overdue` 的"今天"都取它（5.2.2、5.2.3）。 */
export function todayLocal(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function checkDate(value: string, field: string): string {
  if (!DATE_RE.test(value)) {
    throw new WorkReportError(Code.VALIDATION_ERROR, `${field} 不是 YYYY-MM-DD：${value}`, {
      field,
      hint: '示例 2026-09-23',
    });
  }
  return value;
}

export function checkTime(value: string, field = 'time'): string {
  if (!TIME_RE.test(value)) {
    throw new WorkReportError(Code.VALIDATION_ERROR, `${field} 不是 HH:MM：${value}`, {
      field,
      hint: '示例 10:30',
    });
  }
  return value;
}

export function checkEnum<T extends string>(
  value: string,
  allowed: readonly T[],
  field: string,
): T {
  if (!allowed.includes(value as T)) {
    throw new WorkReportError(
      Code.VALIDATION_ERROR,
      `${field} 取值非法：${value}（可选 ${allowed.join('|')}）`,
      { field, allowed_values: allowed },
    );
  }
  return value as T;
}

/** `--content` 的空值与超长都在这里裁决；超长带 5.1.4 指定的 stdin 提示。 */
export function checkContent(value: unknown): string {
  if (typeof value !== 'string') {
    throw new WorkReportError(Code.VALIDATION_ERROR, 'content 必须是字符串', { field: 'content' });
  }
  if (value.trim() === '') {
    throw new WorkReportError(Code.VALIDATION_ERROR, 'content 不能为空', { field: 'content' });
  }
  if (value.length > LIMITS.content_max_chars) {
    throw new WorkReportError(
      Code.VALIDATION_ERROR,
      `content 超出 ${LIMITS.content_max_chars} 字符上限（实际 ${value.length}）`,
      { field: 'content', hint: 'use --content - with stdin' },
    );
  }
  return value;
}

/**
 * `--content -` 从 stdin 读（5.2.2）：Agent 拼命令行时嵌套引号在 cmd.exe 下
 * 是真实故障源，故长内容／含换行内容走标准输入。行尾换行按原样去除。
 */
export function readStdinContent(): string {
  try {
    return readFileSync(0, 'utf8').replace(/\n$/, '');
  } catch (e) {
    throw new WorkReportError(Code.VALIDATION_ERROR, `无法从 stdin 读取 content：${(e as Error).message}`, {
      field: 'content',
      hint: '确认标准输入已重定向（管道或文件）',
    });
  }
}

/** `--limit` / `--offset`：非负整数，否则 VALIDATION_ERROR。 */
export function checkInt(value: unknown, field: string, fallback: number): number {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) {
    throw new WorkReportError(Code.VALIDATION_ERROR, `${field} 必须是非负整数：${String(value)}`, {
      field,
    });
  }
  return n;
}

/** 可选字符串 flag：空串按"未提供"处理（`--category ""` 不该建成空分类）。 */
export function optionalFlag(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new WorkReportError(Code.VALIDATION_ERROR, `${field} 必须是字符串`, { field });
  }
  return value;
}
