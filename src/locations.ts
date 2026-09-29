/**
 * 位置解析（PRD 5.3、5.3.0、5.4、第 8 节）。
 *
 * 优先级写死为唯一一条链：
 *   --db > WORKREPORT_HOME > config.data_dir > env-paths 平台默认
 *
 * 配置解析失败**不静默回落默认值**（D31）：回落会把一次配置写错表现成
 * "历史记录全没了"，是最难排查的故障形态。
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import envPaths from 'env-paths';
import { Code, WorkReportError } from './cli/errors.js';
import { expandPath } from './cli/paths.js';

const APP = 'workreport';
const paths = envPaths(APP, { suffix: '' });

export const CONFIG_PATH = join(paths.config, 'config.json');
export const DEFAULT_DATA_DIR = paths.data;

export interface FileConfig {
  data_dir?: string;
  default_category?: string | null;
  default_status?: string | null;
  default_format?: 'json' | 'table' | 'markdown';
}

export function readConfig(): { config: FileConfig; problem?: string } {
  if (!existsSync(CONFIG_PATH)) return { config: {} };
  let raw: string;
  try {
    raw = readFileSync(CONFIG_PATH, 'utf8');
  } catch (e) {
    throw new WorkReportError(Code.CONFIG_INVALID, `无法读取配置文件：${(e as Error).message}`);
  }
  try {
    const parsed = JSON.parse(raw) as FileConfig;
    return { config: parsed };
  } catch (e) {
    // 不回落：让调用方以 CONFIG_INVALID 退出（退出码 3，Agent 不应重试）。
    throw new WorkReportError(
      Code.CONFIG_INVALID,
      `config.json 不是合法 JSON：${(e as Error).message}`,
      { path: CONFIG_PATH, hint: '修正或删除该文件后重试' },
    );
  }
}

/** 返回 { dataDir, dbPath, source } —— source 标明这一轮实际由哪一层决定的。 */
export function resolveLocation(dbFlag?: string): {
  dataDir: string;
  dbPath: string;
  source: 'flag' | 'env' | 'config' | 'default';
} {
  if (dbFlag) {
    // --db 给的是**数据库文件路径**（PRD 5.2.0），数据目录取其所在目录。
    const file = expandPath(dbFlag, { requireAbsolute: true });
    return { dataDir: dirname(file), dbPath: file, source: 'flag' };
  }
  const env = process.env.WORKREPORT_HOME;
  if (env) {
    const dir = expandPath(env, { requireAbsolute: true });
    return { dataDir: dir, dbPath: join(dir, `${APP}.db`), source: 'env' };
  }
  const { config } = readConfig();
  if (config.data_dir) {
    const dir = expandPath(String(config.data_dir), { requireAbsolute: true });
    return { dataDir: dir, dbPath: join(dir, `${APP}.db`), source: 'config' };
  }
  const dir = expandPath(DEFAULT_DATA_DIR, { requireAbsolute: true });
  return { dataDir: dir, dbPath: join(dir, `${APP}.db`), source: 'default' };
}
