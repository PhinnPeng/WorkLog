/**
 * 唯一的流出口 —— 全仓库只有这里允许写 stdout/stderr（门禁 A）。
 * 依据 PRD 5.2.1：stdout 只承载数据体，警告/提示/错误一律走 stderr。
 * 调用方是 AI Agent，混进 stdout 的任意字节都会让它 JSON.parse 失败。
 */
import { Code, exitCodeOf, WorkReportError } from './errors.js';

export interface OutputOpts {
  /** --pretty */
  pretty?: boolean;
  /** --quiet：抑制 stderr 的警告与提示，错误仍输出 */
  quiet?: boolean;
  /** stderr 着色（--no-color 关掉；TTY 检测见 stderrIsTty） */
  color?: boolean;
}

/** PRD 5.2.1 隐私约束：错误对象内不回显超长内容。 */
export const ERROR_TEXT_MAX = 80;

export function clip(s: string, max = ERROR_TEXT_MAX): string {
  return s.length <= max ? s : `${s.slice(0, max)}…`;
}

/** 数据体：UTF-8、单行紧凑（除非 --pretty）、末尾恰好一个换行。 */
export function emit(data: unknown, opts: OutputOpts = {}): void {
  const json = opts.pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);
  process.stdout.write(`${json}\n`);
}

/** table / markdown 这类人类呈现的出口；仍属数据体，故走 stdout。 */
export function emitText(text: string): void {
  process.stdout.write(`${text}\n`);
}

/** 标准错误是否为交互式终端 —— 着色只在 TTY 下默认开启（PRD 5.2.0）。 */
export function stderrIsTty(): boolean {
  return Boolean(process.stderr.isTTY);
}

const ESC = String.fromCharCode(27);
const WARN_FG = ESC + '[33m';
const FG_RESET = ESC + '[0m';

/**
 * 着色只作用于警告与提示行。错误对象那一行永远不带 ANSI：5.2.1 要求它是单个
 * 可 parse 的 JSON，人在终端里复制该行时也不该带上转义码。
 */
export function warn(message: string, opts: OutputOpts = {}): void {
  if (opts.quiet) return;
  process.stderr.write(`${opts.color ? WARN_FG + message + FG_RESET : message}\n`);
}

/**
 * 错误对象：恒为单行 JSON，且**不随 --format / --pretty 变化**（D3）。
 * 因此刻意不接收呈现参数 —— 能传格式选项只会让人误以为格式影响错误输出。
 * 返回进程退出码，由入口负责设置。
 */
export function fail(err: unknown): number {
  const e =
    err instanceof WorkReportError
      ? err
      : new WorkReportError(Code.INTERNAL_ERROR, err instanceof Error ? err.message : String(err));
  const payload: Record<string, unknown> = { error: clip(e.message), code: e.code };
  if (e.extra) Object.assign(payload, e.extra);
  process.stderr.write(`${JSON.stringify(payload)}\n`);
  return exitCodeOf(e.code);
}
