/**
 * M1 命令面端到端契约测试（AC-5 的 CONFLICT_* 逐类、5.2.1 信封、5.2.3 分页与
 * 全序、5.2.8 检索同源、5.1.3 短前缀解析）。
 *
 * 与 cli.test.ts 同一套纪律：一律经 execFile 跑真实构建产物，不经 shell。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const run = promisify(execFile);
const BIN = resolve('dist/index.js');

let sandbox: string;
let db: string;

beforeAll(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'wl-cmd-'));
  db = join(sandbox, 'workreport.db');
});
afterAll(() => rmSync(sandbox, { recursive: true, force: true }));

async function cli(args: string[], input?: string) {
  try {
    const child = run(process.execPath, [BIN, '--db', db, ...args], {
      shell: false,
      maxBuffer: 8 << 20,
    });
    if (input !== undefined) child.child.stdin?.end(input);
    const { stdout, stderr } = await child;
    return { stdout, stderr, code: 0 };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; code?: number };
    return { stdout: err.stdout ?? '', stderr: err.stderr ?? '', code: err.code ?? 1 };
  }
}

/** 解析 stdout（数据体），断言它本身可 JSON.parse。 */
function json<T = unknown>(stdout: string): T {
  return JSON.parse(stdout) as T;
}

interface ItemLike {
  id: string;
  item_type: string;
  date: string;
  time: string | null;
  content: string;
  category: string | null;
  status: string;
  source: string;
  planned_for: string | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string;
}

interface ErrorPayload {
  error: string;
  code: string;
  field?: string;
  hint?: string;
  matches?: string[];
}

async function add(args: string[], input?: string) {
  const r = await cli(['add', ...args], input);
  return r;
}

describe('add · 单对象输出（5.2.1、5.2.2）', () => {
  it('返回新工作项，活记录不带 deleted_at', async () => {
    const { stdout, code } = await add(['--content', '完成登录接口联调', '--category', 'A项目']);
    expect(code).toBe(0);
    const item = json<ItemLike>(stdout);
    expect(item.id).toHaveLength(26);
    expect(item.item_type).toBe('log');
    expect(item.status).toBe('done'); // log 的类型默认
    expect(item.source).toBe('user');
    expect(item.created_at).toMatch(/Z$/);
    expect('deleted_at' in item).toBe(false);
  });

  it('--content - 从 stdin 读，内部换行保留、行尾单个换行去掉', async () => {
    const { stdout, code } = await add(['--content', '-', '--category', 'A项目'], '第一行\n第二行\n');
    expect(code).toBe(0);
    expect(json<ItemLike>(stdout).content).toBe('第一行\n第二行');
  });

  it('plan 缺 --planned-for → CONFLICT_PLAN_MISSING_PLANNED_FOR、退出 1', async () => {
    const { stderr, code } = await add(['--content', '评审报表导出', '--item-type', 'plan']);
    expect(code).toBe(1);
    expect(json<ErrorPayload>(stderr).code).toBe('CONFLICT_PLAN_MISSING_PLANNED_FOR');
  });

  it('log + status planned → CONFLICT_STATUS_PLANNED_FOR_LOG、退出 1', async () => {
    const { stderr, code } = await add(['--content', '矛盾写法', '--item-type', 'log', '--status', 'planned']);
    expect(code).toBe(1);
    expect(json<ErrorPayload>(stderr).code).toBe('CONFLICT_STATUS_PLANNED_FOR_LOG');
  });

  it('log + planned-for → CONFLICT_PLANNED_FOR_ON_LOG、退出 1', async () => {
    const { stderr, code } = await add(['--content', '矛盾写法', '--item-type', 'log', '--planned-for', '2026-10-01']);
    expect(code).toBe(1);
    expect(json<ErrorPayload>(stderr).code).toBe('CONFLICT_PLANNED_FOR_ON_LOG');
  });

  it('三类冲突都不写库（无静默纠正、也无半落库）', async () => {
    const { stdout } = await cli(['list', '--keyword', '矛盾写法']);
    expect(json<{ items: unknown[] }>(stdout).items).toHaveLength(0);
  });

  it('plan 带 planned-for 时 status 默认 planned', async () => {
    const { stdout } = await add(['--content', '评审导出方案', '--item-type', 'plan', '--planned-for', '2026-10-02']);
    const item = json<ItemLike>(stdout);
    expect(item.item_type).toBe('plan');
    expect(item.status).toBe('planned');
    expect(item.planned_for).toBe('2026-10-02');
  });

  it('content 超上限 → VALIDATION_ERROR 且 hint 指向 stdin（5.1.4）', async () => {
    const { stderr, code } = await add(['--content', 'x'.repeat(2001)]);
    expect(code).toBe(1);
    const e = json<ErrorPayload>(stderr);
    expect(e.code).toBe('VALIDATION_ERROR');
    expect(e.hint).toBe('use --content - with stdin');
  });

  it('缺必填 --content → 框架层 USAGE_ERROR、退出 2（5.7.3）', async () => {
    const { stderr, code } = await cli(['add']);
    expect(code).toBe(2);
    expect(json<ErrorPayload>(stderr).code).toBe('USAGE_ERROR');
  });

  it('业务枚举非法 → VALIDATION_ERROR 退出 1，不是用法错', async () => {
    const { stderr, code } = await add(['--content', 'x', '--status', 'nope']);
    expect(code).toBe(1);
    expect(json<ErrorPayload>(stderr).code).toBe('VALIDATION_ERROR');
  });

  it('date / planned-for 格式非法 → VALIDATION_ERROR 并带 field', async () => {
    const { stderr, code } = await add(['--content', 'x', '--date', '2026-9-3']);
    expect(code).toBe(1);
    const e = json<ErrorPayload>(stderr);
    expect(e.code).toBe('VALIDATION_ERROR');
    expect(e.field).toBe('date');
  });
});

