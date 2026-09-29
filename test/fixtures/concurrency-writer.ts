/**
 * AC-3 并发写 worker：以**生产写路径**（conn 的 PRAGMA + BEGIN IMMEDIATE +
 * 同一份 insertItem）向同一个库连打 250 个事务。
 *
 * 由 test/concurrency.test.ts 用 tsup 打包到 dist-test/ 后再派生 4 个进程。
 * 刻意不复用 spikes/ 里的脚本：那只验证 SQLite 本身，这里验证的是本项目的连接
 * 设置与事务形态在争抢下不丢数据。
 */
import { inImmediateTx, openSession } from '../../src/db/session.js';
import { insertItem, type WorkItem } from '../../src/db/items.js';
import { ulid } from 'ulid';

const [dbPath, countArg, workerArg] = process.argv.slice(2);
if (!dbPath || countArg === undefined || workerArg === undefined) {
  throw new Error('用法：concurrency-writer <db> <事务数> <worker 序号>');
}
const count = Number(countArg);
const worker = Number(workerArg);

const db = openSession(dbPath);
let ok = 0;
let busy = 0;
let other = 0;
try {
  for (let i = 0; i < count; i++) {
    const stamp = new Date().toISOString();
    const item: WorkItem = {
      id: ulid(),
      item_type: 'log',
      date: '2026-09-23',
      time: null,
      content: `w${worker}-t${i}`,
      category: '并发用例',
      status: 'done',
      source: 'user',
      planned_for: null,
      created_at: stamp,
      updated_at: stamp,
      deleted_at: null,
    };
    try {
      inImmediateTx(db, () => insertItem(db, item));
      ok++;
    } catch (e) {
      const errcode = (e as { errcode?: number }).errcode;
      if (errcode === 5 || errcode === 6) busy++;
      else other++;
    }
  }
} finally {
  db.close();
}

process.stdout.write(`${JSON.stringify({ worker, ok, busy, other })}\n`);
