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
