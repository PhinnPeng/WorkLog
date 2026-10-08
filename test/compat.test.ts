/**
 * 兼容性测试：四条轴的"版本之间如何共存"。
 *
 * 依据 `.trellis/tasks/10-08-compat-design/prd.md`。与既有测试同一纪律：**经
 * `execFile` 跑真实构建产物**，不经 shell —— 兼容性问题恰恰只在真实调用路径上暴露
 * （模拟出来的路径常常绕过真正会断的那一处）。
 *
 * 数据轴的两条（额外列、未知枚举值）验的是"旧 CLI 遇到新数据不炸"；配置轴验的是
 * "旧 CLI 改配置不抹掉新版本写入的键"，即降级安全；运行时轴那条**必须用真的低版本
 * Node**（`describeRuntimeRefusal`），模拟不出来 —— 详见该用例上方注释。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { loadSqlite } from '../src/db/sqlite.js';

const run = promisify(execFile);
const BIN = resolve('dist/index.js');

let sandbox: string;
let db: string;
let home: string;
let env: NodeJS.ProcessEnv;

beforeAll(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'wl-compat-'));
  db = join(sandbox, 'workreport.db');
  home = join(sandbox, 'home');
  env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    HOMEPATH: home,
    APPDATA: join(home, 'AppData', 'Roaming'),
    LOCALAPPDATA: join(home, 'AppData', 'Local'),
    XDG_CONFIG_HOME: join(home, '.config'),
    XDG_DATA_HOME: join(home, '.local', 'share'),
  };
});
afterAll(() => rmSync(sandbox, { recursive: true, force: true }));

async function cli(args: string[]) {
  try {
    const { stdout, stderr } = await run(process.execPath, [BIN, '--db', db, ...args], {
      env,
      shell: false,
      maxBuffer: 8 << 20,
    });
    return { stdout, stderr, code: 0 };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; code?: number };
    return { stdout: err.stdout ?? '', stderr: err.stderr ?? '', code: err.code ?? 1 };
  }
}

const json = <T>(s: string): T => JSON.parse(s) as T;

describe('数据轴 · 旧 CLI 遇到新结构不炸（PRD 5.1.4、5.3.2）', () => {
  it('库里多出本版本不认识的列：读得出、写得进，且不覆盖该列的值', async () => {
    // 先让真实 CLI 建库，再用驱动加一列 —— 模拟"更高版本加过字段"
    expect((await cli(['add', '--content', '加列之前的条目'])).code).toBe(0);
    const { DatabaseSync } = await loadSqlite();
    const raw = new DatabaseSync(db);
    raw.exec("ALTER TABLE work_items ADD COLUMN future_col TEXT DEFAULT 'future-value'");
    raw.close();

    // 读：不分叉、不报错
    const listed = json<{ items: Array<{ content: string }> }>((await cli(['list'])).stdout);
    expect(listed.items.map((i) => i.content)).toContain('加列之前的条目');

    // 写：新条目落库，且**已存在行的 future_col 不被重置**
    const added = await cli(['add', '--content', '加列之后的条目']);
    expect(added.code).toBe(0);

    const check = new DatabaseSync(db, { readOnly: true });
    const rows = check.prepare('SELECT content, future_col FROM work_items ORDER BY created_at').all() as Array<{
      content: string;
      future_col: string | null;
    }>;
    check.close();
    expect(rows.find((r) => r.content === '加列之前的条目')?.future_col).toBe('future-value');
    // 新行拿到列默认值，而不是被显式写成 NULL
    expect(rows.find((r) => r.content === '加列之后的条目')?.future_col).toBe('future-value');
  });

  it('库里含本版本不认识的枚举值：读出即原样透传，改其他字段不报错', async () => {
    const { DatabaseSync } = await loadSqlite();
    const raw = new DatabaseSync(db);
    // 结构版本仍是本版本支持的 2，只是 status 取值超出本版本的 CHECK 词表 ——
    // 模拟"更高版本放宽了枚举"（它必然以重建表的方式做：SQLite 不支持改约束）。
    // 直接 INSERT 会被本版本的 CHECK 挡住，所以这里连表一起换掉。
    raw.exec(`
      CREATE TABLE work_items_v3 (
        id TEXT PRIMARY KEY, item_type TEXT NOT NULL, date TEXT NOT NULL, time TEXT,
        content TEXT NOT NULL CHECK (length(content) BETWEEN 1 AND 2000), category TEXT,
        status TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'user', planned_for TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
      );
      INSERT INTO work_items_v3
        (id, item_type, date, time, content, category, status, source, planned_for, created_at, updated_at, deleted_at)
      SELECT id, item_type, date, time, content, category, status, source, planned_for, created_at, updated_at, deleted_at
        FROM work_items;
      INSERT INTO work_items_v3
        (id, item_type, date, time, content, category, status, source, planned_for, created_at, updated_at, deleted_at)
      VALUES ('01M4D3AAAAAAAAAAAAAAAAAAAA','log','2026-10-08',NULL,'未来版本写入的条目','A项目',
              'cancelled','user',NULL,'2026-10-08T00:00:00.000Z','2026-10-08T00:00:00.000Z',NULL);
      DROP TABLE work_items;
      ALTER TABLE work_items_v3 RENAME TO work_items;
    `);
    raw.close();

    // 读：不认识的值照原样带出来，不静默纠正成某个已知状态
    const listed = json<{ items: Array<{ id: string; status: string }> }>((await cli(['list'])).stdout);
    expect(listed.items.find((i) => i.id === '01M4D3AAAAAAAAAAAAAAAAAAAA')?.status).toBe('cancelled');

    // 写其他字段：不受这个不认识的枚举值影响（跨字段校验只判类型与状态/计划日的联动）
    const updated = await cli(['update', '--id', '01M4D3AAAAAAAAAAAAAAAAAAAA', '--content', '被旧 CLI 改过']);
    expect(updated.code).toBe(0);
    expect(json<{ content: string; status: string }>(updated.stdout)).toMatchObject({
      content: '被旧 CLI 改过',
      status: 'cancelled',
    });
  });
});

describe('配置轴 · 降级安全（PRD 5.4、D31）', () => {
  it('旧 CLI 写配置时保留它不认识的键，不整体重建对象', async () => {
    // 先问 doctor 要配置落点，再写一份"更高版本才认识的键"
    const doctor = json<{ config_path: string }>((await cli(['doctor'])).stdout);
    const configPath = doctor.config_path;
    mkdirSync(dirname(configPath), { recursive: true });
    const seeded = {
      default_format: 'json',
      future_key_from_v2: 'some-value',
      another_new: { nested: 1 },
    };
    writeFileSync(configPath, JSON.stringify(seeded), 'utf8');

    expect((await cli(['config', 'set', 'default_category', '改过的分类'])).code).toBe(0);

    const after = JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>;
    // 未知键与嵌套结构都还在 —— 否则"用旧版跑一次"就会静默丢掉新版本的配置
    expect(after.future_key_from_v2).toBe('some-value');
    expect(after.another_new).toEqual({ nested: 1 });
    expect(after.default_category).toBe('改过的分类');
  });

  it('未知配置键被明确拒绝而不是假装成功（config get）', async () => {
    const r = await cli(['config', 'get', 'future_key_from_v2']);
    expect(r.code).toBe(2);
    expect(json<{ code: string }>(r.stderr.trimEnd()).code).toBe('USAGE_ERROR');
  });
});

describe('运行时轴 · 驱动不可用时的报错契约（PRD 5.2.1、5.7.2）', () => {
  /**
   * 这条测的是**探测函数本身**：传入一个不存在的说明符，走与"低版本 Node"相同的
   * 失败路径。它能在 CI 主矩阵里跑，不依赖旧 Node。
   *
   * 但它**不能**替代端到端验证：真实场景里失败的是"整个模块图在 main 之前断掉"，
   * 那件事只能由真的低版本 Node 来证明 —— 见 `.github/workflows/ci.yml` 的
   * `runtime-refusal` job，以及本目录下 `describeRuntimeRefusal` 的手工复现记录。
   */
  it('加载失败抛 RUNTIME_UNSUPPORTED，并带 node 与 requires 字段', async () => {
    await expect(loadSqlite('node:no-such-builtin-xyz')).rejects.toMatchObject({
      code: 'RUNTIME_UNSUPPORTED',
      extra: { node: process.version, requires: expect.stringContaining('22.22.0') },
    });
  });

  it('入口在模块不可用时输出单行 JSON 且退出 3（用真低版本 Node 复现）', async () => {
    // 低版本 Node 的路径：本机 nvm 装过就用它，没装则跳过并说明原因 ——
    // 静默跳过比假绿更危险，所以打印一句可搜索的提示。
    const candidates = [
      'D:/WorkSoftware/nvm/v20.16.0/node.exe',
      '/d/WorkSoftware/nvm/v20.16.0/node.exe',
    ];
    const legacy = candidates.find((p) => existsSync(p));
    if (!legacy) {
      process.stdout.write('[skip] 本机无 Node 20，运行时拒绝的端到端验证交给 CI 的 runtime-refusal job\n');
      return;
    }

    let stderr = '';
    let code = 0;
    try {
      const ok = await run(legacy, [BIN, 'describe'], { shell: false });
      stderr = ok.stderr;
    } catch (e) {
      const err = e as { stderr?: string; code?: number };
      stderr = err.stderr ?? '';
      code = err.code ?? 1;
    }

    expect(code).toBe(3);
    const lines = stderr.trimEnd().split('\n');
    // 5.2.1：错误恒为**单行** JSON —— 修复前这里是 Node 的多行堆栈
    expect(lines).toHaveLength(1);
    const payload = json<{ code: string; node: string; requires: string; error: string }>(lines[0]!);
    expect(payload.code).toBe('RUNTIME_UNSUPPORTED');
    expect(payload.node).toMatch(/^v20\./);
    expect(payload.requires).toContain('22.22.0');
    // 不能把 Node 的原始堆栈漏出去（Agent 会崩在 `at ModuleLoader…` 那一行）
    expect(stderr).not.toContain('at ModuleLoader');
    expect(stderr).not.toContain('ERR_UNKNOWN_BUILTIN_MODULE');
  }, 60_000);
});
