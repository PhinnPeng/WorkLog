#!/usr/bin/env node
/**
 * O16 测量用的单个 worker：以指定 PRAGMA 画像连打 N 个 BEGIN IMMEDIATE 事务。
 * 用法 `node worker.mjs <db> <事务数> <序号> <画像名>`
 *
 * 与 test/fixtures/concurrency-writer.ts 的区别：这里要变的是**连接层设置**
 * （生产代码里是写死的），事务形态与插入语句保持逐字一致。
 * 额外多一个 retry 画像，用来量 O16 方案①的实际代价与收益。
 */
import { DatabaseSync } from 'node:sqlite';
import { ulid } from 'ulid';

const PROFILES = {
  baseline: (db) => db.exec('PRAGMA busy_timeout=5000'),
  syncNormal: (db) => {
    db.exec('PRAGMA synchronous=NORMAL');
    db.exec('PRAGMA busy_timeout=5000');
  },
  syncNormalCkpt: (db) => {
    db.exec('PRAGMA synchronous=NORMAL');
    db.exec('PRAGMA wal_autocheckpoint=10000');
    db.exec('PRAGMA busy_timeout=5000');
  },
  ckptOnly: (db) => {
    db.exec('PRAGMA wal_autocheckpoint=10000');
    db.exec('PRAGMA busy_timeout=5000');
  },
  longTimeout: (db) => db.exec('PRAGMA busy_timeout=15000'),
  retry: (db) => db.exec('PRAGMA busy_timeout=500'), // 短预算 + 自己退避，模拟方案①
};

const RETRY_ATTEMPTS = 3;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const [dbPath, countArg, indexArg, profileName] = process.argv.slice(2);
const count = Number(countArg);
const apply = PROFILES[profileName];
if (!dbPath || !Number.isInteger(count) || !apply) throw new Error(`参数或画像不合法：${profileName}`);

const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode=WAL');
apply(db);
const busyTimeout = Number(db.prepare('PRAGMA busy_timeout').get().timeout);
const synchronous = Number(db.prepare('PRAGMA synchronous').get().synchronous);

const ins = db.prepare(
  `INSERT INTO work_items (id,item_type,date,time,content,category,status,source,planned_for,created_at,updated_at,deleted_at)
   VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
);

function oneTx(worker, i) {
  const stamp = new Date().toISOString();
  db.exec('BEGIN IMMEDIATE');
  ins.run(
    ulid(),
    'log',
    '2026-09-29',
    null,
    `w${worker}-t${i}`,
    '画像测量',
    'done',
    'user',
    null,
    stamp,
    stamp,
    null,
  );
  db.exec('COMMIT');
}

const row = {
  profile: profileName,
  worker: Number(indexArg),
  busy_timeout: busyTimeout,
  synchronous,
  ok: 0,
  absorbed: 0,
  failed: 0,
  elapsed: [],
};

for (let i = 0; i < count; i++) {
  const started = performance.now();
  let attempt = 0;
  for (;;) {
    try {
      oneTx(Number(indexArg), i);
      row.ok++;
      break;
    } catch (e) {
      try {
        db.exec('ROLLBACK');
      } catch {
        /* 回滚噪声不进结论 */
      }
      const isLock = e.errcode === 5 || e.errcode === 6;
      if (isLock && profileName === 'retry' && attempt < RETRY_ATTEMPTS) {
        attempt++;
        row.absorbed++;
        await sleep(50 * 2 ** attempt + Math.floor(Math.random() * 50));
        continue;
      }
      row.failed++;
      row.lastError = `${e.code ?? ''}/${e.errcode ?? ''} ${String(e.message).slice(0, 60)}`;
      break;
    }
  }
  row.elapsed.push(Number((performance.now() - started).toFixed(1)));
}

row.elapsed.sort((a, b) => a - b);
const q = (p) => row.elapsed[Math.min(row.elapsed.length - 1, Math.floor(row.elapsed.length * p))] ?? 0;
db.close();
process.stdout.write(
  `${JSON.stringify({
    ...row,
    elapsed: undefined,
    total_s: Number((row.elapsed.reduce((a, b) => a + b, 0) / 1000).toFixed(2)),
    p50_ms: q(0.5),
    p95_ms: q(0.95),
    p999_ms: q(0.999),
    max_ms: q(1),
  })}\n`,
);