describe('list · 信封、全序与分页（5.2.1、5.2.3）', () => {
  it('信封字段齐备；limit+1 探测出 truncated', async () => {
    const { stdout, code } = await cli(['list', '--limit', '2']);
    expect(code).toBe(0);
    const env = json<{ items: ItemLike[]; limit: number; offset: number; truncated: boolean }>(stdout);
    expect(env.items).toHaveLength(2);
    expect(env.limit).toBe(2);
    expect(env.offset).toBe(0);
    expect(env.truncated).toBe(true);
  });

  it('翻页不重不漏：逐页翻到 truncated=false 恰好覆盖全量', async () => {
    const all = json<{ items: ItemLike[] }>((await cli(['list', '--all'])).stdout).items.map((i) => i.id);
    const paged: string[] = [];
    let truncated = true;
    let guard = 0;
    while (truncated && guard++ < 20) {
      const page = json<{ items: ItemLike[]; truncated: boolean }>(
        (await cli(['list', '--limit', '2', '--offset', String(paged.length)])).stdout,
      );
      paged.push(...page.items.map((i) => i.id));
      truncated = page.truncated;
    }
    expect(new Set(paged).size).toBe(paged.length); // 无重复
    expect(paged).toEqual(all); // 不漏、不增、次序与全量一致
  });

  it('排序是 date DESC, time DESC NULLS LAST 的全序', async () => {
    await add(['--content', '晚登记但无时刻', '--date', '2026-09-20']);
    await add(['--content', '早登记但有时刻', '--date', '2026-09-20', '--time', '08:00']);
    const items = json<{ items: ItemLike[] }>((await cli(['list', '--date', '2026-09-20'])).stdout).items;
    expect(items.map((i) => i.content)).toEqual(['早登记但有时刻', '晚登记但无时刻']);
  });

  it('--date 与 --from/--to 互斥，不做静默裁决', async () => {
    const { stderr, code } = await cli(['list', '--date', '2026-09-20', '--from', '2026-09-01']);
    expect(code).toBe(1);
    const e = json<ErrorPayload>(stderr);
    expect(e.code).toBe('VALIDATION_ERROR');
    expect(e.field).toBe('date');
  });

  it('空结果是信封空集合、退出 0，不是错误（5.2.1）', async () => {
    const { stdout, stderr, code } = await cli(['list', '--category', '不存在的分类']);
    expect(code).toBe(0);
    expect(stderr).toBe('');
    expect(json<{ items: unknown[]; truncated: boolean }>(stdout)).toMatchObject({
      items: [],
      truncated: false,
    });
  });

  it('--overdue 只捞过期未完的计划', async () => {
    await add(['--content', '过期未做的计划', '--item-type', 'plan', '--planned-for', '2020-01-01']);
    await add(['--content', '未来的计划', '--item-type', 'plan', '--planned-for', '2999-01-01']);
    const items = json<{ items: ItemLike[] }>((await cli(['list', '--overdue', '--all'])).stdout).items;
    expect(items.map((i) => i.content)).toContain('过期未做的计划');
    expect(items.map((i) => i.content)).not.toContain('未来的计划');
    expect(items.every((i) => i.item_type === 'plan')).toBe(true);
  });
});

