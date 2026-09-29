/**
 * 端到端契约测试（AC-4、AC-5 部分、AC-6、AC-7）。
 *
 * 全部经 execFile 跑真实构建产物 —— **不经 shell**。这不是讲究：
 * AI Agent 就是这么调 CLI 的，`~/x.db` 会原样传进来；用 shell:true 测等于没测。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { expandPath } from '../src/cli/paths.js';
import { clip } from '../src/cli/output.js';

const run = promisify(execFile);
const BIN = resolve('dist/index.js');

let sandbox: string;
let probe: { before: string[]; cwd: string };

beforeAll(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'wl-cli-'));
  probe = { cwd: process.cwd(), before: readdirSync(process.cwd()) };
  await run(process.execPath, [BIN, 'describe']); // 冒烟：产物可执行
});
afterAll(() => rmSync(sandbox, { recursive: true, force: true }));

/** 把 HOME 类环境变量指向沙箱，避免真的往用户主目录写。 */
function fakeHomeEnv(home: string): NodeJS.ProcessEnv {
  return { ...process.env, HOME: home, USERPROFILE: home, HOMEPATH: home };
}

async function cli(args: string[], env: NodeJS.ProcessEnv = process.env) {
  try {
    // 用 execPath 显式起 node：execFile 在 Windows 上不会替 .js 文件走 shebang。
    const { stdout, stderr } = await run(
      process.execPath,
      [BIN, ...args],
      { cwd: probe.cwd, env, shell: false, maxBuffer: 8 << 20 },
    );
    return { stdout, stderr, code: 0 };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; code?: number };
    return { stdout: err.stdout ?? '', stderr: err.stderr ?? '', code: err.code ?? 1 };
  }
}

describe('AC-4 输出契约', () => {
  it('describe 的 stdout 是单行、可完整 JSON.parse', async () => {
    const { stdout, code } = await cli(['describe']);
    expect(code).toBe(0);
    expect(stdout.endsWith('\n')).toBe(true);
    expect(stdout.trimEnd().split('\n')).toHaveLength(1);
    expect(JSON.parse(stdout)).toBeTruthy();
  });

  it('--pretty 才多行', async () => {
    const { stdout } = await cli(['describe', '--pretty']);
    expect(stdout.trimEnd().split('\n').length).toBeGreaterThan(1);
  });
});

describe('AC-5 错误呈现', () => {
  it('未知子命令：stdout 全空，stderr 为单行 JSON，退出码 2', async () => {
    const { stdout, stderr, code } = await cli(['no-such-command']);
    expect(stdout).toBe('');
    expect(code).toBe(2);
    const lines = stderr.trimEnd().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({ code: 'USAGE_ERROR' });
  });

  it('错误呈现不随 --format 变化（D3）', async () => {
    const a = await cli(['no-such-command']);
    const b = await cli(['no-such-command', '--format', 'table']);
    const c = await cli(['no-such-command', '--format', 'markdown', '--pretty']);
    expect(b.stderr).toBe(a.stderr);
    expect(c.stderr).toBe(a.stderr);
  });

  it('超长错误文本被裁剪，不回显全文（PRD 5.2.1 隐私约束）', async () => {
    // 直接断言裁剪规则本身。上一版想用 `--db <500字>` 走端到端，但那是错的：
    // describe 刻意不解析路径（AC-7 要求它不开库），所以根本不会产生长错误。
    const long = 'x'.repeat(500);
    expect(clip(long).length).toBe(81); // 80 + 省略号
    expect(clip('短文本')).toBe('短文本');
    // 端到端仍验一次：错误确实是单行 JSON 且不含 500 字的原文
    const { stderr } = await cli(['doctor', '--db', long]);
    if (stderr) {
      expect(stderr.trimEnd().split('\n')).toHaveLength(1);
      expect(stderr).not.toContain(long);
    }
  });
});

