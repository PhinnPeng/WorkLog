/**
 * 门禁 A 的权威层 + 门禁 C。
 *
 * 为什么还要一层文本扫描：ESLint 的 AST 选择器会漏掉解构与计算属性
 * （`const {stdout} = process`、`process['stdout']`），而这类写法恰恰是
 * 最容易在重构时无心引入的。ESLint 层负责快速反馈，这层负责真兜底。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { Code } from '../src/cli/errors.js';
import { COMMANDS, FRAMEWORK_FLAGS, GLOBAL_FLAGS } from '../src/cli/spec.js';
import { buildProgram } from '../src/cli/program.js';
import { extractErrorCodes } from '../scripts/extract-codes.mjs';

const SRC = 'src';
const OUTPUT_TS = join(SRC, 'cli', 'output.ts');
const ERRORS_TS = join(SRC, 'cli', 'errors.ts');
/**
 * bin 入口的自举层（PRD D53）。它是**唯一**允许"既写流又带码字面量"的例外，
 * 理由：它存在的意义是接住模块图加载失败 —— 走到那一支时任何 import 都可能再次
 * 失败，所以错误载荷只能就地手写。
 *
 * 例外要窄到可验证，所以下面额外断言它的用量上限（一处 stderr、一个码），
 * 而不是简单地把它从扫描里排除。
 */
const ENTRY_TS = join(SRC, 'index.ts');

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((e) => {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) return tsFiles(p);
    return p.endsWith('.ts') ? [p] : [];
  });
}

const files = tsFiles(SRC);
const rel = (p: string) => relative(process.cwd(), p).replaceAll('\\', '/');

describe('门禁 A · 码表本身', () => {
  it('抽取逻辑没有静默失配（空集会让规则变空转却仍然全绿）', () => {
    expect(files.length).toBeGreaterThan(0);
    const extracted = extractErrorCodes();
    expect(extracted.length).toBe(Object.values(Code).length);
    expect(new Set(extracted)).toEqual(new Set(Object.values(Code)));
  });
});

describe('门禁 A · 流分离', () => {
  it('src/** 只有 cli/output.ts 触碰 process.stdout / stderr', () => {
    // 三种写法都扫：成员访问、解构、计算属性。
    const banned = /process\s*\.\s*(stdout|stderr)|process\s*\[\s*['"](stdout|stderr)['"]|\{\s*(stdout|stderr)\s*\}\s*=\s*process/;
    const offenders = files
      .filter((f) => rel(f) !== OUTPUT_TS.replaceAll('\\', '/'))
      .filter((f) => rel(f) !== ENTRY_TS.replaceAll('\\', '/'))
      .filter((f) => banned.test(readFileSync(f, 'utf8')))
      .map((f) => rel(f));
    expect(offenders).toEqual([]);
  });

  it('入口自举层不得滥用这个例外：只有一处 stderr 写入，且不碰 stdout', () => {
    const src = readFileSync(ENTRY_TS, 'utf8');
    const stderrWrites = src.match(/process\s*\.\s*stderr\s*\.\s*write/g) ?? [];
    expect(stderrWrites, '入口自举只该有一个错误出口').toHaveLength(1);
    expect(src).not.toMatch(/process\s*\.\s*stdout/);
  });
});

describe('门禁 A · 错误码单点定义', () => {
  it('src/** 只有 cli/errors.ts 出现错误码字符串字面量', () => {
    const codes = extractErrorCodes();
    const alt = codes.join('|');
    const banned = new RegExp(`['"\`](${alt})['"\`]`);
    const offenders = files
      .filter((f) => rel(f) !== ERRORS_TS.replaceAll('\\', '/'))
      .filter((f) => rel(f) !== ENTRY_TS.replaceAll('\\', '/'))
      .filter((f) => banned.test(readFileSync(f, 'utf8')))
      .map((f) => rel(f));
    expect(offenders).toEqual([]);
  });

  it('入口自举层只许出现 RUNTIME_UNSUPPORTED 一个码，且与码表一致', () => {
    const src = readFileSync(ENTRY_TS, 'utf8');
    const literals = (src.match(new RegExp(`['"\`](${extractErrorCodes().join('|')})['"\`]`, 'g')) ?? []).map(
      (s) => s.slice(1, -1),
    );
    // 多余一个都说明入口在承担它不该承担的职责，应当搬回命令层
    expect(new Set(literals)).toEqual(new Set(['RUNTIME_UNSUPPORTED']));
    expect(Code.RUNTIME_UNSUPPORTED).toBe('RUNTIME_UNSUPPORTED');
  });
});

describe('门禁 C · describe 与 commander 同源', () => {
  const longOf = (declaration: string) => declaration.split(' ')[0]!;
  const globalLongs = GLOBAL_FLAGS.map((f) => longOf(f.declaration)).sort();
  /** 框架注入项：允许存在，但必须**恰好**是这两个 —— 多一个就是漂移。 */
  const framework = new Set<string>(FRAMEWORK_FLAGS);
  const own = (longs: string[]) => longs.filter((l) => !framework.has(l)).sort();

  it('全局 flag：声明集合 === 注册集合（框架项单独断言）', () => {
    const program = buildProgram();
    const registered = program.options.map((o) => o.long) as string[];
    expect(own(registered)).toEqual(globalLongs);
    // --help 不在 options 里（commander 单独持有），故注入项只出现 --version。
    // 这个期望值是**断言**而非 filter：哪天 commander 多塞一个，这里就红。
    expect(registered.filter((l) => framework.has(l))).toEqual(['--version']);
  });

  it('每个子命令的 flag：声明集合 === 注册集合', () => {
    const program = buildProgram();
    for (const spec of COMMANDS) {
      const cmd = program.commands.find((c) => c.name() === spec.name);
      expect(cmd, `commander 未注册 ${spec.name}`).toBeDefined();
      expect(own(cmd!.options.map((o) => o.long) as string[])).toEqual(
        spec.flags.map((f) => longOf(f.declaration)).sort(),
      );
    }
  });

  it('命令清单本身不多不少', () => {
    const program = buildProgram();
    expect(program.commands.map((c) => c.name()).sort()).toEqual(COMMANDS.map((c) => c.name).sort());
  });
});
