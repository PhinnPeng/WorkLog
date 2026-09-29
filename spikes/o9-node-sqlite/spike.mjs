// O9 spike: node:sqlite 能力验证
// 用法: node spike.mjs <test> [dir] [extra]
//   node spike.mjs pragmas .                        # WAL 是否生效 / 锁冲突是否可观测
//   rm -f spike.db*; for w in 1 2 3 4; do node spike.mjs writer . $w 250 & done; wait
//   node spike.mjs verify . 1000                    # 并发写是否丢数据
//   node spike.mjs serialize-wal-gap .              # serialize() 是否漏掉未 checkpoint 的 WAL
//   node spike.mjs vacuum-into .                    # VACUUM INTO 备份完整性
// 撕裂快照测试见 torn.mjs。结论与数字见 docs/PRD.md 附录 B。
// 注意：node:sqlite 的错误分支要读 err.errcode（5=BUSY, 275=CHECK, 1555=UNIQUE），
//       err.code 恒为 ERR_SQLITE_ERROR，不可用于区分。
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, rmSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';

const DIR = process.argv[3] || '.';
const DB = path.join(DIR, 'spike.db');
const j = (o) => process.stdout.write(JSON.stringify(o) + '\n');

const open = (file = DB) => {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode=WAL');
  db.exec('PRAGMA busy_timeout=5000');
  db.exec(`CREATE TABLE IF NOT EXISTS items (
    id TEXT PRIMARY KEY, seq INTEGER NOT NULL, payload TEXT NOT NULL
  )`);
  return db;
};

const test = process.argv[2];

if (test === 'pragmas') {
  const db = open();
  const mode = db.prepare('PRAGMA journal_mode').get().journal_mode;
  const bt = db.prepare('PRAGMA busy_timeout').get().busy_timeout;
  // 真实冲突：另起一个事务持锁，看本进程是否 SQLITE_BUSY
  db.exec('BEGIN IMMEDIATE');
  let busySeen = 'none';
  try {
    const other = new DatabaseSync(DB);
    other.exec('PRAGMA busy_timeout=200');
    other.exec('BEGIN IMMEDIATE');
    busySeen = 'no-error';
  } catch (e) {
    busySeen = e.message;
  }
  db.exec('ROLLBACK');
  db.close();
  j({ test, journal_mode: mode, busy_timeout: bt, lock_contention_error: busySeen });
}

if (test === 'writer') {
  const wid = process.argv[4];
  const n = Number(process.argv[5]);
  const db = open();
  const ins = db.prepare('INSERT INTO items (id, seq, payload) VALUES (?, ?, ?)');
  let ok = 0;
  const errors = [];
  for (let i = 0; i < n; i++) {
    try {
      db.exec('BEGIN IMMEDIATE');
      ins.run(`w${wid}-${i}`, i, 'x'.repeat(80));
      db.exec('COMMIT');
      ok++;
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch {}
      errors.push(e.message.slice(0, 60));
    }
  }
  db.close();
  j({ test: 'writer', wid, attempted: n, ok, errors: [...new Set(errors)].slice(0, 3) });
}

if (test === 'verify') {
  const expect = Number(process.argv[4]);
  const db = open();
  const { c } = db.prepare('SELECT COUNT(*) AS c FROM items').get();
  const { s } = db.prepare('SELECT COUNT(DISTINCT id) AS s FROM items').get();
  const integrity = db.prepare('PRAGMA integrity_check').get().integrity_check;
  db.close();
  j({ test: 'verify', expected: expect, rows: c, distinct_ids: s, lost: expect - c, integrity });
}

// 核心风险：WAL 下未 checkpoint 的数据是否被 serialize() 包含
if (test === 'serialize-wal-gap') {
  rmSync(DB, { force: true });
  rmSync(DB + '-wal', { force: true });
  rmSync(DB + '-shm', { force: true });
  let db = open();
  const ins = db.prepare('INSERT INTO items (id, seq, payload) VALUES (?, ?, ?)');
  for (let i = 0; i < 500; i++) ins.run(`s-${i}`, i, 'y'.repeat(100));
  const walBytes = existsSync(DB + '-wal') ? readFileSync(DB + '-wal').length : 0;
  const before = db.prepare('SELECT COUNT(*) AS c FROM items').get().c;
  const buf = db.serialize('main');
  const bufLen = buf.length ?? buf.byteLength;
  db.close();
  // 把 serialize 的字节写成独立库再打开计数
  const out = path.join(DIR, 'from-serialize.db');
  rmSync(out, { force: true });
  writeFileSync(out, Buffer.from(buf));
  const chk = new DatabaseSync(out);
  chk.exec('PRAGMA busy_timeout=5000');
  const after = chk.prepare('SELECT COUNT(*) AS c FROM items').get().c;
  chk.close();
  j({
    test: 'serialize-wal-gap',
    live_rows: before,
    wal_file_bytes: walBytes,
    serialized_bytes: bufLen,
    reopened_rows: after,
    data_lost_by_serialize: before - after,
    verdict: before - after === 0 ? 'serialize 完整' : 'serialize 丢数据',
  });
}

// 对照：VACUUM INTO 是否能拿到完整快照
if (test === 'vacuum-into') {
  const db = open();
  const live = db.prepare('SELECT COUNT(*) AS c FROM items').get().c;
  const out = path.join(DIR, 'via-vacuum.db');
  rmSync(out, { force: true });
  let err = null;
  try {
    db.exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`);
  } catch (e) {
    err = e.message;
  }
  db.close();
  let reopened = null;
  if (!err && existsSync(out)) {
    const c = new DatabaseSync(out, { readOnly: true });
    reopened = c.prepare('SELECT COUNT(*) AS c FROM items').get().c;
    c.close();
  }
  j({ test: 'vacuum-into', live_rows: live, snapshot_rows: reopened, error: err });
}

// 冷启动耗时（每次一个独立进程，含 require 开销）
if (test === 'coldstart') {
  j({ test: 'coldstart', ms: Number(process.argv[4]) });
}
