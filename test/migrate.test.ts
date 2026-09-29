/**
 * AC-1 / AC-2（门禁 B）：schema 约束与迁移语义。
 * 运行：npx vitest run test/migrate.test.ts
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { open, tableExists, BUSY_TIMEOUT_MS, SYNCHRONOUS, WAL_AUTOCHECKPOINT_PAGES } from '../src/db/conn.js';
import { ensureSchema, readVersion } from '../src/db/migrate.js';
import { migrations, CURRENT_SCHEMA_VERSION } from '../src/db/schema.js';
import { WorkReportError } from '../src/cli/errors.js';

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'wl-mig-'));
  dbPath = join(dir, 'workreport.db');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** 只应用到 v1，用来制造"N-1 旧库"。 */
function bootstrapToV1(): void {
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode=WAL');
  migrations[0]!.up(db);
  db.close();
}

function withDb<T>(fn: (db: DatabaseSync) => T): T {
  const db = open(dbPath);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

const insert = (db: DatabaseSync, id: string) =>
  db
    .prepare(
      `INSERT INTO work_items (id,item_type,date,content,status,created_at,updated_at)
       VALUES (?, 'log', '2026-09-24', ?, 'done', '2026-09-24T00:00:00Z', '2026-09-24T00:00:00Z')`,
    )
    .run(id, `条目 ${id}`);

describe('全新库引导', () => {
  it('带索引地落到当前版本', () => {
    const entered = withDb((db) => ensureSchema(db));
    expect(entered).toBe(0);
    withDb((db) => {
      expect(readVersion(db)).toBe(CURRENT_SCHEMA_VERSION);
      expect(tableExists(db, 'work_items')).toBe(true);
      const idx = db
        .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'")
        .all()
        .map((r) => String(r.name));
      expect(idx).toEqual(
        expect.arrayContaining(['idx_date_type', 'idx_planned', 'idx_category', 'idx_active']),
      );
    });
  });
});

describe('AC-2 迁移语义', () => {
  it('N-1 旧库可被新版本打开并升级，数据完好', () => {
    bootstrapToV1();
    withDb((db) => insert(db, 'keep-1'));
    expect(withDb((db) => ensureSchema(db))).toBe(1);
    withDb((db) => {
      expect(readVersion(db)).toBe(CURRENT_SCHEMA_VERSION);
      expect(db.prepare('SELECT COUNT(*) c FROM work_items').get()).toMatchObject({ c: 1 });
    });
  });

  it('迁移中途失败则整体回滚：版本号与数据都保持原样', () => {
    bootstrapToV1();
    withDb((db) => insert(db, 'row-a'));
    // 占名制造 v2 失败：SQLite 中表与索引共用一名命名空间。
    withDb((db) => db.exec('CREATE TABLE idx_date_type (x)'));

    let caught: unknown;
    try {
      withDb((db) => ensureSchema(db));
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(WorkReportError);
    expect((caught as WorkReportError).code).toBe('MIGRATION_FAILED');
    withDb((db) => {
      expect(readVersion(db)).toBe(1); // 未推进
      expect(db.prepare('SELECT COUNT(*) c FROM work_items').get()).toMatchObject({ c: 1 });
    });
  });

  it('结构版本高于本 CLI → SCHEMA_TOO_NEW，不猜测新结构', () => {
    bootstrapToV1();
    withDb((db) => db.prepare('UPDATE schema_version SET version = ?').run(9_999));
    expect(() => withDb((db) => ensureSchema(db))).toThrowError(/高于本 CLI/);
    try {
      withDb((db) => ensureSchema(db));
    } catch (e) {
      expect((e as WorkReportError).code).toBe('SCHEMA_TOO_NEW');
    }
  });

  it('库里有别的表但没有 work_items → DB_NOT_INITIALIZED，且绝不静默建表', () => {
    const db = new DatabaseSync(dbPath);
    db.exec('PRAGMA journal_mode=WAL');
    db.exec('CREATE TABLE someone_elses (id INTEGER PRIMARY KEY)');
    db.close();

    let caught: unknown;
    try {
      withDb((d) => ensureSchema(d));
    } catch (e) {
      caught = e;
    }
    expect((caught as WorkReportError).code).toBe('DB_NOT_INITIALIZED');
    withDb((db) => {
      expect(tableExists(db, 'work_items')).toBe(false); // 关键：没被建出来
      expect(tableExists(db, 'someone_elses')).toBe(true); // 也没被碰
    });
  });
});

describe('AC-1 跨字段 CHECK 落库', () => {
  beforeEach(() => withDb((db) => void ensureSchema(db)));

  const attempt = (sql: string) =>
    withDb((db) => {
      expect(() => db.exec(sql)).toThrow();
    });

  const base =
    "(id,item_type,date,content,status,planned_for,created_at,updated_at) VALUES ";

  it('log 不得为 planned', () =>
    attempt(
      `INSERT INTO work_items ${base}('c1','log','2026-09-24','x','planned',NULL,'t','t')`,
    ));

  it('log 不得带 planned_for', () =>
    attempt(
      `INSERT INTO work_items ${base}('c2','log','2026-09-24','x','done','2026-09-25','t','t')`,
    ));

  it('plan 必须带 planned_for', () =>
    attempt(`INSERT INTO work_items ${base}('c3','plan','2026-09-24','x','planned',NULL,'t','t')`));

  it('status 枚举外值被拒', () =>
    attempt(`INSERT INTO work_items ${base}('c4','log','2026-09-24','x','wip',NULL,'t','t')`));

  it('content 超 2000 字符被拒', () =>
    attempt(
      `INSERT INTO work_items ${base}('c5','log','2026-09-24','${'y'.repeat(2001)}','done',NULL,'t','t')`,
    ));
});

const BIN = resolve('dist/index.js');
const cli = promisify(execFile);

describe('旧版本库被高版本 CLI 打开（PRD 5.3.2，CI 必含用例）', () => {
  it('v1 库经真实产物读取后升到当前版本：索引补齐、数据完好', async () => {
    bootstrapToV1();
    withDb((db) => insert(db, 'LEGACY01'));

    const probe = new DatabaseSync(dbPath);
    const indexes = (
      probe
        .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'")
        .all() as Array<{ name: string }>
    ).map((r) => r.name);
    probe.close();
    expect(indexes).toEqual([]); // 确认这真是个 N-1 旧库，不是当前库

    const { stdout } = await cli(process.execPath, [BIN, '--db', dbPath, 'list'], { shell: false });
    const page = JSON.parse(stdout) as { items: Array<{ id: string }> };
    expect(page.items.map((i) => i.id)).toContain('LEGACY01');

    withDb((db) => {
      expect(readVersion(db)).toBe(CURRENT_SCHEMA_VERSION);
      // 索引不是表，tableExists 查不到，直接看 sqlite_master。
      const names = (
        db
          .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'")
          .all() as Array<{ name: string }>
      ).map((r) => r.name);
      expect(names).toContain('idx_active');
      expect(names).toHaveLength(4);
    });
  });

  it('结构版本高于本 CLI 的库被真实产物拒绝：SCHEMA_TOO_NEW、退出 3', async () => {
    bootstrapToV1();
    const db = new DatabaseSync(dbPath);
    db.prepare('UPDATE schema_version SET version = ?').run(CURRENT_SCHEMA_VERSION + 1);
    db.close();

    const run = cli(process.execPath, [BIN, '--db', dbPath, 'list'], { shell: false });
    const failed = await run.then(
      () => ({ code: 0, stderr: '' }),
      (e: { code?: number; stderr?: string }) => ({ code: e.code ?? 1, stderr: e.stderr ?? '' }),
    );
    expect(failed.code).toBe(3);
    expect(JSON.parse(failed.stderr).code).toBe('SCHEMA_TOO_NEW');
  });
});

describe('连接画像（第 6 节、D49）', () => {
  it('open() 施加的 PRAGMA 与导出常量同源，且 durability 档位是 NORMAL', () => {
    const db = open(dbPath);
    try {
      // 按位置取值：这些 PRAGMA 的返回列名不统一（busy_timeout 的列叫 timeout）。
      const scalar = (sql: string) => Object.values(db.prepare(sql).get() as Record<string, unknown>)[0];
      expect(String(scalar('PRAGMA journal_mode'))).toBe('wal');
      expect(Number(scalar('PRAGMA busy_timeout'))).toBe(BUSY_TIMEOUT_MS);
      expect(SYNCHRONOUS).toBe('NORMAL');
      expect(Number(scalar('PRAGMA synchronous'))).toBe(1); // 1 = NORMAL
      expect(Number(scalar('PRAGMA wal_autocheckpoint'))).toBe(WAL_AUTOCHECKPOINT_PAGES);
    } finally {
      db.close();
    }
  });
});
