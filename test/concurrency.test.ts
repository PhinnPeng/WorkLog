/**
 * AC-3（PRD R3）：4 进程 × 250 个 `BEGIN IMMEDIATE` 事务并发写同一个库。
 * 断言 1000 条全落库、零 `DB_LOCKED`、`integrity_check = ok`、无重复 id。
 *
 * worker 用 tsup 现编到 dist-test/（不发布，files 只含 dist），因为要跑的是
 * `src/db/session.ts` 的真实连接设置与事务形态 —— 直接 import 源码进子进程
 * 需要第二套 TS 运行时，那会让"被测的"和"跑的"不是同一份东西。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { build } from 'tsup';

const run = promisify(execFile);
const BIN = resolve('dist/index.js');
const WORKER = resolve('dist-test/concurrency-writer.js');

const WORKERS = 4;
const PER_WORKER = 250;

let sandbox: string;
let db: string;

beforeAll(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'wl-conc-'));
  db = join(sandbox, 'workreport.db');
  await build({
    entry: { 'concurrency-writer': 'test/fixtures/concurrency-writer.ts' },
    outDir: 'dist-test',
    format: ['esm'],
    target: 'node24',
    platform: 'node',
    external: ['node:sqlite'],
    splitting: false,
    silent: true,
    config: false,
    clean: true,
  });
  expect(existsSync(WORKER)).toBe(true);
  // 由真实 CLI 建库并迁移到当前版本，避免多个 worker 同时抢首次建表。
  await run(process.execPath, [BIN, '--db', db, 'add', '--content', '并发用例的引导条目', '--category', '并发用例']);
}, 180_000);

afterAll(() => rmSync(sandbox, { recursive: true, force: true }));

function spawnWorker(index: number): Promise<{ worker: number; ok: number; busy: number; other: number }> {
  return new Promise((fulfill, reject) => {
    const child = spawn(process.execPath, [WORKER, db, String(PER_WORKER), String(index)], {
      shell: false,
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (c: Buffer) => (out += c.toString()));
    child.stderr.on('data', (c: Buffer) => (err += c.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) reject(new Error(`worker ${index} 退出码 ${code}：${err.slice(0, 400)}`));
      else fulfill(JSON.parse(out.trim()) as { worker: number; ok: number; busy: number; other: number });
    });
  });
}

describe('AC-3 多进程并发写（第 6 节、D10）', () => {
  it(`${WORKERS} 进程 × ${PER_WORKER} 个 IMMEDIATE 事务：零 DB_LOCKED、零丢失`, async () => {
    const results = await Promise.all(Array.from({ length: WORKERS }, (_, i) => spawnWorker(i)));
    for (const r of results) {
      expect(r.busy, `worker ${r.worker} 出现 SQLITE_BUSY（busy_timeout 未吸收住争抢）`).toBe(0);
      expect(r.other, `worker ${r.worker} 出现非锁类错误`).toBe(0);
      expect(r.ok).toBe(PER_WORKER);
    }

    const { stdout } = await run(process.execPath, [BIN, '--db', db, 'list', '--all']);
    const items = JSON.parse(stdout) as { items: Array<{ id: string }> };
    expect(items.items).toHaveLength(WORKERS * PER_WORKER + 1); // +1 = 引导条目
    expect(new Set(items.items.map((i) => i.id)).size).toBe(items.items.length);

    const { stdout: doctorOut } = await run(process.execPath, [BIN, '--db', db, 'doctor']);
    expect(JSON.parse(doctorOut) as { problems: string[] }).toMatchObject({ problems: [] });
  }, 180_000);

  it('integrity_check 通过，WAL 未撕裂', async () => {
    const { stdout } = await run(process.execPath, [
      '-e',
      `const {DatabaseSync}=require('node:sqlite');
       const db=new DatabaseSync(${JSON.stringify(db)}, {readOnly:true});
       const r=db.prepare('PRAGMA integrity_check').get();
       process.stdout.write(JSON.stringify({values:Object.values(r)}));`,
    ]);
    const parsed = JSON.parse(stdout) as { values: string[] };
    expect(parsed.values[0]).toBe('ok');
  }, 120_000);

  it('取锁冲突映射为 DB_LOCKED、退出 3（AC-5 后半：busy_timeout 耗尽后不静默重试）', async () => {
    // 持锁者：另起进程开一个写事务并持有不放，逼 CLI 的 busy_timeout=5000 走到尽头。
    const holder = spawn(
      process.execPath,
      [
        '-e',
        `const {DatabaseSync}=require('node:sqlite');
         const db=new DatabaseSync(${JSON.stringify(db)});
         db.exec('PRAGMA journal_mode=WAL');
         db.exec('BEGIN IMMEDIATE');
         process.stdout.write('locked\\n');
         setTimeout(() => { db.exec('ROLLBACK'); db.close(); }, 20_000);`,
      ],
      { shell: false },
    );
    let stderr = '';
    let code = 0;
    try {
      await new Promise((fulfill) => holder.stdout.once('data', fulfill));
      try {
        const ok = await run(process.execPath, [BIN, '--db', db, 'add', '--content', '抢不到锁的写入']);
        stderr = ok.stderr;
      } catch (e) {
        const err = e as { stderr?: string; code?: number };
        stderr = err.stderr ?? '';
        code = err.code ?? 1;
      }
    } finally {
      holder.kill();
      await new Promise((fulfill) => holder.once('close', fulfill));
    }
    expect(code).toBe(3);
    if (stderr === '') throw new Error('持锁未生效：写入竟然成功了');
    const payload = JSON.parse(stderr.trimEnd()) as { code: string; error: string };
    expect(payload.code).toBe('DB_LOCKED');
    // 错误对象里不得回显超长内容（5.2.1 隐私约束）
    expect(payload.error.length).toBeLessThanOrEqual(200);
  }, 120_000);
});
