/**
 * `search` —— 与 `list --keyword` 共用 `listCore`（PRD 5.2.8：不得各持一份 SQL）。
 */
import { listCore, type Envelope } from './list.js';

export function runSearch(opts: Record<string, unknown>): Envelope {
  return listCore(opts);
}