describe('search · 与 list --keyword 同源，且转义元字符（5.2.8、5.3.1）', () => {
  it('同一关键词的两种入口结果完全一致', async () => {
    const viaSearch = json<{ items: ItemLike[] }>((await cli(['search', '--keyword', '登录'])).stdout).items;
    const viaList = json<{ items: ItemLike[] }>((await cli(['list', '--keyword', '登录'])).stdout).items;
    expect(viaSearch.map((i) => i.id)).toEqual(viaList.map((i) => i.id));
    expect(viaSearch.length).toBeGreaterThan(0);
  });

  it('关键词里的 % 按字面匹配，不当通配符', async () => {
    await add(['--content', '覆盖率 100% 达成']);
    const hits = json<{ items: ItemLike[] }>((await cli(['search', '--keyword', '100%'])).stdout).items;
    expect(hits).toHaveLength(1);
    // 若 % 未转义，"100x" 会借通配符命中同一行
    const fake = json<{ items: unknown[] }>((await cli(['search', '--keyword', '100x'])).stdout).items;
    expect(fake).toHaveLength(0);
  });

  it('空白关键词报 VALIDATION_ERROR，不退化成全表', async () => {
    const { stderr, code } = await cli(['search', '--keyword', '   ']);
    expect(code).toBe(1);
    expect(json<ErrorPayload>(stderr).code).toBe('VALIDATION_ERROR');
  });

  it('缺必填 --keyword → USAGE_ERROR 退出 2', async () => {
    const { code } = await cli(['search']);
    expect(code).toBe(2);
  });
});

