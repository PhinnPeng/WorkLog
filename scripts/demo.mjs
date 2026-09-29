#!/usr/bin/env node
/**
 * 第一个 Demo：把一条工作记录从录入查到呈现跑完整。
 *
 * 用法 `node scripts/demo.mjs`（需先 `npm run build`）。
 * 库落在 .tmp-demo/（已 gitignore），每次运行都从零开始，故输出可逐字复现。
 * 全程用 execFile 且不经 shell —— 与 PRD 5.3.0 要求的 Agent 调用形态一致。
 */
import { execFile } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BIN = join(ROOT, 'dist', 'index.js');
const DIR = join(ROOT, '.tmp-demo');
const DB = join(DIR, 'demo.db');

rmSync(DIR, { recursive: true, force: true });
mkdirSync(DIR, { recursive: true });

const TODAY = new Date().toISOString().slice(0, 10);

async function step(title, args, { expectFail = false, stdin, raw = false } = {}) {
  let stdout = '';
  let stderr = '';
  let code = 0;
  try {
    const child = run(process.execPath, [BIN, '--db', DB, ...args], { shell: false });
    if (stdin !== undefined) child.child.stdin?.end(stdin);
    ({ stdout, stderr } = await child);
  } catch (e) {
    const err = e;
    stdout = err.stdout ?? '';
    stderr = err.stderr ?? '';
    code = err.code ?? 1;
  }
  const shown = args.map((a) => (a.includes(' ') ? JSON.stringify(a) : a)).join(' ');
  console.log(`\n${'─'.repeat(78)}`);
  console.log(`▌${title}`);
  console.log(`  $ workreport ${shown}`);
  if (stdout) {
    if (raw) {
      console.log(`  ✓ exit ${code}  stdout（人类呈现）:`);
      for (const line of stdout.trimEnd().split('\n')) console.log(`      ${line}`);
    } else {
      const body = JSON.parse(stdout);
      console.log(`  ${expectFail ? 'stdout:' : '✓ exit 0  stdout:'}`);
      for (const line of JSON.stringify(body, null, 2).split('\n')) console.log(`      ${line}`);
    }
  }
  if (stderr) {
    console.log(`  ✗ exit ${code}  stderr（恒为单行 JSON）:`);
    console.log(`      ${stderr.trimEnd()}`);
  }
  if (expectFail && code === 0) throw new Error(`期望失败却成功了：${shown}`);
  if (!expectFail && code !== 0) throw new Error(`期望成功却失败：${shown}`);
  return { stdout, code };
}

const { stdout: added } = await step('1. 录入一条已完成的工作项', [
  'add',
  '--content',
  '完成首个演示库的建库与迁移',
  '--category',
  'A项目',
  '--status',
  'done',
]);
const firstId = JSON.parse(added).id;

await step('2. 录入一条计划项（必须给出归属日）', [
  'add',
  '--content',
  '评审日报导出模板的列定义',
  '--item-type',
  'plan',
  '--planned-for',
  '2026-10-15',
  '--category',
  '信息部事务',
]);

await step('3. 跨字段冲突不静默纠正，给出精确错误码', [
  'add',
  '--content',
  '想同时记成 log 又标 planned',
  '--item-type',
  'log',
  '--status',
  'planned',
], { expectFail: true });

await step('4. 多行内容走 stdin，不进命令行', [
  'add',
  '--content',
  '-',
  '--category',
  'A项目',
  '--time',
  '09:15',
], { stdin: '修复支付回调超时\n重试验证：退避 3 次后成功\n' });

await step('5. add 之前先做分类归一化（categories）', ['categories']);

await step('6. 当日清单（信封带 truncated，Agent 据此判断是否续取）', [
  'list',
  '--date',
  TODAY,
  '--limit',
  '2',
]);

await step('7. 关键词检索，% 按字面匹配', ['search', '--keyword', '支付']);

await step(`8. 用短前缀精确回读（改前先读的原语）`, ['show', '--id', firstId.slice(0, 20)]);

await step('9. 环境自检（只读，含库统计与 problems 数组）', ['doctor']);

await step('10. 同一份数据的表格呈现（--format table）', ['list', '--format', 'table'], {
  raw: true,
});

console.log(`\n${'═'.repeat(78)}`);
console.log(`演示库已留在 ${DB}`);
console.log('继续把玩：node dist/index.js --db ' + DB + ' list --format table');
