#!/usr/bin/env node
/**
 * O16 画像矩阵：同一份 schema 下，比较连接层设置对**写入耗时**与**锁失败**的影响。
 *
 *   A 阶段（无争抢，1 进程 × 200 事务）→ 每笔事务的单价：fsync 与 checkpoint 各值多少
 *   B 阶段（4 进程 × 250 事务，复刻 AC-3 负载）→ 总耗时、最慢几笔、是否出现 SQLITE_BUSY
 *
 * 结论写进同目录 results.md。库文件落在 .tmp/（跑完即删）。
 */
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(HERE, '..', '..', 'dist', 'index.js');
const TMP = join(HERE, '.tmp');
const WORKER = join(HERE, 'worker.mjs');
const PROFILES = ['baseline', 'syncNormal', 'ckptOnly', 'syncNormalCkpt', 'longTimeout', 'retry'];
const WORKERS = 4;
const PER = 250;
const SOLO = 200;

rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });

function freshDb(name) {
  const dir = join(TMP, name);
  mkdirSync(dir, { recursive: true });
  const db = join(dir, 'workreport.db');
  // 用真实 CLI 建库：schema 与生产逐字相同，测出来的不是近似物
  execFileSync(process.execPath, [DIST, '--db', db, 'add', '--content', '画像引导', '--category', '画像测量'], {
    shell: false,
  });
  return db;
}

/**
 * 并发跑 workers 个进程。上一版在这里用了 execFileSync 循环，
 * 于是 B 阶段测的是"串行单价"而不是"争抢"—— 结论会反，必须并行。
 */
function spawnWorker(db, profile, w, per) {
  return new Promise((fulfill, reject) => {
    const child = spawn(process.execPath, [WORKER, db, String(per), String(w), profile], { shell: false });
    let out = '';
    let err = '';
    child.stdout.on('data', (c) => (out += c.toString()));
    child.stderr.on('data', (c) => (err += c.toString()));
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? fulfill(JSON.parse(out.trim())) : reject(new Error(`${profile} w${w} 退出 ${code}：${err.slice(0, 200)}`)),
    );
  });
}

async function run(db, profile, workers, per) {
  const started = Date.now();
  const rows = await Promise.all(Array.from({ length: workers }, (_, w) => spawnWorker(db, profile, w, per)));
  return { profile, workers, per, wall_s: Number(((Date.now() - started) / 1000).toFixed(2)), rows };
}

const fmt = (t) => {
  const head = `| 画像 | busy_timeout | synchronous | 进程×事务 | 总耗时 | ok | 退避吸收 | 失败 | p50 | p95 | p999 | 最慢 |`;
  const sep = `| :--- | ---: | ---: | :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |`;
  const lines = t.map((r) => {
    const a = r.rows[0];
    const worst = Math.max(...r.rows.map((x) => x.max_ms));
    return `| ${r.profile} | ${a.busy_timeout} | ${a.synchronous} | ${r.workers}×${r.per} | ${r.wall_s}s | ${r.rows.reduce((s, x) => s + x.ok, 0)} | ${r.rows.reduce((s, x) => s + x.absorbed, 0)} | ${r.rows.reduce((s, x) => s + x.failed, 0)} | ${Math.max(...r.rows.map((x) => x.p50_ms))} | ${Math.max(...r.rows.map((x) => x.p95_ms))} | ${Math.max(...r.rows.map((x) => x.p999_ms))} | ${worst} |`;
  });
  return [head, sep, ...lines].join('\n');
};

const solo = [];
for (const p of ['baseline', 'syncNormal', 'ckptOnly', 'syncNormalCkpt']) {
  solo.push(await run(freshDb(`solo-${p}`), p, 1, SOLO));
}

const heavy = [];
for (const p of PROFILES) {
  heavy.push(await run(freshDb(`heavy-${p}`), p, WORKERS, PER));
}

const md = [
  '# O16 锁等待与写入耗时实测（2026-09-29）',
  '',
  `机器：本地 Windows（GitHub Windows runner 的复现率另见 PRD O16）。负载：${WORKERS}×${PER} 个 BEGIN IMMEDIATE 事务，schema 由真实 CLI 建库。`,
  '',
  '## A 阶段 · 无争抢（1 进程 × 200 事务）—— 每笔事务的单价',
  '',
  fmt(solo),
  '',
  `## B 阶段 · ${WORKERS} 进程争抢`,
  '',
  fmt(heavy),
  '',
  '> `synchronous` 数值：2=FULL（WAL 下默认）、1=NORMAL。',
  '> `retry` 画像是 O16 方案①的模拟：busy_timeout 缩到 500ms，改由 worker 自己退避 3 次。',
  '',
].join('\n');
writeFileSync(join(HERE, 'results.md'), md, 'utf8');
console.log(md);
rmSync(TMP, { recursive: true, force: true });