describe('show · ULID 短前缀解析（5.1.3）', () => {
  it('唯一前缀命中整条记录', async () => {
    const created = json<ItemLike>((await add(['--content', '带唯一前缀的条目'])).stdout);
    const shown = json<ItemLike>((await cli(['show', '--id', created.id.slice(0, 20)])).stdout);
    expect(shown.id).toBe(created.id);
  });

  it('前缀命中多条 → AMBIGUOUS_ID，matches 给完整 id（短前缀本身正是歧义源）', async () => {
    // 不能假设"相邻两次录入必然共享前 8 字符"：ULID 的 8 字符覆盖约 4096ms 的粗粒度
    // 时间桶，两次录入（各自要起一个 node 进程，慢机器上间隔数百毫秒）刚好跨在桶边界
    // 上时前缀就不同 —— CI 上实测撞出 '01M3NVR9' vs '01M3NVRA'，约 12% 概率。
    // 改为连续录入若干条，按实际前缀分组找一对真正共享前缀的。
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) {
      ids.push(json<ItemLike>((await add(['--content', `紧邻录入${i}`])).stdout).id);
    }
    const byPrefix = new Map<string, string[]>();
    for (const id of ids) {
      const key = id.slice(0, 8);
      byPrefix.set(key, [...(byPrefix.get(key) ?? []), id]);
    }
    const colliding = [...byPrefix.entries()].find(([, group]) => group.length > 1);
    expect(colliding, `六次连续录入都没有落在同一时间桶：${ids.join(', ')}`).toBeDefined();

    const [prefix, group] = colliding!;
    const { stderr, code } = await cli(['show', `--id`, prefix]);
    expect(code).toBe(1);
    const e = json<ErrorPayload>(stderr);
    expect(e.code).toBe('AMBIGUOUS_ID');
    expect(e.matches).toEqual(expect.arrayContaining(group));
    expect(e.matches?.every((m) => m.length === 26)).toBe(true);
  });

  it('无匹配 → NOT_FOUND 退出 1', async () => {
    const { stderr, code } = await cli(['show', '--id', 'ZZZZZZZZ']);
    expect(code).toBe(1);
    expect(json<ErrorPayload>(stderr).code).toBe('NOT_FOUND');
  });

  it('26 位完整 id 永远合法（大小写不敏感）', async () => {
    const created = json<ItemLike>((await add(['--content', '大小写前缀'])).stdout);
    const shown = json<ItemLike>((await cli(['show', '--id', created.id.toLowerCase()])).stdout);
    expect(shown.id).toBe(created.id);
  });
});

describe('categories · 分类归一化数据源（5.2.12）', () => {
  it('输出分类与条目数，无分类的行不计入', async () => {
    await add(['--content', '归一化甲', '--category', '信息部事务']);
    const list = json<Array<{ category: string; count: number }>>((await cli(['categories'])).stdout);
    expect(list.some((c) => c.category === '信息部事务')).toBe(true);
    expect(list.every((c) => c.category !== null)).toBe(true);
    expect(list.reduce((s, c) => s + c.count, 0)).toBeLessThanOrEqual(
      json<{ items: ItemLike[] }>((await cli(['list', '--all'])).stdout).items.length,
    );
  });

  it('--prefix 支持前缀查漏', async () => {
    const list = json<Array<{ category: string }>>((await cli(['categories', '--prefix', '信息'])).stdout);
    expect(list.map((c) => c.category)).toEqual(['信息部事务']);
  });
});

describe('--format 呈现层（5.6）', () => {
  it('table 输出人类表格：固定表头 + 12 字符短 ID（D46）', async () => {
    const { stdout, code } = await cli(['list', '--limit', '1', '--format', 'table']);
    expect(code).toBe(0);
    expect(stdout).toContain('ID');
    expect(stdout).toContain('内容');
    expect(() => JSON.parse(stdout)).toThrow();
    const first = json<{ items: ItemLike[] }>((await cli(['list', '--limit', '1'])).stdout).items[0]!;
    expect(stdout).toContain(first.id.slice(0, 12));
    expect(stdout).not.toContain(first.id); // 表格里不给完整 26 位
  });

  it('markdown 每行一条 `- [日期] 内容 (分类)`', async () => {
    const { stdout } = await cli(['list', '--limit', '1', '--format', 'markdown']);
    expect(stdout.trimStart()).toMatch(/^- \[\d{4}-\d{2}-\d{2}\] /);
  });

  it('table 里的换行被压成空格，不破表', async () => {
    const { stdout } = await cli(['list', '--keyword', '第二行', '--format', 'table']);
    const bodyLines = stdout.trimEnd().split('\n').slice(2);
    expect(bodyLines).toHaveLength(1);
  });

  it('空集合在 table 下是「无记录」，退出码仍为 0', async () => {
    const { stdout, code } = await cli(['list', '--category', '压根没有的分类', '--format', 'table']);
    expect(code).toBe(0);
    expect(stdout.trim()).toBe('无记录');
  });

  it('错误对象不随 --format 变成表格（D3）', async () => {
    const { stderr, code } = await cli(['show', '--id', 'ZZZZZZZZ', '--format', 'table']);
    expect(code).toBe(1);
    expect(stderr.trimEnd().split('\n')).toHaveLength(1);
    expect(json<ErrorPayload>(stderr).code).toBe('NOT_FOUND');
  });
});

