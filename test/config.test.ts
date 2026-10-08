/**
 * 5.4 配置生效链的端到端验证：`default_format` 真被消费、非法值不静默回落（D31）、
 * 以及 `describe` 在坏配置下仍活着（AC-7 的延伸）。
 *
 * 配置的落点不写死：先问 `doctor` 要 `config_path`，再往那儿写 —— 这样同一条
 * 用例在三平台各自的 env-paths 形态下都成立（PRD 第 8 节、O13）。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const run = promisify(execFile);
const BIN = resolve('dist/index.js');

let sandbox: string;
let home: string;
let db: string;
let configPath: string;
let env: NodeJS.ProcessEnv;

beforeAll(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'wl-cfg-'));
  home = join(sandbox, 'home');
  db = join(sandbox, 'workreport.db');
  // 把三平台会用到的 XDG / APPDATA 变量全指向沙箱，避免碰真实用户目录。
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
  const { stdout } = await run(process.execPath, [BIN, '--db', db, 'doctor'], { env, shell: false });
  configPath = (JSON.parse(stdout) as { config_path: string }).config_path;
  mkdirSync(dirname(configPath), { recursive: true });
  await run(process.execPath, [BIN, '--db', db, 'add', '--content', '配置生效探测', '--category', '配置'], {
    env,
    shell: false,
  });
});
afterAll(() => rmSync(sandbox, { recursive: true, force: true }));

async function cli(args: string[]) {
  try {
    const { stdout, stderr } = await run(process.execPath, [BIN, '--db', db, ...args], {
      env,
      shell: false,
    });
    return { stdout, stderr, code: 0 };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; code?: number };
    return { stdout: err.stdout ?? '', stderr: err.stderr ?? '', code: err.code ?? 1 };
  }
}

function writeConfig(raw: string): void {
  writeFileSync(configPath, raw, 'utf8');
}

describe('config.default_format（5.4、5.6）', () => {
  it('未落地配置时默认 json，来源标记为 default', async () => {
    const { stdout } = await cli(['doctor']);
    const r = JSON.parse(stdout) as { format?: string; format_source?: string };
    expect(r.format).toBe('json');
    expect(r.format_source).toBe('default');
  });

  it('配置 default_format=table 后，不带 --format 的命令直接出表格', async () => {
    writeConfig(JSON.stringify({ default_format: 'table' }));
    const { stdout, code } = await cli(['list']);
    expect(code).toBe(0);
    expect(stdout).toContain('ID');
    expect(() => JSON.parse(stdout)).toThrow();

    const doctor = JSON.parse((await cli(['doctor'])).stdout) as {
      format: string;
      format_source: string;
    };
    expect(doctor).toMatchObject({ format: 'table', format_source: 'config' });
  });

  it('显式 --format 仍压过配置（5.2.0 优先级）', async () => {
    writeConfig(JSON.stringify({ default_format: 'table' }));
    const { stdout } = await cli(['list', '--format', 'json']);
    expect(JSON.parse(stdout)).toHaveProperty('items');
    const d = JSON.parse((await cli(['doctor', '--format', 'json'])).stdout) as { format_source: string };
    expect(d.format_source).toBe('flag');
  });

  it('default_format 非法 → 渲染命令 CONFIG_INVALID 退出 3，不静默回落 json（D31）', async () => {
    writeConfig(JSON.stringify({ default_format: 'plain' }));
    const { stderr, code } = await cli(['list']);
    expect(code).toBe(3);
    const e = JSON.parse(stderr.trimEnd()) as { code: string; path?: string; allowed_values?: string[] };
    expect(e.code).toBe('CONFIG_INVALID');
    expect(e.allowed_values).toEqual(['json', 'table', 'markdown']);
  });

  it('坏配置下 doctor 把原因记进 problems 且不假装知道格式', async () => {
    writeConfig(JSON.stringify({ default_format: 'plain' }));
    const { stdout, code } = await cli(['doctor']);
    expect(code).toBe(0);
    const r = JSON.parse(stdout) as { problems: string[]; format?: string; format_source?: string };
    expect(r.problems).toContain('CONFIG_INVALID');
    expect('format' in r).toBe(false);
    expect('format_source' in r).toBe(false);
  });

  it('坏配置下 describe 仍返回 0 —— 它连配置都不读（AC-7）', async () => {
    writeConfig(JSON.stringify({ default_format: 'plain' }));
    const { stdout, code } = await cli(['describe']);
    expect(code).toBe(0);
    expect(Object.keys(JSON.parse(stdout))).toContain('commands');
  });

  it('config.json 不是合法 JSON 同样 CONFIG_INVALID，不回落默认值', async () => {
    writeConfig('{ 这不是 JSON');
    const { stderr, code } = await cli(['categories']);
    expect(code).toBe(3);
    expect(JSON.parse(stderr.trimEnd()).code).toBe('CONFIG_INVALID');
  });

  it('恢复合法配置后链路重新可用', async () => {
    writeConfig(JSON.stringify({ default_format: 'json' }));
    const { stdout, code } = await cli(['list']);
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toHaveProperty('items');
  });
});

describe('config 命令（5.2.10）', () => {
  /** 带 env 覆写的调用（验 WORKREPORT_HOME 的来源优先级用）。 */
  async function cliEnv(extra: NodeJS.ProcessEnv, args: string[]) {
    try {
      const { stdout, stderr } = await run(process.execPath, [BIN, '--db', db, ...args], {
        env: { ...env, ...extra },
        shell: false,
      });
      return { stdout, stderr, code: 0 };
    } catch (e) {
      const err = e as { stdout?: string; stderr?: string; code?: number };
      return { stdout: err.stdout ?? '', stderr: err.stderr ?? '', code: err.code ?? 1 };
    }
  }

  const code = (stderr: string) => (JSON.parse(stderr.trimEnd()) as { code: string }).code;

  it('set 写入、get 原样回显；null 表示取消默认值', async () => {
    expect((await cli(['config', 'set', 'default_category', '信息部事务'])).code).toBe(0);
    const got = await cli(['config', 'get', 'default_category']);
    expect(JSON.parse(got.stdout)).toMatchObject({ key: 'default_category', value: '信息部事务' });

    await cli(['config', 'set', 'default_category', 'null']);
    expect(JSON.parse((await cli(['config', 'get', 'default_category'])).stdout).value).toBeNull();
  });

  it('data_dir 一律存展开后的绝对路径（5.3.0 第 1 条）', async () => {
    const { stdout } = await cli(['config', 'set', 'data_dir', '~/records-x']);
    const stored = JSON.parse(stdout) as { data_dir: string };
    expect(stored.data_dir.startsWith('~')).toBe(false);
    expect(stored.data_dir).toContain(`records-x`);
  });

  it('default_category 会被 add 消费，成为录入的缺省分类', async () => {
    await cli(['config', 'set', 'default_category', '自动分类']);
    const added = JSON.parse((await cli(['add', '--content', '带默认分类的记录'])).stdout) as { category: string };
    expect(added.category).toBe('自动分类');
    await cli(['config', 'set', 'default_category', 'null']);
  });

  it('list 标注每项来源：file > default，env 又压过 file', async () => {
    await cli(['config', 'set', 'default_status', 'in_progress']);
    const listed = JSON.parse((await cli(['config', 'list'])).stdout) as {
      values: Record<string, { value: string | null; source: string }>;
    };
    expect(listed.values.default_status).toEqual({ value: 'in_progress', source: 'file' });
    expect(listed.values.data_dir!.source).toBe('file'); // 上一条测试设过 ~/records-x
    expect(listed.values.default_format).toEqual({ value: 'json', source: 'file' });

    const withEnv = JSON.parse((await cliEnv({ WORKREPORT_HOME: join(sandbox, 'envhome') }, ['config', 'list'])).stdout) as {
      values: Record<string, { source: string }>;
    };
    expect(withEnv.values.data_dir!.source).toBe('env');
  });

  it('未知配置项与非法枚举都是用法错（退出 2，带可选值提示）', async () => {
    const badKey = await cli(['config', 'set', 'nope', '1']);
    expect(badKey.code).toBe(2);
    expect(code(badKey.stderr)).toBe('USAGE_ERROR');

    const badValue = await cli(['config', 'set', 'default_format', 'plain']);
    expect(badValue.code).toBe(2);
    expect(code(badValue.stderr)).toBe('USAGE_ERROR');
    expect(badValue.stderr).toContain('json');

    const badSub = await cli(['config', 'nope']);
    expect(badSub.code).toBe(2);
    expect(code(badSub.stderr)).toBe('USAGE_ERROR');
  });
});

