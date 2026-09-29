# M0 地基 — 需求与验收标准

> 需求源头是 `docs/PRD.md`（v0.6）。本文件**不复述**其决策，只把 M0 应交付的地基约束转成可验收条目，并给出判定方法。引用形如 `PRD 5.3.2`、`D14`。

## 背景与目标

M0 不交付任何面向用户的记录能力。它交付的是**后续所有命令都要依赖、且事后无法廉价补上的地基**：库结构与迁移、进程输出契约、错误契约、路径处理、CI。

理由：`docs/PRD.md:第 9 节` 的评审结论指出，原稿把这些排在 M5"跨平台测试与发布"，而它们决定 M1–M3 每条命令的写法；先写命令再补契约等于把命令层重写一遍。

## 范围内（In scope）

| # | 交付物 | 源头 |
| :--- | :--- | :--- |
| R1 | `work_items` 建表 DDL，含全部 `CHECK` 约束与 `schema_version` 表 | PRD 5.1.4、D12 |
| R2 | 迁移框架：只追加的迁移数组、失败回滚、`SCHEMA_TOO_NEW`、`DB_NOT_INITIALIZED` | PRD 5.3.2、D14 |
| R3 | 启动即 `journal_mode=WAL` + `busy_timeout=5000`；写走单个 IMMEDIATE 事务 | PRD 第 6 节、D10 |
| R4 | 全局输出层：stdout 只放数据体，stderr 放警告/提示/错误；UTF-8 无 BOM；JSON 默认单行紧凑 | PRD 5.2.1、D2/D3/D7/D8 |
| R5 | 错误契约：`CONFLICT_*` 等码值集中定义 + `errcode`→退出码映射 + 稳定 semver 治理 | PRD 5.7、D4/D5/D39 |
| R6 | 路径展开：`~`、`$VAR`、`%VAR%` 由 CLI 承担，不依赖 shell | PRD 5.3.0、D26 |
| R7 | `worklog describe --format json` 自描述命令面与错误码，与命令定义同源生成 | PRD 5.2.14、D6 |
| R8 | 三平台 CI matrix（Linux/macOS/Windows × Node 24），含 R2 的"旧库新 CLI 打开"用例与 bin 冒烟；并在各平台打印 `env-paths` 的 data/config 实际路径与 PRD 第 8 节表比对（**同时闭合 O13**） | PRD 第 9 节、D32、O13 |
| R9 | `package.json` 的 `engines.node: ">=24.0.0"`、`bin`、依赖收敛为 `commander`/`ulid`/`env-paths` | PRD 第 6、7 节、D38 |
| R10 | 仓库卫生：`.gitattributes` 补文本归一化规则，消除每次 `git add` 刷屏的 LF→CRLF 警告 | 实测（本仓库已复现 3 次，111 文件全刷） |

## 范围外（Out of scope）

- 任何业务命令（`add`/`list`/`convert`…）的行为 —— M1/M2。
- ~~`O13`（`env-paths` 三平台目录实测）~~ → **已移入范围内**：原判断"属跨机人工验证"不成立，三平台 CI 里打印并断言即可自动覆盖（见 R8/AC-8）。
- 计划完成率、`--count`：已由 D33/D34 判定不做。

## 验收标准

每条都可由一条命令判定，不接受"人工目测通过"。

- **AC-1（R1）** `sqlite3 <db> '.schema work_items'` 输出的 DDL 中，`item_type<>'log' OR status<>'planned'` 等三条跨字段 `CHECK` 全部存在；对绕过 CLI 的直接 `INSERT` 违规数据，DB 拒绝写入。
- **AC-2（R2）** 以 `schema_version = N-1` 的库启动 CLI，版本号被推进到 N 且数据完好；迁移中途注入失败时，库保持原版本号与原数据（回滚生效）；`schema_version = N+1` 时报 `SCHEMA_TOO_NEW` 且退出码 `3`；存在 `.db` 但无 `work_items` 表时报 `DB_NOT_INITIALIZED`，**不得**静默建表。
- **AC-3（R3）** 把 `spikes/o9-node-sqlite/spike.mjs` 的并发用例纳入测试：4 进程 × 250 IMMEDIATE 事务，断言 1000 条全落库、`lost=0`、`integrity_check=ok`、零 `DB_LOCKED`。
- **AC-4（R4）** 任一命令在降级/告警场景下，`stdout` 仍可用 `JSON.parse` 完整解析（测试断言：stdout 无一行非 JSON 字节）；错误场景下 `stderr` 为**单行** JSON 且**不随 `--format table|markdown` 改变**；空结果退出码为 `0`。
- **AC-5（R5）** 触发每一类 `CONFLICT_*`，断言 `code` 精确匹配、退出码为 `1`；模拟取锁冲突断言 `DB_LOCKED`/`3`；测试中**禁止**出现"断言 error.message 文本"的用例（D39：CHECK 的 errcode 恒 275，message 不入契约）。
- **AC-6（R6）** 用 `execFile`（不经 shell）传 `--output ~/x.db`，断言文件落在 `os.homedir()` 下，且**当前工作目录未新增任何条目**（前后目录列表比对）。
- **AC-7（R7）** `describe` 输出的 `commands[].flags[].name` 集合与实际 `--help` 一致（同源断言）；`error_codes` 与 5.7.3 表逐项相等；在库文件被故意损坏（追加垃圾字节）的情况下，`describe` 仍成功返回且退出码 `0`。
- **AC-8（R8）** CI 在三个 OS 上全绿，且包含"低版本建库 → 高版本 CLI 打开"用例；`npm install -g` 在三平台均无需编译工具链（无 node-gyp 调用记录）。三平台各自输出的 `env-paths` 路径须与 PRD 第 8 节表逐项相符 —— **若不符，改 PRD 第 8 节并同步 D27，不要改断言迁就文档**（O13 由此闭合）。
- **AC-9（R10）** 改动任一文本文件后 `git add` 不再输出 CRLF 转换警告；`git ls-files --eol` 中所有 `.md`/`.mjs`/`.py` 条目为 `i/lf`（工作区归一）。

## 约束与风险

- **D38 的实测边界**：`node:sqlite` 的并发/快照结论来自单台 Windows、Node v24.18.0。R8 的意义正是把它扩展到三平台 —— **若 CI 在 Linux/macOS 上暴露差异，属于推翻假设而非环境问题**，须回到 PRD 更新 D38，不要靠重试蒙过。
- **`engines.node >= 24.0.0` 未经 22.x 验证**（`docs/PRD.md:第 6 节`）。若将来要放宽，须另测实验证性警告对 stderr 契约的影响。
- `describe` 必须"与命令定义同源生成"，否则它自身就成了新的漂移源（D6）。这是对本任务实现方式的硬约束：**不允许手写第二份元数据表**。
- 命令面此时还没有业务命令，`describe` 会近乎为空 —— 正常。它的骨架与同源机制要在 M0 立住，M1 加命令时自动长出内容。

## 待补（1.1 之后）

M0 属复杂任务，须补 `design.md`（迁移框架与错误映射的结构设计）与 `implement.md`（有序清单与验证命令），再进入 1.4 review gate 与 `task.py start`。
