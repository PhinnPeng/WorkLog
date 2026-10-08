/**
 * `config` —— 读、写与来源标注（PRD 5.4、5.2.10）。
 *
 * 一条命令三个子动作（`config set|get|list`），所以用位置参数而不是嵌套命令树：
 * 保持 `src/cli/spec.ts` 与 commander 的一对一注册，门禁 C 的同源断言才继续成立。
 *
 * `list` 必须标注每项来源（`env`/`file`/`default`）—— 否则用户无法解释
 * "为什么改了配置没生效"，而这是这份配置唯一的可辩护性。
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync, type Database } from '../../db/sqlite.js';
import { countItems } from '../../db/items.js';
import {
  CONFIG_PATH,
  DEFAULT_DATA_DIR,
  readConfig,
  resolveLocation,
  type FileConfig,
} from '../../locations.js';
import { Code, WorkReportError } from '../errors.js';
import { FORMATS, STATUSES } from '../spec.js';
import { expandPath } from '../paths.js';
import { clip, stderrIsTty, warn } from '../output.js';
import { dbFlagOf, positional } from './common.js';

type ConfigKey = keyof FileConfig;
const KEYS: readonly ConfigKey[] = ['data_dir', 'default_category', 'default_status', 'default_format'];

export type ConfigSource = 'env' | 'file' | 'default';
export interface EffectiveValue {
  value: string | null;
  source: ConfigSource;
}

function usageHint(allowed: readonly string[]): string {
  return `只接受 ${allowed.join(' | ')}`;
}

/** `""` 与 `null` 都表示"取消这个默认值"。 */
function nullable(value: string): string | null {
  return value.trim() === '' || value.trim().toLowerCase() === 'null' ? null : value.trim();
}

function normalize(key: ConfigKey, raw: string): string | null {
  if (key === 'data_dir') {
    // 存展开后的绝对路径（5.3.0 第 1 条）：配置文件可能被搬到另一台机器，
    // 留着 `~/x` 会让另一台机器的 `~` 指向完全不同的地方。
    return expandPath(raw, { requireAbsolute: true });
  }
  const v = nullable(raw);
  if (v === null) return null;
  if (key === 'default_status') {
    if (!STATUSES.includes(v as (typeof STATUSES)[number])) {
      throw new WorkReportError(Code.USAGE_ERROR, `default_status 取值非法：${v}`, {
        field: 'default_status',
        hint: usageHint(STATUSES),
      });
    }
    return v;
  }
  if (key === 'default_format') {
    if (!FORMATS.includes(v as (typeof FORMATS)[number])) {
      throw new WorkReportError(Code.USAGE_ERROR, `default_format 取值非法：${v}`, {
        field: 'default_format',
        hint: usageHint(FORMATS),
      });
    }
    return v;
  }
  return v;
}

function writeConfig(config: FileConfig): FileConfig {
  mkdirSync(dirname(CONFIG_PATH), { recursive: true });
  writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return config;
}

/**
 * 只读地数一个库里的条目数。库不存在给 0；读不出来给 null —— **不谎报 0**。
 * 后者是"看起来数据没了"的误报来源，而本工具整套设计都在规避这个误判。
 */
function countIn(dbPath: string): { items: number | null; deleted: number | null } {
  if (!existsSync(dbPath)) return { items: 0, deleted: 0 };
  let db: Database | undefined;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    const items = countItems(db, false);
    return { items, deleted: countItems(db, true) - items };
  } catch {
    // 不是本工具的库、或文件损坏：那不是本命令要裁决的事（doctor 负责）。
    return { items: null, deleted: null };
  } finally {
    try {
      db?.close();
    } catch {
      /* 只读连接关不掉不影响结论 */
    }
  }
}

/** 告警里的一行「路径：N 条」。路径按 5.2.1 的隐私约束设上界（同 noticeRelativeDb）。 */
function countLine(path: string, c: { items: number | null; deleted: number | null }): string {
  const shown = clip(path, 120);
  if (c.items === null) return `${shown}：读不出来（可能不是本工具的库）`;
  const tombstones = c.deleted ? `（另有 ${c.deleted} 条已删除）` : '';
  return `${shown}：${c.items} 条${tombstones}`;
}