describe('config set data_dir 的未迁移告警（5.2.10、D30）', () => {
  /**
   * 不带 `--db` 的调用：`--db` 压过配置，那样测不到"换落点"这件事 —— 而本组用例
   * 验的正是配置链自己换落点时的告警。
   */
  async function cliNoDb(args: string[]) {
    try {
      const { stdout, stderr } = await run(process.execPath, [BIN, ...args], { env, shell: false });
      return { stdout, stderr, code: 0 };
    } catch (e) {
      const err = e as { stdout?: string; stderr?: string; code?: number };
      return { stdout: err.stdout ?? '', stderr: err.stderr ?? '', code: err.code ?? 1 };
    }
  }

  it('回显新旧库条目数；新库为空时警告未迁移；返回体带 migrated:false', async () => {
    const oldDir = join(sandbox, 'old-data');
    const newDir = join(sandbox, 'new-data');
    writeConfig(JSON.stringify({ data_dir: oldDir, default_format: 'json' }));

    // 旧库里先有一条真实数据，否则"未迁移"这句话无从谈起
    expect((await cliNoDb(['add', '--content', '留在旧库的记录'])).code).toBe(0);

    const { stdout, stderr, code } = await cliNoDb(['config', 'set', 'data_dir', newDir]);
    expect(code).toBe(0);
    expect(JSON.parse(stdout) as unknown).toMatchObject({ data_dir: newDir, migrated: false });

    const oldDb = join(oldDir, 'workreport.db');
    const newDb = join(newDir, 'workreport.db');
    expect(stderr).toContain(`旧库 ${oldDb}：1 条`);
    expect(stderr).toContain(`新库 ${newDb}：0 条`);
    expect(stderr).toContain(`旧数据仍在 ${oldDb}，本命令未迁移`);
    // 告警只能走 stderr：混进 stdout 就让 Agent 的 JSON.parse 崩了（5.2.1）
    expect(() => JSON.parse(stdout)).not.toThrow();
  });

  it('两边都有数据时不误报未迁移', async () => {
    const oldDir = join(sandbox, 'old-data');
    const newDir = join(sandbox, 'new-data');
    // 上一条把落点切到了 new-data，这里让它也有数据
    expect((await cliNoDb(['add', '--content', '新库里的记录'])).code).toBe(0);

    const { stdout, stderr } = await cliNoDb(['config', 'set', 'data_dir', oldDir]);
    expect(JSON.parse(stdout) as unknown).toMatchObject({ data_dir: oldDir });
    expect(stderr).not.toContain('未迁移');
    expect(stderr).toContain(`旧库 ${join(newDir, 'workreport.db')}：1 条`);
    expect(stderr).toContain(`新库 ${join(oldDir, 'workreport.db')}：1 条`);
  });

  it('--quiet 抑制告警但 migrated 字段仍在（5.2.0 与 5.2.10 各管一半）', async () => {
    const { stdout, stderr, code } = await cliNoDb([
      'config',
      'set',
      'data_dir',
      join(sandbox, 'quiet-data'),
      '--quiet',
    ]);
    expect(code).toBe(0);
    expect(stderr).toBe('');
    expect(JSON.parse(stdout) as unknown).toMatchObject({ migrated: false });

    // 收尾：把落点清回平台默认，别把沙箱状态留给后面的人
    writeConfig(JSON.stringify({ default_format: 'json' }));
  });
});
