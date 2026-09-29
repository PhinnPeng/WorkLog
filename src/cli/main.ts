/**
 * 入口逻辑（与 bin 分离，便于测试直接调用 runMain 而不派生进程）。
 */
import { Command, CommanderError } from 'commander';
import { buildProgram } from './program.js';
import { fail } from './output.js';
import { Code, WorkReportError } from './errors.js';

export function runMain(argv: readonly string[], program: Command = buildProgram()): number {
  if (argv.length === 0) {
    return fail(
      new WorkReportError(Code.USAGE_ERROR, '缺少子命令', {
        hint: 'workreport describe | workreport doctor',
      }),
    );
  }
  try {
    program.parse([...argv], { from: 'user' });
    return 0;
  } catch (e) {
    if (e instanceof CommanderError) {
      // --help / --version 由 commander 自行输出，属正常终止而非错误。
      if (e.code === 'commander.helpDisplayed' || e.code === 'commander.version') return 0;
      return fail(new WorkReportError(Code.USAGE_ERROR, e.message));
    }
    return fail(e);
  }
}
