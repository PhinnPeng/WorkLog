/**
 * M2 命令面端到端契约测试（PRD 5.2.4、5.2.5、5.2.6、5.2.11）。
 * 与 cli.test.ts / commands.test.ts 同一纪律：一律 execFile 跑真实构建产物，不经 shell。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { PublicItem } from '../src/db/items.js';

const run = promisify(execFile);
const BIN = resolve('dist/index.js');

let sandbox: string;
let db: string;

beforeAll(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'wl-m2-'));
  db = join(sandbox, 'workreport.db');
});
afterAll(() => rmSync(sandbox, { recursive: true, force: true }));

async function cli(args: string[], input?: string) {
  try {
    const child = run(process.execPath, [BIN, '--db', db, ...args], { shell: false, maxBuffer: 8 << 20 });
    if (input !== undefined) child.child.stdin?.end(input);
    const { stdout, stderr } = await child;
    return { stdout, stderr, code: 0 };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; code?: number };
    return { stdout: err.stdout ?? '', stderr: err.stderr ?? '', code: err.code ?? 1 };
  }
}

const json = <T>(s: string): T => JSON.parse(s) as T;
const errOf = (stderr: string) => json<{ error: string; code: string; field?: string; hint?: string }>(stderr.trimEnd());

async function newLog(content: string, extra: string[] = []): Promise<PublicItem> {
  const { stdout, code } = await cli(['add', '--content', content, ...extra]);
  expect(code).toBe(0);
  return json<PublicItem>(stdout);
}

async function newPlan(content: string, plannedFor: string): Promise<PublicItem> {
  return newLog(content, ['--item-type', 'plan', '--planned-for', plannedFor]);
}

describe('update（5.2.4）', () => {
  it('只改传入字段，并刷新 updated_at', async () => {
    const item = await newPlan('update：改状态', '2026-12-01');
    const { stdout, code } = await cli(['update', '--id', item.id, '--status', 'in_progress']);
    expect(code).toBe(0);
    const after = json<PublicItem>(stdout);
    expect(after.status).toBe('in_progress');
    expect(after.planned_for).toBe('2026-12-01'); // 没传的字段不动
    expect(after.updated_at >= item.updated_at).toBe(true);
  });

  it('传 --item-type → USAGE_ERROR 退出 2，hint 指向 convert（5.2.4）', async () => {
    const item = await newLog('update：拒绝跨类型');
    const { stderr, code } = await cli(['update', '--id', item.id, '--item-type', 'plan']);
    expect(code).toBe(2);
    const e = errOf(stderr);
    expect(e.code).toBe('USAGE_ERROR');
    expect(e.hint).toContain('convert');
  });

  it('判"更新后的整行"：给 log 加 planned-for → CONFLICT_PLANNED_FOR_ON_LOG', async () => {
    const item = await newLog('update：一致性');
    const { stderr, code } = await cli(['update', '--id', item.id, '--planned-for', '2026-12-02']);
    expect(code).toBe(1);
    expect(errOf(stderr).code).toBe('CONFLICT_PLANNED_FOR_ON_LOG');
    // 报错即回滚，库里仍是原样
    const shown = json<PublicItem>((await cli(['show', '--id', item.id])).stdout);
    expect(shown.planned_for).toBeNull();
  });

  it('把 plan 的 planned-for 清空 → 整行不合法，报 CONFLICT_PLAN_MISSING_PLANNED_FOR', async () => {
    const item = await newPlan('update：清空归属日', '2026-12-03');
    const { stderr, code } = await cli(['update', '--id', item.id, '--planned-for', '']);
    expect(code).toBe(1);
    expect(errOf(stderr).code).toBe('CONFLICT_PLAN_MISSING_PLANNED_FOR');
  });

  it('不存在的 id → NOT_FOUND；一个字段都没给 → VALIDATION_ERROR', async () => {
    // 参数校验走在解析 id 之前（不必为一句"你没给字段"去开库），所以 NOT_FOUND
    // 这条要带上新内容才能命中 id 解析分支。
    const missing = await cli(['update', '--id', '01ARZ3NDEKTSV4RRFFQ69G5FAV', '--content', '无处可改']);
    expect(missing.code).toBe(1);
    expect(errOf(missing.stderr).code).toBe('NOT_FOUND');

    const item = await newLog('update：空改动');
    const empty = await cli(['update', '--id', item.id]);
    expect(empty.code).toBe(1);
    expect(errOf(empty.stderr).code).toBe('VALIDATION_ERROR');
  });
});

describe('convert（5.2.5）', () => {
  it('--to log 缺 --date 时报错，不自动补日期', async () => {
    const plan = await newPlan('convert：缺日期', '2026-12-04');
    const { stderr, code } = await cli(['convert', '--id', plan.id]);
    expect(code).toBe(1);
    const e = errOf(stderr);
    expect(e.code).toBe('VALIDATION_ERROR');
    expect(e.field).toBe('date');
  });

  it('plan → log：唯一允许推导处，status 取 done、planned_for 清空', async () => {
    const plan = await newPlan('convert：转成实际记录', '2026-12-05');
    const { stdout, code } = await cli(['convert', '--id', plan.id, '--date', '2026-12-05']);
    expect(code).toBe(0);
    const after = json<PublicItem>(stdout);
    expect(after.item_type).toBe('log');
    expect(after.status).toBe('done');
    expect(after.planned_for).toBeNull();
    expect(after.date).toBe('2026-12-05');
  });

  it('log → plan：保留原 date，planned_for 必填，status 默认 planned', async () => {
    const log = await newLog('convert：转成计划', ['--date', '2026-12-06']);
    const missing = await cli(['convert', '--id', log.id, '--to', 'plan']);
    expect(missing.code).toBe(1);
    expect(errOf(missing.stderr).code).toBe('CONFLICT_PLAN_MISSING_PLANNED_FOR');

    const { stdout } = await cli(['convert', '--id', log.id, '--to', 'plan', '--planned-for', '2026-12-20']);
    const after = json<PublicItem>(stdout);
    expect(after.item_type).toBe('plan');
    expect(after.status).toBe('planned');
    expect(after.date).toBe('2026-12-06'); // date 保留原记录日，不擅自动它
    expect(after.planned_for).toBe('2026-12-20');
  });

  it('两个方向都不允许同源转换，expected/actual 进错误对象（5.7.3）', async () => {
    const a = await newPlan('convert：重复方向甲', '2026-12-07');
    const toLog = await cli(['convert', '--id', a.id, '--date', '2026-12-07']);
    expect(toLog.code).toBe(0);
    const again = await cli(['convert', '--id', a.id, '--date', '2026-12-08']);
    expect(again.code).toBe(1);
    const e = json<{ code: string; expected: string; actual: string }>(again.stderr.trimEnd());
    expect(e.code).toBe('CONVERT_SOURCE_TYPE_MISMATCH');
    expect([e.expected, e.actual]).toEqual(['log', 'log']);
  });

  it('转换结果仍要满足 5.1.1：--to log 配 --status planned 报错', async () => {
    const plan = await newPlan('convert：非法结果', '2026-12-09');
    const { stderr, code } = await cli(['convert', '--id', plan.id, '--date', '2026-12-09', '--status', 'planned']);
    expect(code).toBe(1);
    expect(errOf(stderr).code).toBe('CONFLICT_STATUS_PLANNED_FOR_LOG');
  });
});

describe('delete / restore / purge（5.2.6）', () => {
  it('--dry-run 不写库，返回将被删的条目', async () => {
    const item = await newLog('delete：干跑');
    const { stdout, code } = await cli(['delete', '--id', item.id, '--dry-run']);
    expect(code).toBe(0);
    expect(json<PublicItem>(stdout).content).toBe('delete：干跑');
    const after = json<PublicItem>((await cli(['show', '--id', item.id])).stdout);
    expect('deleted_at' in after).toBe(false);
  });

  it('真删后默认查询排除墓碑，--include-deleted 才带出', async () => {
    const item = await newLog('delete：默认可见性');
    const { stdout } = await cli(['delete', '--id', item.id]);
    expect(json<PublicItem>(stdout).deleted_at).toMatch(/Z$/);

    const dates = json<{ items: PublicItem[] }>((await cli(['list', '--keyword', '默认可见性'])).stdout).items;
    expect(dates).toHaveLength(0);
    const withTomb = json<{ items: PublicItem[] }>(
      (await cli(['list', '--keyword', '默认可见性', '--include-deleted'])).stdout,
    ).items;
    expect(withTomb).toHaveLength(1);
  });

  it('写命令对墓碑报 DELETED，而非静默新建', async () => {
    const item = await newLog('delete：墓碑写');
    await cli(['delete', '--id', item.id]);
    for (const args of [
      ['update', '--id', item.id, '--content', '改墓碑'],
      ['convert', '--id', item.id, '--date', '2026-12-10'],
    ]) {
      const { stderr, code } = await cli(args);
      expect(code).toBe(1);
      expect(errOf(stderr).code).toBe('DELETED');
    }
  });

  it('restore 复原；对未删除项报错而不是假装成功', async () => {
    const item = await newLog('restore：复原');
    await cli(['delete', '--id', item.id]);
    const back = await cli(['restore', '--id', item.id]);
    expect(back.code).toBe(0);
    expect('deleted_at' in json<PublicItem>(back.stdout)).toBe(false);

    const again = await cli(['restore', '--id', item.id]);
    expect(again.code).toBe(1);
    expect(errOf(again.stderr).code).toBe('VALIDATION_ERROR');
  });

  it('purge 双显式确认：缺 --older-than 是用法错，缺 --yes 是业务错', async () => {
    const noDays = await cli(['purge', '--yes']);
    expect(noDays.code).toBe(2);
    expect(errOf(noDays.stderr).code).toBe('USAGE_ERROR');

    const item = await newLog('purge：确认位');
    await cli(['delete', '--id', item.id]);
    const noYes = await cli(['purge', '--older-than', '0d']);
    expect(noYes.code).toBe(1);
    expect(errOf(noYes.stderr).code).toBe('VALIDATION_ERROR');
    // 缺确认位时不能有任何删除副作用
    expect(json<{ items: PublicItem[] }>((await cli(['list', '--keyword', '确认位', '--include-deleted'])).stdout).items)
      .toHaveLength(1);
  });

  it('purge 只物理删过期墓碑，活记录与其他墓碑不动', async () => {
    const doomed = await newLog('purge：将被物理删除');
    const live = await newLog('purge：活着');
    await cli(['delete', '--id', doomed.id]);
    const { stdout, code } = await cli(['purge', '--older-than', '0d', '--yes']);
    expect(code).toBe(0);
    expect(json<{ purged: number }>(stdout).purged).toBeGreaterThanOrEqual(1);
    // 活记录还在，且就是那条
    const alive = json<{ items: PublicItem[] }>((await cli(['list', '--keyword', '活着'])).stdout).items;
    expect(alive.map((i) => i.id)).toEqual([live.id]);
    expect(json<{ items: unknown[] }>((await cli(['list', '--keyword', '将被物理删除', '--include-deleted'])).stdout).items)
      .toHaveLength(0);
  });
});

describe('backup（5.2.11）', () => {
  const norm = (p: string) => p.replaceAll('\\', '/');

  it('缺省落 <data_dir>/backups/，产物是单文件且可独立打开', async () => {
    await newLog('backup：快照内容甲');
    await newLog('backup：快照内容乙');
    const { stdout, code } = await cli(['backup']);
    expect(code).toBe(0);
    const res = json<{ path: string; size_bytes: number; item_count: number }>(stdout);
    expect(norm(res.path).startsWith(`${norm(sandbox)}/backups/workreport-`)).toBe(true);
    expect(res.size_bytes).toBe(statSync(res.path).size);
    expect(res.item_count).toBeGreaterThanOrEqual(2);
    // 备份想要的是"已合并 WAL 的单文件"，不该附带 -wal/-shm
    const leftovers = readdirSync(dirname(res.path)).filter((f) => /\.db-(wal|shm)$/.test(f));
    expect(leftovers).toEqual([]);

    const snap = new DatabaseSync(res.path, { readOnly: true });
    const row = snap.prepare('SELECT COUNT(*) AS c FROM work_items').get() as { c: number | bigint };
    snap.close();
    expect(Number(row.c)).toBe(res.item_count);
  });

  it('目标已存在默认拒绝覆盖（PATH_EXISTS／退出 1），--force 才替换', async () => {
    const target = join(sandbox, 'twice.db');
    const first = json<{ path: string }>((await cli(['backup', '--output', target])).stdout);
    expect(first.path).toBe(target);

    const second = await cli(['backup', '--output', target]);
    expect(second.code).toBe(1);
    const e = json<{ code: string; path: string; hint?: string }>(second.stderr.trimEnd());
    expect(e.code).toBe('PATH_EXISTS');
    expect(e.path).toBe(target);

    await newLog('backup：force 之后写入');
    const forced = await cli(['backup', '--output', target, '--force']);
    expect(forced.code).toBe(0);
    expect(json<{ path: string }>(forced.stdout).path).toBe(target);
  });

  it('--output 的父目录不存在时自动创建', async () => {
    const abs = join(sandbox, 'given', 'nested', 'my-backup.db');
    const ok = await cli(['backup', '--output', abs]);
    expect(ok.code).toBe(0);
    expect(existsSync(abs)).toBe(true);
  });
});
