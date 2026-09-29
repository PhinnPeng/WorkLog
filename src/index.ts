#!/usr/bin/env node
/**
 * bin 入口。只做一件事：把 runMain 算出的退出码交回给进程。
 * 这里不碰任何流（门禁 A）—— 输出全部在 cli/output.ts。
 */
import { runMain } from './cli/main.js';

process.exitCode = runMain(process.argv.slice(2));
