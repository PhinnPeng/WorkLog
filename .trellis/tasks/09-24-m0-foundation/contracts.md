# M0 契约摘要（子代理注入用）

> **出处是 `docs/PRD.md`，冲突时以 PRD 为准。** 本文件存在的唯一理由：`docs/PRD.md` 72,798 字节 > `context_injection.max_file_bytes` 32,768，整份引用会被截断（`task.py validate` 已实测告警）。这里只搬"必须逐字正确、不能靠概括"的部分。
> 维护约定：改 PRD 的 5.1.4 / 5.2.1 / 5.7 时顺手同步本文件；二者不一致以 PRD 为准。

## 1. DDL（PRD 5.1.4 逐字）

```sql
CREATE TABLE work_items (
  id           TEXT PRIMARY KEY,
  item_type    TEXT NOT NULL CHECK (item_type IN ('log','plan')),
  date         TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  time         TEXT CHECK (time IS NULL OR time GLOB '[0-9][0-9]:[0-9][0-9]'),
  content      TEXT NOT NULL CHECK (length(content) BETWEEN 1 AND 2000),
  category     TEXT,
  status       TEXT NOT NULL CHECK (status IN ('planned','in_progress','done','blocked')),
  source       TEXT NOT NULL DEFAULT 'user' CHECK (source IN ('user','screenshot','import')),
  planned_for  TEXT CHECK (planned_for IS NULL OR planned_for GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  deleted_at   TEXT,
  CHECK (item_type <> 'log'  OR planned_for IS NULL),
  CHECK (item_type <> 'log'  OR status      <> 'planned'),
  CHECK (item_type <> 'plan' OR planned_for IS NOT NULL)
);
CREATE TABLE schema_version (version INTEGER NOT NULL);
```

索引（PRD 5.1.2）：`idx_date_type(date,item_type)`、`idx_planned(planned_for,item_type,status)`、`idx_category(category,date)`、`idx_active(date DESC,time DESC,created_at,id) WHERE deleted_at IS NULL`。`content` 不建索引。

## 2. 输出流契约（PRD 5.2.1）

- `stdout` 只承载数据体；警告/提示/进度一律 `stderr`。
- UTF-8、无 BOM、数据体末尾恰好一个换行。
- JSON 默认单行紧凑，`--pretty` 才缩进。
- 错误对象写 `stderr`，**恒单行、不随 `--format`/`--pretty` 变化**。
- 错误对象内不回显 `content` 全文（超 80 字符截断）。
- 空结果不是错误：`exit 0`，集合命令返回 `{"items":[],"limit":N,"offset":N,"truncated":false}`。

## 3. 错误码 / errcode / 退出码（PRD 5.7 + D39 实测）

`node:sqlite` 的 `err.code` 恒为 `ERR_SQLITE_ERROR`，**只能用 `err.errcode` 分支**；所有 `CHECK` 违规 errcode 都是 275，无法区分是哪条约束 → 精确的 `CONFLICT_*` **必须由 CLI 前置校验产生**，DB 的 CHECK 只当兜底。

| errcode | 含义 | 映射 Code | 退出码 |
| :--- | :--- | :--- | :--- |
| 5 | SQLITE_BUSY | `DB_LOCKED` | 3 |
| 275 | SQLITE_CONSTRAINT_CHECK | `VALIDATION_ERROR` | 1 |

退出码分档（谁能修）：`0` 成功｜`1` 业务/校验（Agent 改参数）｜`2` 用法错（改调用方式）｜`3` 环境错（交人类，禁止重试）。

M0 需实现的 Code：`USAGE_ERROR`(2)、`VALIDATION_ERROR`(1)、`CONFLICT_STATUS_PLANNED_FOR_LOG`(1)、`CONFLICT_PLANNED_FOR_ON_LOG`(1)、`CONFLICT_PLAN_MISSING_PLANNED_FOR`(1)、`NOT_FOUND`(1)、`AMBIGUOUS_ID`(1)、`CONVERT_SOURCE_TYPE_MISMATCH`(1)、`DELETED`(1)、`DB_LOCKED`(3)、`DB_CORRUPT`(3)、`PATH_EXISTS`(1)、`PATH_NOT_WRITABLE`(3)、`SCHEMA_TOO_NEW`(3)、`DB_NOT_INITIALIZED`(3)、`MIGRATION_FAILED`(3)、`CONFIG_INVALID`(3)。

`UNIQUE` 类冲突（实测 errcode 1555）只在 `import` 路径触发，`import` 属后续迭代 → **M0 不建该码**。

## 4. 路径展开（PRD 5.3.0）

所有路径入参（`--output`、`--db`、`config data_dir`、`WORKLOG_HOME`）由 CLI 展开 `~`、`$VAR`、`%VAR%` 后再 `path.resolve`。**不得依赖 shell** —— Agent 走 `execFile` 不经过 shell，未展开会在当前目录造出字面 `~` 目录。回显一律绝对路径。

## 5. 迁移（PRD 5.3.2）

`schema_version` 单行表；启动在一个事务内：读版本 → 顺序应用 → 写版本。迁移数组只追加不改写；失败整体回滚并保持原版本号，报 `MIGRATION_FAILED`；版本高于本 CLI 报 `SCHEMA_TOO_NEW`；库存在但无 `work_items` 表报 `DB_NOT_INITIALIZED`，**不得静默建表**。

## 6. 实测事实（勿重新试错）

- `node:sqlite` 有 `serialize()`，**无 `backup()`**；备份走 `VACUUM INTO`（实测 2100→2100 完整，产物不含 `-wal`/`-shm`）。
- WAL + `busy_timeout=5000` + IMMEDIATE 事务：4 进程 × 250 事务并发写零丢失、`integrity_check=ok`。
- `PRAGMA busy_timeout` 的返回列名是 **`timeout`**，不是 `busy_timeout`。
- Node v24.18.0 下 `require('node:sqlite')` **不产生 ExperimentalWarning**，stderr 干净。
- 冷启动（require + 开库 + 查询）实测 1.9–2.9ms。
- FTS5 对中文不可用（`unicode61` 子串恒 0 命中；`trigram` 不支持 2 字词）→ 检索一律 `content LIKE ? ESCAPE '\'`，且 `%`/`_`/`\` 必须先转义。
