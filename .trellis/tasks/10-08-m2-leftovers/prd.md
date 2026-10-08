# M2 遗留：delete --reason 待拍板 + Node 下限外报错契约

## 背景

M2 命令面（`update` / `convert` / `delete`·`restore`·`purge` / `config` / `backup`）已落地，
2026-10-08 在 Node 22.22.0 与 24.18.0 下 `npm run verify` 均全绿（build + typecheck + lint 通过，104/104 用例）。

本任务只承载**实现与 PRD 之间仍然对不上的两处**，不含已实现部分。

## 状态（2026-10-08）

| 条目 | 状态 | 落点 / 证据 |
| :--- | :--- | :--- |
| R1 `config set data_dir` 未迁移告警 | ✅ 已落地 | `src/cli/commands/config.ts`（`countIn`／`countLine` + set 分支）；`test/config.test.ts` 新增 3 条用例；Node 24 下 `npm run verify` 104/104 |
| R2 config 端到端用例 | ✅ 已被覆盖 | `test/config.test.ts` 的 `config 命令（5.2.10）` 与本次新增的告警用例 |
| R3 `delete --reason` 语义 | ⏸ **待用户拍板** | 见下 |
| R4 README 里程碑表 | ✅ 已落地 | README 实现状态表：M2 转 ✅、后续列改为 M3+ |
| R5 Node 低于下限抛原始堆栈 | ⏸ 待修 | 归入兼容性设计（见下） |

R1 的实测输出（切到一个空目录时）：

```text
旧库 F:\…\A\workreport.db：1 条
新库 F:\…\C\workreport.db：0 条
旧数据仍在 F:\…\A\workreport.db，本命令未迁移
stdout: {"data_dir":"F:\\…\\C","migrated":false}
```

## 范围内

### R1 `config set data_dir` 缺"未迁移"告警（PRD 5.2.10、D30）—— ✅ 已落地

PRD 5.2.10 要求该命令**必须**：在 stderr 输出新旧路径各自的条目数；新路径为空库时显式警告
"旧数据仍在 <旧路径>，本命令未迁移"；返回体附 `migrated:false` 字段。

落地前的实测（Node 24，`config set data_dir .tmp-probe/newdir`）：

- stdout = `{"data_dir":"F:\\WorkSpace\\Worklog\\.tmp-probe\\newdir"}`（无 `migrated` 字段）
- stderr = 空

D30 的理由原文："不警告的话，用户改完配置的直观感受就是'历史记录全丢了'"。这与本工具
"绝不静默丢失数据"的一贯判据（D23 软删除、D29 拒绝覆盖、D31 不静默回落）同源，不是可选打磨。

### R2 `config` 无端到端契约测试 —— ✅ 已被覆盖

`test/m2.test.ts` 覆盖 update／convert／delete·restore·purge／backup；`config` 的 set/get/list、
来源标注（`env`/`file`/`default` 三态）、`data_dir` 存展开后绝对路径、非法值 `USAGE_ERROR`
已由 `test/config.test.ts` 覆盖。

### R3 `delete --reason` 语义未定义（**待用户拍板**）

PRD 5.2.6 的用法行写作 `workreport delete --id <id> [--dry-run] [--reason "..."]`，但：

- 5.1.4 的建表列里**没有** reason 列；
- 第 11 章没有任何决策条目定义它的语义（D23 只定义了软删除 + restore/purge/--dry-run）；
- 实现与 `src/cli/spec.ts` 都没有这个 flag。

二选一：

- **(a) 删掉 usage 行里的 `--reason`**（编辑遗留）—— 推荐。PRD 5.2.6 正文与 D23 都没有
  "删除理由"这个需求，唯一出现处就是那一行 usage；按 D16 的同一判据（"没有需求依赖它就先不加，
  SQLite 加列成本极低"），应当删行而不是加列。
- **(b)** 补 schema v3 迁移加 `reason` 列 + flag + 端到端用例。

### R4 README 里程碑表口径 —— ✅ 已落地

README「实现状态」表已更新：M2 转 ✅，后续列改为 M3+（`report` / `export` / `import`）。
「未实现的命令会以 `USAGE_ERROR` 拒绝」这句仍成立（`report` 等确实退出 2）。

### R5 Node 低于下限时抛原始堆栈，违反 5.2.1 —— ⏸ 待修（归入兼容性设计）

2026-10-08 在 Node 20.16.0 上跑真实产物实测：

```text
$ node dist/index.js describe
node:internal/modules/esm/translators:447
    throw new ERR_UNKNOWN_BUILTIN_MODULE(url);
Error [ERR_UNKNOWN_BUILTIN_MODULE]: No such built-in module: node:sqlite
    at ModuleLoader.builtinStrategy (...)
Node.js v20.16.0
```

抛的是 Node 自己的**多行堆栈**，不是单行 JSON 错误对象 —— 违反 5.2.1／D3，Agent 按契约
`JSON.parse(stderr)` 会崩。根因：`src/db/sqlite.ts` 在 ESM 顶层 `await import()`，模块不存在时
整条链在 `runMain` 之前就断了，`try/catch` 没机会接住。

**影响面**：只在低于 `engines` 下限的环境触发（实测 22.22.0 与 24.18.0 均无此问题）。
处置方案见「兼容性设计」（下一步单独出）。

## 范围外

- M2 已实现部分的行为（update/convert/delete·restore·purge/backup）—— 已有用例覆盖。
- `report`（M3）。
- `doctor` —— M0 已交付。

## 验收标准

- **AC-1（R1）** `config set data_dir <新路径>` 后：stderr 含旧路径与旧库条目数、新路径与新库条目数；
  新库为空时警告文案含"旧数据仍在"；stdout 的 JSON 含 `migrated:false`。经 `execFile` 跑真实产物断言。
- **AC-2（R2）** set/get/list 各有端到端用例；`list` 的每项来源断言 `env`/`file`/`default` 三态。
- **AC-3（R3）** 拍板后落地：选 (a) 则 5.2.6 的 usage 行不再出现 `--reason`、`describe` 无该 flag；
  选 (b) 则 schema v3 迁移 + flag + 用例齐备。
- **AC-4** Node 24 下 `npm run verify` 全绿（101 + 新增用例）。

## 环境事实（2026-10-08 实测，供后续排障）

- **门禁必须用 Node 24**：本机 PATH 默认 `D:\WorkSoftware\nodejs\node.exe` 是 v22.22.0，
  该版本下 `node:sqlite` 往 stderr 打 `ExperimentalWarning`，会让 24 条契约用例报成
  `JSON.parse(stderr)` 失败 —— 报错文本全指向业务代码，根因在 node 版本上。
  已在 `test/setup.ts` 加前置守卫（Node < 24 直接失败并写明根因），`vitest.config.ts` 里挂上。
- Node 24 落在 `C:\Program Files\nodejs\node.exe`（v24.18.0，与 CI / D49 实测同版本）。