function requireKey(raw: string | undefined): ConfigKey {
  if (raw === undefined || !KEYS.includes(raw as ConfigKey)) {
    throw new WorkReportError(Code.USAGE_ERROR, `未知的配置项：${raw ?? '(缺失)'}`, {
      field: 'key',
      hint: usageHint(KEYS),
    });
  }
  return raw as ConfigKey;
}

export function runConfig(opts: Record<string, unknown>): unknown {
  const [sub, key, value] = positional(opts);

  if (sub === 'set') {
    const name = requireKey(key);
    if (value === undefined) {
      throw new WorkReportError(Code.USAGE_ERROR, 'config set 需要 <key> <value> 两个参数', {
        hint: '取消默认值传 null，例如 config set default_category null',
      });
    }
    // readConfig 对坏文件直接抛 CONFIG_INVALID，绝不静默覆盖（D31）。
    const { config } = readConfig();
    const next = { ...config, [name]: normalize(name, value) };

    if (name !== 'data_dir') return writeConfig(next);

    // data_dir **只换落点、不搬数据**（5.2.10）。不把新旧两边的条目数摆到 stderr 上，
    // 用户改完配置的直观感受就是"历史记录全丢了"（D30）—— 本工具整套设计都在规避
    // 这个误判（D23 软删除、D29 拒绝覆盖、D31 不静默回落），这里不能例外。
    //
    // 两侧都走同一条解析链（--db > WORKREPORT_HOME > 配置 > 默认），只在写配置前后
    // 各取一次：这样 `--db`／`WORKREPORT_HOME` 压过配置时两侧相同，不会凭空报一句
    // "未迁移"（那种情况下确实什么都没变）。
    const before = resolveLocation(dbFlagOf(opts));
    writeConfig(next);
    const after = resolveLocation(dbFlagOf(opts));
    const oldSide = countIn(before.dbPath);
    const newSide = countIn(after.dbPath);

    // 与 program.ts 的呈现层同口径：--quiet 抑制，着色仅 TTY 默认开（5.2.0）。
    const presentation = { quiet: Boolean(opts.quiet), color: opts.color !== false && stderrIsTty() };
    warn(`旧库 ${countLine(before.dbPath, oldSide)}`, presentation);
    warn(`新库 ${countLine(after.dbPath, newSide)}`, presentation);
    // 只在"确实有数据留在旧库、而新库是空的"时才说这句：两侧都空就没什么可丢的。
    if (newSide.items === 0 && (oldSide.items ?? 0) > 0) {
      warn(`旧数据仍在 ${clip(before.dbPath, 120)}，本命令未迁移`, presentation);
    }
    // 恒为 false（本命令从不搬数据）；放进返回体是给 Agent 一个可断言的字段。
    return { ...next, migrated: false };
  }

  if (sub === 'get') {
    const name = requireKey(key);
    const { config } = readConfig();
    // 原样回显，不再二次解析（5.4）：里面存的已经是展开后的绝对路径。
    return { key: name, value: config[name] ?? null, path: CONFIG_PATH };
  }

  if (sub === 'list') {
    const { config } = readConfig();
    const envHome = process.env.WORKREPORT_HOME;
    const out: Record<ConfigKey, EffectiveValue> = {
      data_dir: {
        value: envHome ?? config.data_dir ?? DEFAULT_DATA_DIR,
        source: envHome ? 'env' : config.data_dir ? 'file' : 'default',
      },
      default_category: { value: config.default_category ?? null, source: config.default_category ? 'file' : 'default' },
      default_status: { value: config.default_status ?? 'done', source: config.default_status ? 'file' : 'default' },
      default_format: { value: config.default_format ?? 'json', source: config.default_format ? 'file' : 'default' },
    };
    return { path: CONFIG_PATH, exists: existsSync(CONFIG_PATH), values: out };
  }

  throw new WorkReportError(Code.USAGE_ERROR, `config 需要子命令：${sub ?? '(缺失)'}`, {
    hint: usageHint(['set', 'get', 'list']),
  });
}
