/**
 * 从 src/cli/errors.ts 抽取错误码清单 —— eslint.config.js 与 test/gates.test.ts 共用。
 *
 * 存在的理由就是消除"清单抄两遍"：eslint 需要码名来禁字面量，测试需要码名来断言
 * eslint 的抽取没有静默变成空集（空集等于规则空转，看起来仍是绿的）。
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ERRORS_TS = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'cli', 'errors.ts');
const PATTERN = /^ {2}([A-Z][A-Z0-9_]+): '[A-Z][A-Z0-9_]+',$/gm;

/** @returns {string[]} Code 枚举的成员名，按源码顺序 */
export function extractErrorCodes() {
  return [...readFileSync(ERRORS_TS, 'utf8').matchAll(PATTERN)].map((m) => m[1]);
}

export const WORKREPORT_ERROR_CODES = extractErrorCodes();
