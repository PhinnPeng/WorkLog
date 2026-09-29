# M0 技术设计

> 需求与验收见同目录 `prd.md`；决策依据见 `docs/PRD.md` 的 D 编号。本文件只写结构与取舍，不重复需求条目。

## 1. 模块边界

```
src/
  db/
    schema.ts        # DDL 常量 + 迁移数组（唯一 DDL 出处）
    migrate.ts       # 读版本 → 顺序应用 → 写版本，单事务
    conn.ts          # 打开连接并施加 PRAGMA（WAL / busy_timeout）
  cli/
    spec.ts          # 命令面元数据：参数、枚举、约束、错误码
    errors.ts        # Code 枚举 + errcode→Code 映射 + 退出码表
    output.ts        # 唯一写 stdout/stderr 的地方（紧凑 JSON / 编码 / 尾换行）
    paths.ts         # ~ / $VAR / %VAR% 展开
    commands/
      describe.ts    # 由 spec.ts 直接序列化
      doctor.ts      # 自检，只读、不开库也能出结果
  index.ts           # commander 装配
```

硬约束：**除 `cli/output.ts` 外不得有 `console.log` / `process.stdout.write`**，除 `cli/errors.ts` 外不得出现错误码字符串字面量。用 lint 规则或测试断言把这条钉住（见 implement.md S1）。这是 D2/D3 唯一可维持的执行方式 —— 靠 code review 记不住 20 个命令各写一次。

## 2. `spec.ts` 作为单一真源

D6 要求 `describe` 与命令定义同源。做法：命令的 flag/枚举/约束只在 `spec.ts` 声明一次，`index.ts` 用它注册 commander，`describe` 用它序列化。

- commander 的选项定义由 `spec.ts` 生成，而不是两边各写一份再指望一致。
- 校验器也从这里取：枚举值、`content_max_chars`、必填性。**先校验再落库**，因为 AC-5 与 D39 已证 DB 层 `CHECK` 无法区分是哪条约束（`errcode` 恒 275），指望它反推 `CONFLICT_*` 等于解析错误文本。
- `CHECK` 仍然全部保留在 DDL 里，但职责只是"绕过 CLI 时数据不变脏"，其失败统一映射 `VALIDATION_ERROR`。

## 3. 错误映射

`errcode → Code → 退出码` 单表驱动，放在 `errors.ts`。

| errcode（实测值） | Code | 退出码 |
| :--- | :--- | :--- |
| 5 `SQLITE_BUSY` | `DB_LOCKED` | 3 |
| 275 `SQLITE_CONSTRAINT_CHECK` | `VALIDATION_ERROR` | 1 |
| 1555 `SQLITE_CONSTRAINT_UNIQUE` | `CONFLICT_ID_TAKEN`* | 1 |

\* 1555 只在 `import` 路径可触发（`add` 自生成 ULID），而 `import` 是 M5 之后 —— M0 不预先建这个码，等实现 `import` 时再加（新增码为 minor，见 5.7.1）。避免现在就为不存在的调用方造契约。

CLI 自身抛的业务错误直接携带 `Code`，不经 errcode。

## 4. 迁移

`migrations: Array<{ version, up(tx) }>`，只追加。启动流程：

1. 打开库，读 `schema_version`；表不存在 → `DB_NOT_INITIALIZED`（**不建表**，避免把误指向的非本工具库变成"看起来正常"的空库）。
2. `version > 当前 CLI 支持` → `SCHEMA_TOO_NEW`，退出。
3. 事务内依次应用 `>= version` 的迁移；任一步抛错则整体回滚并报 `MIGRATION_FAILED`，库里版本号保持原值。

不做向前兼容（不试图解释更新的库），因为个人本地单用户场景下降级CLI 是罕见事件，而"猜测新 schema"会静默写坏数据。

## 5. 输出层

`output.ts` 暴露 `emit(data)` / `warn(msg)` / `fail(code, msg, extra)` 三个出口，其余模块不许碰流。

- `emit`：`JSON.stringify(data)` 单行 + `\n`；`--pretty` 才加缩进。
- `fail`：stderr 单行 JSON，**不读 `--format`**（D3），并 `process.exitCode = 退出码`。
- 紧凑默认的理由不只是省 token：`report` 写文件时 stdout 要放摘要对象，格式必须可预测。

## 6. 路径展开

`paths.ts` 单一函数：`~` → `os.homedir()`；`$VAR` 与 `%VAR%` → `process.env`；再 `path.resolve`。所有入口（`--output`、`--db`、`config` 的 `data_dir`、`WORKLOG_HOME`）过这一道。

关键测试是 AC-6：**用 `execFile` 不经 shell**，因为 Agent 的真实调用形态就是不经过 shell，`~` 原样传入才会在当前目录造出字面 `~` 目录。只测 shell 展开等于没测。

## 7. 明确不做

- 不做 `--count`/`total`（D34）、不加 `converted_from`（D16）、不用 FTS5（D1）。
- `doctor` 只读：不迁移、不修复、不改权限 —— 否则 Agent 会通过"体检"产生写副作用。
- M0 不引入 `dayjs`。日期只做"取本地今天 + 格式校验 + 字典序比较"，原生足够；真要复杂计算时再评估，届时是一条独立决策。