describe('AC-6 路径展开不依赖 shell', () => {
  it('--db ~/... 解析进主目录，且当前工作目录零污染', async () => {
    const home = join(sandbox, 'fakehome');
    const { stdout, code } = await cli(['doctor', '--db', '~/probe/workreport.db'], fakeHomeEnv(home));
    expect(code).toBe(0);
    const report = JSON.parse(stdout) as { db_path: string; location_source: string };
    expect(report.location_source).toBe('flag');
    expect(report.db_path.replaceAll('\\', '/')).toBe(`${home.replaceAll('\\', '/')}/probe/workreport.db`);
    expect(existsSync(join(home, '~'))).toBe(false);
    // 关键断言：cwd 没有被新建字面 `~` 目录或多出任何条目
    expect(readdirSync(probe.cwd)).toEqual(probe.before);
    expect(existsSync(join(probe.cwd, '~'))).toBe(false);
  });

  it('expandPath 直接覆盖 ~ / $VAR / %VAR% / 相对路径', () => {
    process.env.WL_TEST_VAR = join(sandbox, 'fromvar');
    expect(expandPath('~/a')).toMatch(/[\\/]a$/);
    expect(expandPath('$WL_TEST_VAR')).toBe(join(sandbox, 'fromvar'));
    expect(expandPath('%WL_TEST_VAR%')).toBe(join(sandbox, 'fromvar'));
    expect(expandPath('plain/rel')).toBe(resolve('plain/rel'));
  });
});

describe('AC-7 describe 不开库，库损坏时仍可用', () => {
  it('库文件是垃圾字节：describe 退出 0，doctor 报告 problems', async () => {
    const bad = join(sandbox, 'bad.db');
    writeFileSync(bad, 'this is definitely not a sqlite database file'.repeat(20));

    const d = await cli(['describe', '--db', bad]);
    expect(d.code).toBe(0);
    expect(JSON.parse(d.stdout).error_codes.length).toBeGreaterThan(0);

    const doc = await cli(['doctor', '--db', bad]);
    expect(doc.code).toBe(0);
    const report = JSON.parse(doc.stdout) as { problems: string[]; db_open: boolean };
    expect(report.problems.length).toBeGreaterThan(0);
    // problems 里的码必须都来自契约码表，不许自造健康词表（PRD 5.2.13）
    const known = new Set(
      (JSON.parse(d.stdout) as { error_codes: Array<{ code: string }> }).error_codes.map(
        (e) => e.code,
      ),
    );
    for (const p of report.problems) expect(known.has(p)).toBe(true);
  });

  it('库不存在：doctor 仍退出 0 并报 DB_NOT_INITIALIZED，不静默建表', async () => {
    const missing = join(sandbox, 'nope', 'workreport.db');
    const { stdout, code } = await cli(['doctor', '--db', missing]);
    expect(code).toBe(0);
    const report = JSON.parse(stdout) as { problems: string[]; db_exists: boolean };
    expect(report.db_exists).toBe(false);
    expect(report.problems).toContain('DB_NOT_INITIALIZED');
    expect(existsSync(missing)).toBe(false);
  });

  it('配置文件是坏 JSON：CONFIG_INVALID 且退出码 3，不静默回落（D31）', async () => {
    const appdata = join(sandbox, 'appdata');
    mkdirSync(appdata, { recursive: true });
    // 三平台的配置落点由不同变量决定：Windows 看 APPDATA，XDG 系看 XDG_CONFIG_HOME，
    // 兜底是 HOME。只设 APPDATA 会让 Linux/macOS 上的 CLI 去读写**runner 真实主目录**
    // —— 既污染机器，又让后续任何用默认路径的步骤读到这份坏配置。
    const home = join(sandbox, 'home');
    const env = {
      ...process.env,
      APPDATA: appdata,
      LOCALAPPDATA: appdata,
      HOME: home,
      USERPROFILE: home,
      XDG_CONFIG_HOME: join(home, '.config'),
      XDG_DATA_HOME: join(home, '.local', 'share'),
    };

    // 先让 CLI 自己报出它认为的 config 路径，再往那儿写坏文件。
    // 不在测试里复刻 env-paths 的目录布局 —— 上一版正是硬编码成
    // %APPDATA%\workreport\config.json，而实际是 ...\workreport\Config\config.json，
    // 于是坏文件根本没被读到，断言假绿。
    const first = await cli(['doctor'], env);
    expect(first.code).toBe(0);
    const cfgPath = (JSON.parse(first.stdout) as { config_path: string }).config_path;

    mkdirSync(dirname(cfgPath), { recursive: true });
    writeFileSync(cfgPath, '{ not json at all');

    const { stdout, stderr, code } = await cli(['doctor'], env);
    expect(stdout).toBe('');
    expect(code).toBe(3);
    expect(JSON.parse(stderr.trimEnd())).toMatchObject({ code: 'CONFIG_INVALID' });
  });
});

describe('构建产物一致性', () => {
  it('dist 存在且 package.json 版本与 describe.version 相同', async () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
    const { stdout } = await cli(['describe']);
    expect((JSON.parse(stdout) as { version: string }).version).toBe(pkg.version);
  });
});
