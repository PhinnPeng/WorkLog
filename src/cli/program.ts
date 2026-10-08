/**
 * commander 装配 —— 全部选项由 spec.ts 生成，这里不手写任何 flag 声明。
 * 与 describe 同源，是门禁 C 断言的对象。
 */
import { Command, Option } from 'commander';
import { CLI_VERSION, COMMANDS, GLOBAL_FLAGS, type FlagSpec } from './spec.js';
import { runDescribe } from './commands/describe.js';
import { runDoctor } from './commands/doctor.js';
import { runAdd } from './commands/add.js';
import { runList } from './commands/list.js';
import { runShow } from './commands/show.js';
import { runSearch } from './commands/search.js';
import { runCategories } from './commands/categories.js';
import { runUpdate } from './commands/update.js';
import { runConvert } from './commands/convert.js';
import { runDelete, runRestore, runPurge } from './commands/lifecycle.js';
import { runConfig } from './commands/config.js';
import { runBackup } from './commands/backup.js';
import { clip, emit, emitText, stderrIsTty, warn, type OutputOpts } from './output.js';
import { render } from './render.js';
import { resolveFormat } from './format.js';
import { expandPath, isRelativeInput } from './paths.js';

type Handler = (opts: Record<string, unknown>) => unknown;

const HANDLERS: Record<string, Handler> = {
  describe: runDescribe,
  doctor: runDoctor,
  add: runAdd,
  list: runList,
  show: runShow,
  search: runSearch,
  categories: runCategories,
  update: runUpdate,
  convert: runConvert,
  delete: runDelete,
  restore: runRestore,
  purge: runPurge,
  config: runConfig,
  backup: runBackup,
};

function addFlag(target: Command, flag: FlagSpec): void {
  const opt = new Option(flag.declaration, flag.description);
  if (flag.commanderChoices && flag.values) opt.choices([...flag.values]);
  if (flag.required) opt.mandatory = true;
  target.addOption(opt);
}

/**
 * 5.3.0 第 4 条：无 `~` 前缀且非绝对的 `--db` 按当前工作目录解析，但**必须在
 * stderr 说清落点**（可被 `--quiet` 抑制）。Agent 的 cwd 由宿主进程决定，
 * 不提示就会把库写进谁也不知道在哪的目录里，且不报错。
 */
function noticeRelativeDb(merged: Record<string, unknown>, opts: OutputOpts): void {
  if (typeof merged.db !== 'string' || !isRelativeInput(merged.db)) return;
  // 两段都设上界：5.2.1 的隐私约束不让 500 字的原始入参灌进调用方日志，
  // 而"数据到底在哪"的完整回显由 doctor 的 stdout 承担（5.3.0-3），这里够用即可。
  warn(
    `--db 是相对路径（${clip(merged.db)}），已按当前工作目录解析为 ${clip(expandPath(merged.db), 120)}`,
    opts,
  );
}

export function buildProgram(): Command {
  const program = new Command();
  program
    .name('workreport')
    .description('本地优先、供 AI Agent 驱动的工作记录 CLI')
    .version(CLI_VERSION, '--version');

  // 用法错误必须以 USAGE_ERROR / 退出码 2 呈现，而不是 commander 的默认行为。
  program.exitOverride();
  // 吞掉 commander 自己往 stderr 写的 "error: unknown option" 一类裸文本：
  // PRD 5.2.1 要求错误呈现是**单个 JSON 对象**，否则 Agent 解析 stderr 会撞墙。
  // 只改 writeErr —— --help 的正文仍走 stdout（惯例，且不与其他 JSON 同流）。
  program.configureOutput({ writeErr: () => {} });
  for (const f of GLOBAL_FLAGS) addFlag(program, f);

  for (const c of COMMANDS) {
    const sub = program.command(c.name).description(c.description);
    sub.exitOverride();
    sub.configureOutput({ writeErr: () => {} });
    // 复数形式：commander 的 .argument() 一次只声明一个参数，整串要在 .arguments() 里拆。
    if (c.args) sub.arguments(c.args);
    for (const f of c.flags) addFlag(sub, f);
    // 声明了位置参数的命令（config），commander 会按声明顺序逐个传进来，末位恒是 Command。
    // 统一收进 _args，命令层就不必各自猜回调的形参顺序。
    sub.action((...callArgs: unknown[]) => {
      const cmd = callArgs[callArgs.length - 1] as Command;
      const positionalArgs = callArgs.slice(0, -1).filter((a): a is string => typeof a === 'string');
      const merged: Record<string, unknown> = {
        ...cmd.optsWithGlobals(),
        ...(positionalArgs.length > 0 ? { _args: positionalArgs } : {}),
      };
      // commander 把 `--no-color` 落成 color=false（不给时默认 true）。
      const presentation: OutputOpts = {
        pretty: Boolean(merged.pretty),
        quiet: Boolean(merged.quiet),
        color: merged.color !== false && stderrIsTty(),
      };
      noticeRelativeDb(merged, presentation);
      const data = HANDLERS[c.name]!(merged);
      // 只有带呈现形态的命令才解析格式 —— describe 必须连配置都不读才能
      // 在坏环境里活着返回（AC-7）。
      const format = c.render ? resolveFormat(merged.format).format : 'json';
      // --format 只换 stdout 数据体；未声明 render 的命令（describe/doctor）恒为 JSON。
      if (c.render && format !== 'json') emitText(render(c.render, data, format));
      else emit(data, presentation);
    });
  }
  return program;
}
