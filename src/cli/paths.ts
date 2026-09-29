/**
 * 路径展开（PRD 5.3.0、D26）。
 *
 * 必须自己展开，不得假设 shell 已处理：AI Agent 经 execFile/spawn 调用时
 * **不经过 shell**，`~/x.db` 会原样传进来。若不展开，CLI 会在当前工作目录
 * 造一个字面名为 `~` 的目录 —— 直接违反第 1 节"零运行目录污染"，且不报错。
 */
import { homedir } from 'node:os';
import { isAbsolute, resolve } from 'node:path';
import { Code, WorkReportError } from './errors.js';

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

function expandVars(input: string): string {
  return input
    // $VAR —— 非贪婪，遇非法字符即止
    .replace(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g, (whole, name: string) => {
      if (!ENV_NAME.test(name)) return whole;
      const v = process.env[name];
      return v === undefined ? '' : v;
    })
    // %VAR%（Windows 习惯写法；Agent 常照抄文档里的这一种）
    .replace(/%([A-Za-z_][A-Za-z0-9_]*)%/g, (whole, name: string) => {
      const v = process.env[name];
      return v === undefined ? whole : v;
    });
}

export interface ExpandOpts {
  /** true 时，展开结果仍非绝对路径即报错（用于配置项，避免静默落到 cwd） */
  requireAbsolute?: boolean;
}

export function expandPath(input: string, opts: ExpandOpts = {}): string {
  if (input === '') {
    throw new WorkReportError(Code.VALIDATION_ERROR, '路径不能为空字符串', { hint: '传入 ~ 或绝对路径' });
  }
  let p = expandVars(input.trim());
  if (p === '~') p = homedir();
  else if (p.startsWith('~/') || p.startsWith('~\\')) p = resolve(homedir(), p.slice(2));
  else p = resolve(p); // 相对路径按 cwd 解析（调用方自行决定是否告警）

  if (opts.requireAbsolute && !isAbsolute(p)) {
    throw new WorkReportError(Code.VALIDATION_ERROR, `路径解析后仍不是绝对路径：${input}`);
  }
  return p;
}

/** 是否由 shell 展开过就不会带 `~` —— 用来在 stderr 提示可疑入参。 */
export function looksUnexpanded(input: string): boolean {
  return input.startsWith('~') || input.includes('$') || /%[A-Za-z_][A-Za-z0-9_]*%/.test(input);
}

/**
 * 5.3.0 第 4 条：既无 `~` 前缀、又不是绝对路径的入参按 cwd 解析，但**必须在
 * stderr 提示**（可被 `--quiet` 抑制）。对 Agent 而言这几乎总是调用方的错误：
 * 它的 cwd 由宿主进程决定，相对路径会落到谁也不知道的地方。
 */
export function isRelativeInput(input: string): boolean {
  const t = input.trim();
  if (t === '') return false;
  if (t.startsWith('~') || t.startsWith('$') || t.startsWith('%')) return false;
  return !isAbsolute(t);
}