describe('describe · 命令面同源（5.2.14）', () => {
  it('M1 的五个命令都进了自描述', async () => {
    const d = json<{ commands: Array<{ name: string; flags: Array<{ declaration: string; required?: boolean }> }> }>(
      (await cli(['describe'])).stdout,
    );
    const names = d.commands.map((c) => c.name);
    for (const need of ['add', 'list', 'show', 'search', 'categories']) {
      expect(names).toContain(need);
    }
    const content = d.commands.find((c) => c.name === 'add')!.flags.find((f) => f.declaration.startsWith('--content'))!;
    expect(content.required).toBe(true);
  });
});

describe('PRD 符合性补充（5.2.14 flag 名／类型、5.3.0-4 相对路径提示、5.2.0 着色）', () => {
  interface DescribedFlag {
    name: string;
    type: string;
    declaration: string;
    values?: string[];
    required?: boolean;
  }

  it('describe 的每个 flag 带 name 与 type，取值范围随 type 出现', async () => {
    const d = json<{ commands: Array<{ name: string; flags: DescribedFlag[]; readonly: boolean }> }>(
      (await cli(['describe'])).stdout,
    );
    const add = d.commands.find((c) => c.name === 'add')!;
    expect(add.readonly).toBe(false);
    const content = add.flags.find((f) => f.name === '--content')!;
    expect(content.type).toBe('string');
    expect(content.required).toBe(true);
    const status = add.flags.find((f) => f.name === '--status')!;
    expect(status.type).toBe('enum');
    expect(status.values).toContain('done');
    const list = d.commands.find((c) => c.name === 'list')!;
    expect(list.flags.find((f) => f.name === '--all')!.type).toBe('boolean');
    // 全局层同样带名字（Agent 只读 describe 就能拼出完整调用）
    expect(add.flags.some((f) => f.name === '--db')).toBe(true);
    expect(add.flags.some((f) => f.name === '--format')).toBe(true);
  });

  it('相对 --db 按 cwd 解析，但落点必须在 stderr 讲清楚（5.3.0-4）', async () => {
    // realpathSync：macOS 的 tmpdir 是 /var/…（指向 /private/var 的符号链接），
    // 而子进程的 process.cwd() 拿到的是规范化后的真实路径，两侧必须同源才可比。
    const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'wl-rel-')));
    try {
      const { stdout, stderr } = await run(
        process.execPath,
        [BIN, '--db', 'rel.db', 'add', '--content', '相对路径写入'],
        { cwd, shell: false },
      );
      const item = json<ItemLike>(stdout);
      expect(item.content).toBe('相对路径写入');
      expect(stderr).toContain('相对路径');
      expect(stderr.replaceAll('\\', '/')).toContain(join(cwd, 'rel.db').replaceAll('\\', '/'));
      // --quiet 抑制提示，数据体不受影响
      const quiet = await run(
        process.execPath,
        [BIN, '--quiet', '--db', 'rel.db', 'show', '--id', item.id],
        { cwd, shell: false },
      );
      expect(quiet.stderr).toBe('');
      expect(json<ItemLike>(quiet.stdout).id).toBe(item.id);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('非 TTY 下 stderr 不带 ANSI 转义码；错误行永远不带（5.2.0、5.2.1）', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'wl-color-'));
    try {
      const notice = await run(
        process.execPath,
        [BIN, '--db', 'rel.db', 'add', '--content', '着色探测'],
        { cwd, shell: false },
      );
      const esc = String.fromCharCode(27);
      expect(notice.stderr).not.toContain(esc);
      const { stderr: errLine } = await cli(['show', '--id', 'ZZZZZZZZ']);
      expect(errLine).not.toContain(esc);
      expect(json<ErrorPayload>(errLine).code).toBe('NOT_FOUND');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
