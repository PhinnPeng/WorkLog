/**
 * `--format` 的生效链（PRD 5.2.0、5.4、5.6）。
 *
 * 优先级：显式 `--format` > `config.default_format` > `json`。
 * 配置里的值非法**不静默回落**（D31）：回落会把一次配置写错表现成
 * "输出忽然变了却没人知道为什么"，与 data_dir 非法时同一判据。
 */
import { CONFIG_PATH, readConfig } from '../locations.js';
import { Code, WorkReportError } from './errors.js';
import { FORMATS } from './spec.js';

export type FormatSource = 'flag' | 'config' | 'default';

export interface ResolvedFormat {
  format: string;
  source: FormatSource;
}

export function resolveFormat(flagValue: unknown): ResolvedFormat {
  if (typeof flagValue === 'string') return { format: flagValue, source: 'flag' };
  const { config } = readConfig();
  const fromConfig = config.default_format;
  if (fromConfig === undefined || fromConfig === null) return { format: 'json', source: 'default' };
  if (!(FORMATS as readonly string[]).includes(fromConfig)) {
    throw new WorkReportError(
      Code.CONFIG_INVALID,
      `config.default_format 取值非法：${String(fromConfig)}`,
      { path: CONFIG_PATH, allowed_values: FORMATS, hint: '只接受 json|table|markdown' },
    );
  }
  return { format: fromConfig, source: 'config' };
}
