# WorkReport CLI 产品需求文档（PRD）

**版本**：0.6  
**日期**：2026-09-24  
**状态**：草案（P0／P1 全部定稿；后续事项已移交 `.trellis/tasks/`）  
**作者**：AI 辅助整理

---

## 1. 概述

WorkReport CLI 是一款**本地优先、全局可用**的命令行工作记录管理工具。它不直接集成 LLM，而是作为“哑存储 + 检索”层，由外部 AI Agent（如 Claude Code、Cursor、ChatGPT 等）通过 SKILL 调用，完成工作项的记录、查询和日报生成。

核心设计原则：
- **纯本地**：数据完全存储在用户全局目录，不上传云端。
- **零运行目录污染**：不在当前目录产生 `.workreport` 等任何点目录。
- **AI 友好**：所有命令默认输出 JSON，便于 Agent 解析。
- **极简元数据**：只保留必要字段，降低用户输入负担。
- **可选内置报告**：CLI 可生成日报草稿，但日报的智能整理仍由外部 AI 完成。
- **显式区分日志与计划**：通过 `item_type` 和 `status` 明确工作项性质，避免歧义。

**项目名称**：npm 包 **`@phinnpeng/workreport`**，命令名 **`workreport`**，GitHub 仓库 **`PhinnPeng/WorkLog`**（2026-09-24 由 `worklog` 整体更名为 WorkReport，见 D44；2026-09-29 仓库名单独取 `WorkLog`，见 D50 —— **仓库名与包名/命令名相互独立**，改仓库名不动 npm 侧契约）。

实测依据（2026-09-24）：裸名 `worklog`（v0.1.9，停更 2022-06-29）与兜底名 `worklog-cli`（v1.0.2，2025-06-18 更新）**均已被占用且语义重叠**，故走 scoped 路线。详见 10.2。

**更名顺带消掉了那条 bin 争抢**：上面两个占用包抢的是全局命令名 `worklog`，本项目命令名已不是它（D44）。2026-09-24 实测见 10.2：registry 无 `workreport`／`workreport-cli`／`pwreport` 包，`PhinnPeng/WorkReport` 仓库已建且为空。本节遗留的仍是那两项无法命令行自证的事 —— scope `phinnpeng` 归属、本机 npm 登录态。

---

## 2. 目标与非目标

### 2.1 目标
- 提供全局统一的工作记录库，任何目录下运行 CLI 都读写同一份数据。
- 支持通过 AI Agent 以自然语言记录工作项、补录历史、生成日报。
- 支持记录“明日计划”并允许用户查询计划。
- 支持将计划项转为某日的工作项。
- 支持按日期、分类、状态、类型、关键词检索工作项。
- 提供备份、配置管理能力。
- 支持可选的日报草稿生成，减少 AI token 消耗。

### 2.2 非目标
- 不内置 LLM 调用，不管理 API Key。
- 不处理截图识别，截图识别由外部 Agent 完成。
- 不提供多用户、权限、团队协作功能。
- 不提供 Web UI 或 GUI。
- 不连接 Jira、飞书、Notion 等外部系统（未来可通过 MCP 扩展）。

---

## 3. 用户画像

**个人开发者 / 知识工作者**
- 在本地开发环境使用 CLI。
- 使用 AI Agent 辅助记录和整理日报。
- 关注隐私，希望数据完全本地化。
- 需要在不同项目目录下都能访问同一份工作记录。

---

## 4. 核心工作流

### 4.1 记录工作项
用户对 AI Agent 说：“记录一下，今天完成了用户登录接口联调，分类是 A 项目。”

Agent 先做**分类归一化**（避免 `"A 项目"` 与 `"A项目"` 分裂成两组，见 5.2.12）：
```bash
workreport categories --prefix "A"
```
解析后调用：
```bash
workreport add --content "完成用户登录接口联调" --category "A项目"
```
CLI 将工作项保存到全局数据库，`item_type = log`，`date` 默认当天，`status = done`，`source = user`。

### 4.2 补录历史
用户：“补录上周五：修复了支付回调超时问题。”
Agent 解析相对日期，调用：
```bash
workreport add --date 2026-09-18 --content "修复支付回调超时问题"
```

### 4.3 记录明日计划
用户：“明天计划：完成登录模块单元测试，分类是 A 项目。”
Agent 调用：
```bash
workreport add --content "完成登录模块单元测试" --category "A项目" --item-type plan --planned-for 2026-09-24
```
CLI 保存该计划项，`item_type = plan`，`planned_for = 2026-09-24`，`status = planned`。

### 4.4 查询计划
用户：“查一下明天的计划。”
Agent 调用：
```bash
workreport list --item-type plan --planned-for 2026-09-24 --format json
```

### 4.5 仅保存，稍后生成日报
用户：“先记下来，晚点整理。”
Agent 调用 `workreport add`，不触发生成日报。

### 4.6 生成日报
用户：“生成今天的日报。”
Agent 调用：
```bash
workreport list --item-type log --date 2026-09-23
```
读 `.items` 后由 Agent 按 SKILL 模板整理成 Markdown 日报。
也可直接调用 CLI 的可选命令（计划日由 Agent 显式给出，CLI 不猜"下一个工作日"）：
```bash
workreport report --date 2026-09-23 --planned-for 2026-09-24
```
生成草稿，再由 Agent 润色。

### 4.7 将计划转为某日的工作项
用户：“把明天计划里的‘完成登录模块单元测试’转为今天的工作项，标记完成。”
Agent 先 `list --item-type plan --keyword "登录模块单元测试" --planned-for 2026-09-24` 拿到 `id`（**改前先读，不凭记忆拼 ID**），再调用：
```bash
workreport convert --id <id> --to log --date 2026-09-23 --status done
```
CLI 将该计划项转为日志项：`item_type = log`，`date = 2026-09-23`，`planned_for` 清空，`status = done`。`--to log` 可省略（默认值）。

### 4.8 搜索与回溯
用户：“搜一下所有涉及‘登录’的工作项。”
Agent 调用：
```bash
workreport search --keyword "登录"
```

### 4.9 备份
用户：“备份一下工作记录。”
Agent 调用：
```bash
workreport backup
```
默认落到数据目录内：`<data_dir>/backups/workreport-2026-09-23.db`（见第 8 节）。
显式指定路径时，`~` 与 `$VAR` 由 CLI 自行展开，**不依赖 shell**（见 5.3.0）：
```bash
workreport backup --output ~/backups/workreport-2026-09-23.db
```
目标文件已存在时拒绝覆盖，需 `--force`（见 5.2.11）。

---

## 5. 功能需求

### 5.1 数据模型

工作项表 `work_items`：

| 字段 | 类型 | 必填 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- | :--- |
| `id` | TEXT | 是 | 自动生成 | ULID，全局唯一 |
| `item_type` | TEXT | 是 | `log` | `log`（工作日志） / `plan`（计划项） |
| `date` | TEXT | 是 | 当天 | `YYYY-MM-DD`，工作发生日期或日志归属日期 |
| `time` | TEXT | 否 | NULL | `HH:MM`，可选具体时间 |
| `content` | TEXT | 是 | 无 | 工作项描述 |
| `category` | TEXT | 否 | NULL | 分类，如项目名 |
| `status` | TEXT | 是 | `done` | `planned` / `in_progress` / `done` / `blocked`，**不允许为空** |
| `source` | TEXT | 否 | `user` | `user` / `screenshot` / `import` |
| `planned_for` | TEXT | 否 | NULL | `YYYY-MM-DD`，当 `item_type = plan` 时必填 |
| `created_at` | TEXT | 是 | 当前时间 | ISO 8601（UTC，带 `Z`） |
| `updated_at` | TEXT | 是 | 当前时间 | ISO 8601（UTC，带 `Z`） |
| `deleted_at` | TEXT | 否 | NULL | ISO 8601（UTC）；非空即软删除墓碑，见 5.2.6 |

**时区约定**：`created_at` / `updated_at` / `deleted_at` 一律 UTC 且带 `Z`；`date` / `time` / `planned_for` 是**无时区的本地日历值**，按**写入时运行机的本地时区**解释，读取时同样不做时区换算。混用是跨时区补录错位的根源，必须写死：本工具存的是"用户认知里的那一天"，不是 UTC 那一天。`WORKREPORT_TZ` 覆盖项暂不做（见 10.1）。

#### 5.1.1 约束规则

| 条件 | 约束 |
| :--- | :--- |
| `item_type = log` | `status` 允许 `in_progress` / `done` / `blocked`，**禁止** `planned` |
| `item_type = log` | `planned_for` 必须为 NULL |
| `item_type = plan` | `status` 允许 `planned` / `in_progress` / `done` / `blocked` |
| `item_type = plan` | `planned_for` 必填，非空 |
| `status` | 数据库层 `NOT NULL`，CLI 参数层校验非空 |
| `time` | 可选，`plan` 和 `log` 均允许 |

**约束落点：必须在数据库层用 `CHECK` 表达，CLI 校验只是前置的错误信息美化。**
理由：`import`（未来）、人工用 `sqlite3` 改库、以及 CLI 自身的校验遗漏都会绕过应用层。只在 CLI 校验等于没有校验。

**但 DB 层 `CHECK` 不能替代 CLI 前置校验 —— 实测它们无法被程序区分。** `node:sqlite` 下所有 `CHECK` 失败都返回同一个 `err.errcode = 275`（`SQLITE_CONSTRAINT_CHECK`），只有 `e.message` 里带被违反的约束表达式文本；要靠它区分 5.2.2 的三个 `CONFLICT_*` 码等于**解析错误字符串**。所以正确分工是：CLI 先校验并抛出精确的 `CONFLICT_*`，`CHECK` 只作为"绕过 CLI 时数据不会变脏"的兜底，其失败一律映射为 `VALIDATION_ERROR`（不再试图细分）。

驱动错误码映射须用 **`err.errcode`**（不是 `err.code`）：实测 `node:sqlite` 的 `err.code` 恒为笼统的 `ERR_SQLITE_ERROR`，可分支信息全在 `errcode`（`5`=SQLITE_BUSY→`DB_LOCKED`，`275`=CHECK→`VALIDATION_ERROR`，`1555`=UNIQUE）。

#### 5.1.2 索引

个人量级数据（千～万行）下，**任何索引都非必需**。保留索引只为写放大可接受时的读便利，且必须按真实查询形态建复合索引，而非一列一个：

| 索引 | 服务的查询 |
| :--- | :--- |
| `idx_date_type (date, item_type)` | 日报、`list --date` |
| `idx_planned (planned_for, item_type, status)` | `--planned-for`、`--overdue` |
| `idx_category (category, date)` | `categories`、按分类分组 |
| `idx_active (date DESC, time DESC, created_at, id) WHERE deleted_at IS NULL` | 默认排序 + 分页的覆盖索引 |

**删除原稿的单列索引** `idx_status` / `idx_item_type`：基数分别为 4 和 2，属低基数列，SQLite 查询计划器在此类列上通常直接选全表扫，索引只增加写入成本与体积，不会被用到。

`content` **不建索引**：检索走 `LIKE` 子串扫描（见 5.3.1）；`LIKE '%kw%'` 的中缀匹配无法使用 B-tree 索引。

#### 5.1.3 `--id` 短前缀解析

`update` / `convert` / `delete` / `restore` / `show` 的 `--id` 接受 **ULID 唯一前缀**（不区分大小写），不必给全 26 字符。

- 前缀在**未软删除集合内**解析；命中 1 条即成功，0 条报 `NOT_FOUND`，≥2 条报 `AMBIGUOUS_ID`（错误对象带 `matches` 列出候选短 ID，见 5.7）。
- `table` 默认显示 **12 字符**短前缀（`limits.id_prefix_display`，D46 从 8 加长）—— 完整 ULID 让人类无法手敲，也不便 Agent 复述给用户确认。
  - **原值 8 的假设已被实测推翻（2026-09-29，M1 实现期，见 D45）**：ULID 的前 10 位编码 48 位毫秒时间戳，其中前 8 位承载高 36 位，低 12 位落在第 9–10 位 —— 即**同一约 4 秒窗口内录入的条目必然共享前 8 字符**。密集录入恰是本工具的主要形态（一次会话记十几条），故 8 字符"几乎必然唯一"不成立，`table` 会出现两行同 ID。
  - 取 12 的理由：8 位粗粒度时间 + 4 位随机熵，在个人量级（千～万行）下实际唯一，而 26 位全长违背本条的初衷。
  - 同时落地的处置：`AMBIGUOUS_ID` 的 `matches` 给**完整 26 位 id**，不再是短前缀 —— 短前缀本身就是歧义源，列短前缀等于把歧义原样还回去，`hint: 补长前缀` 也无从执行。
- 完整 ULID 永远合法，前缀只是便利，不是第二套 ID 体系。

#### 5.1.4 建表约束（SQL 落点）

5.1.1 的规则必须原样落进 DDL，示例：

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
  CHECK (item_type <> 'log'    OR planned_for IS NULL),
  CHECK (item_type <> 'log'    OR status      <> 'planned'),
  CHECK (item_type <> 'plan'   OR planned_for IS NOT NULL)
);
CREATE TABLE schema_version (version INTEGER NOT NULL);
```

- `content` 上限 **2000 字符**（决策见 D12）。超出在 CLI 层即报 `VALIDATION_ERROR` 并带 `hint: "use --content - with stdin"`，不落库。
- `source` 补 `NOT NULL DEFAULT 'user'` —— 原稿写"否／可空"，但它是枚举，可空会让统计分支变多。

### 5.2 命令设计

#### 5.2.0 全局选项

以下选项对所有子命令生效，属于命令面的全局层，不是各命令的局部参数：

| 选项 | 作用 | 默认 |
| :--- | :--- | :--- |
| `--format json\|table\|markdown` | 仅改变 **stdout 数据体**的呈现 | `json` |
| `--pretty` | JSON 缩进 2 空格；不加则单行紧凑 | 关闭 |
| `--quiet` | 抑制 stderr 的警告与提示（错误对象仍输出） | 关闭 |
| `--db <path>` | 本次运行临时指定数据库，不读写 `data_dir` 配置 | 未设置 |
| `--no-color` | 关闭 stderr 着色 | 按 TTY 自动检测 |
| `--version` / `--help` | 版本 / 帮助 | — |

`--format` **不改变 stderr 错误对象的格式**（见 5.2.1、5.7）。

`--no-color` 的作用范围（D46）：ANSI 只加在 stderr 的**警告与提示**行上，默认按 TTY 自动检测；错误对象那一行**永远不带转义码** —— 否则人在终端里复制该行仍要手动剥 ANSI，而 Agent 侧本就要求它可直接 `JSON.parse`。

#### 5.2.1 输出规范

**流分离（硬约束，不可协商）**
- `stdout` **只**承载数据体：JSON 模式下是纯 JSON，`table`/`markdown` 模式下是人类可读文本。
- 警告、提示、进度、降级信息**一律**写入 `stderr`，绝不出现在 `stdout`。
- 理由：本工具的调用方是 AI Agent，任何混入 `stdout` 的非数据字节都会让它的 `JSON.parse` 直接失败。
- 无数据返回的命令成功时 `stdout` 为空。

**编码**：`stdout`/`stderr` 均为 UTF-8、无 BOM；数据体末尾恰好一个换行符。

**紧凑优先**：JSON 默认单行紧凑（`JSON.stringify(v)`），仅 `--pretty` 时缩进。理由：输出按 token 计费被 Agent 读走，缩进是纯浪费 —— 单条约 200 → 320 字节，200 条的 `list` 差值约 24KB，与第 1 节“减少 AI token 消耗”目标直接相关。

**成功输出**分两种形态：

- **单对象命令**（`add` / `update` / `convert` / `delete` / `show` / `restore`）→ 直接输出工作项对象。
- **集合命令**（`list` / `search`）→ 输出**信封对象**，携带分页元信息：

```json
{"items":[],"limit":200,"offset":0,"truncated":false}
```

- `truncated: true` 表示仍有匹配项未取回，调用方须用 `--offset` 续取或提高 `--limit`。**这一位的存在是信封的全部理由**：让"结果被截断"从静默行为变成可判定事实，否则 Agent 会把截断结果当全量汇报给用户。
- **不含 `total`**。`LIKE '%kw%'` 走不到索引，算 `total` 需再扫一遍全表；改用 **limit+1 探测**（取 `limit+1` 行，多出则置 `truncated` 并丢弃该行）即可零额外扫描得出截断位。
  - **不提供 `--count` 逃逸口**（评审时曾提议，已删）。核对场景后，第 2.1 节的任一目标都不需要"匹配总数"：日报要的是当日条目，检索要的是命中内容，`truncated` 已足够表达"还有更多"。真要数总数，Agent 用 `--offset` 翻页数得出来，或在拿到 `truncated:true` 时如实说"至少 N 条" —— 为一个未被需求支持的数字保留一条 `COUNT(*)` 全表扫描和一个可选契约字段，不划算。与 D16 同一判据。
  - 若将来确有需求，加 `--count` 是可选 flag + 可选信封字段，属 minor，不构成破坏性变更 —— 所以删掉它没有反悔成本。
- 契约代价：调用方读 `.items` 而非裸数组，`jq '.items[]'`。

例如 `workreport add` 返回：
```json
{
  "id": "01J...",
  "item_type": "log",
  "date": "2026-09-23",
  "time": null,
  "content": "完成登录接口联调",
  "category": "A项目",
  "status": "done",
  "source": "user",
  "planned_for": null,
  "created_at": "2026-09-23T10:30:00Z",
  "updated_at": "2026-09-23T10:30:00Z"
}
```

**错误输出**：单个 JSON 对象写入 `stderr`，**恒为单行，且不受 `--format` / `--pretty` 影响**：
```json
{"error":"item_type=log 时 status 不能为 planned","code":"CONFLICT_STATUS_PLANNED_FOR_LOG","field":"status"}
```
- 进程退出码非 0，取值见 5.7。
- `code` **必须**取自 5.7 的稳定枚举，禁止自由字符串。调用方只可对 `code` 分支，**不得**匹配 `error` 文案。
- `error` 为人类可读描述，不属于契约内容，措辞可在任意版本改变。
- 可选字段 `field`（出错字段名）、`hint`（建议动作）。新增可选字段为 minor，删除或改语义为 major。
- **隐私约束**：错误对象内不得回显 `content` 全文（超 80 字符须截断）或任何文件内容片段，避免长文本与敏感内容泄入调用方日志。

**空结果**：`list` / `search` 无匹配时，JSON 输出 `{"items":[],"limit":N,"offset":N,"truncated":false}`，`table` / `markdown` 输出“无记录”。空结果**不是错误**，退出码为 `0`。

#### 5.2.2 `workreport add`
添加工作项或计划项。
```bash
workreport add --content "完成登录接口联调" [--item-type log|plan] [--date 2026-09-23] [--time 10:30] \
  [--category "A项目"] [--status done] [--source user] [--planned-for 2026-09-24]
workreport add --content -            # 从 stdin 读取内容
```
- `--content` 必填。**`--content -` 表示从 stdin 读**，用于含引号／换行／超长的内容 —— Agent 拼命令行时嵌套引号在 `cmd.exe` 下是真实故障源。stdin 内容按原样保存（去除行尾 `\n`），受 `content_max_chars` 上限约束（见 5.2.14）。
- `--item-type` 默认 `log`。
- `--date` 默认当天；`--time` 可选。
- `--status` 缺省时按类型取默认值：`log` → `done`，`plan` → `planned`。显式传入时**不做静默纠正**。
- 返回新工作项的 JSON。

**跨字段冲突：一律报错，不自动纠正**

| 输入组合 | 行为 |
| :--- | :--- |
| `--item-type log --status planned` | `CONFLICT_STATUS_PLANNED_FOR_LOG`，退出 `1` |
| `--item-type log --planned-for X` | `CONFLICT_PLANNED_FOR_ON_LOG`，退出 `1` |
| `--item-type plan` 且缺 `--planned-for` | `CONFLICT_PLAN_MISSING_PLANNED_FOR`，退出 `1` |

理由：调用方是 LLM。静默改写参数会产生三处不可见错误 —— 库里存了用户没要的值、Agent 按原始意图向用户复述、且没有任何信号提示两者不一致。显式报错让 Agent 拿到 `code` 后自行重组参数，这正是 5.7 契约存在的意义。
**例外**：`convert` 允许自动推导（见 5.2.5），因为"计划转工作项"这一动作本身就蕴含 `planned → done` 的语义迁移。

#### 5.2.3 `workreport list`
列出工作项，支持过滤。
```bash
workreport list [--item-type log|plan] [--date 2026-09-23] [--from 2026-09-01] [--to 2026-09-30] \
  [--category "A项目"] [--status done] [--keyword "登录"] [--planned-for 2026-09-24] \
  [--overdue] [--limit 200] [--offset 0] [--all]
```
- 默认返回所有类型。返回信封结构，见 5.2.1。
- `--keyword` 触发子串检索（实现见 5.3.1）。
- `--planned-for` 查询指定日期的计划项。
- `--overdue`：`item_type=plan` 且 `planned_for < 今天` 且 `status != done`。

**排序（必须是全序）**
`date DESC, time DESC NULLS LAST, created_at ASC, id ASC`。
末位以 `id`（ULID）兜底。理由：`--offset` 分页在存在并列行时若无确定性次序，翻页会**重复和漏项** —— 这是分页的隐形正确性 bug，不补二级排序键 `--offset` 就是坏的。

**分页**
- `--limit <n>`：默认 `200`。
- `--offset <n>`：默认 `0`。
- `--all`：取消上限。**不提供 `--limit 0` 表示"全部"** —— `0` 既可读作"零条"也可读作"不限"，是歧义源。
- **无 `--count`／无 `total`**：截断状态由 `truncated` 表达即够，理由见 5.2.1。

**过滤参数互斥规则**
- `--date` 与 `--from`/`--to` 同时给出 → `VALIDATION_ERROR`，**不做静默优先级裁决**。Agent 收到明确报错优于猜中优先级。
- `--date` 对 `plan` 过滤的是 `date`（计划登记日），**不是** `planned_for`。查询某天的计划一律用 `--planned-for`。此语义必须在 `--help` 中写明，否则是高频误用点。

#### 5.2.4 `workreport update`
按 ID 更新字段。**不接受 `--item-type`** —— 类型迁移的唯一入口是 `convert`（见 5.2.5）。
```bash
workreport update --id <id> [--content "..."] [--date ...] [--time ...] [--category ...] [--status ...] [--source ...] [--planned-for ...]
```
- 只更新传入的字段；自动刷新 `updated_at`。
- **不跨越类型边界**：`update` 的校验规则是"更新后的整行必须满足 5.1.1"，违反则报错回滚，**绝不自动改类型或静默改状态**。
  - 对 `log` 项传 `--planned-for` → `CONFLICT_PLANNED_FOR_ON_LOG`。
  - 对 `log` 项传 `--status planned` → `CONFLICT_STATUS_PLANNED_FOR_LOG`。
  - 对 `plan` 项传 `--planned-for`（改计划日期）→ 合法。
- 传 `--item-type` → `USAGE_ERROR`（退出 `2`），`hint` 指向 `convert`。
- 返回更新后的完整 JSON。

> **为何禁止 `update --item-type`**：跨类型变更需要同时裁决 `planned_for` 与 `status` 两个字段的联动，这套状态机若同时存在于 `update` 和 `convert` 两处，必然随版本演进漂移，产生"同一条数据两个入口结果不同"的 bug。收敛为单一路径后，联动规则只有一份实现。

#### 5.2.5 `workreport convert`
**类型迁移的唯一入口**，双向。
```bash
workreport convert --id <id> --to log  --date YYYY-MM-DD [--status done] [--category ...] [--content ...]
workreport convert --id <id> --to plan --planned-for YYYY-MM-DD
```
- `--to` 默认 `log`（对应"把计划转为工作项"这一高频动作）。
- **`--to log`**：源项 `item_type` 必须为 `plan`，否则 `CONVERT_SOURCE_TYPE_MISMATCH`（退出 `1`）。转换后 `item_type=log`、`date=指定日期`、`planned_for=NULL`、`status` 取 `--status`（默认 `done`）。
  - 允许覆盖 `category` / `content` / `time`。
  - **此处是唯一允许推导的地方**：源项 `status=planned` 且未显式给 `--status` 时取 `done`。
- **`--to plan`**：源项必须为 `log`，否则同一错误码。转换后 `item_type=plan`、`planned_for=指定日期`、`date` 保留为当天、`status` 默认 `planned`。
- 返回转换后的完整 JSON。
- **批量**：暂不支持，仅单 ID。

**溯源字段（明确不做）**
转换不保留"它曾经是哪个日期的计划"。曾考虑加 `converted_from` / `origin_planned_for`，此处**决定不加**，理由：SQLite 加一个可空列的成本是 `ALTER TABLE ... ADD COLUMN`，极低，所以"现在不加以后就贵"的论证不成立；而当前需求（第 2.1 节目标）里没有任何一项依赖计划完成率统计。等真要做时再加，迁移成本可忽略。
**2026-09-24 用户确认：不需要计划完成率** —— 该判断由悬置项转为明确决定（D33），`list --overdue` 仍保留（它服务的是"今天该补做哪些遗留计划"，与完成率无关）。

#### 5.2.6 `workreport delete` / `restore` / `purge`

**删除是软删除。** 调用方是会幻觉的 LLM，它可能从搜索结果里取错 `id`；而 `backup` 是手动的，物理删除在这个工具里等同不可恢复的数据丢失。

```bash
workreport delete --id <id> [--dry-run] [--reason "..."]   # 置 deleted_at
workreport restore --id <id>                                # 清 deleted_at
workreport purge --older-than <Nd> --yes                   # 真正物理删除过期墓碑
workreport list --include-deleted                           # 含墓碑
```
- `delete` 返回**被删条目的完整 JSON**（含 `deleted_at`），使调用方可无损重放。
- `--dry-run`：只做 id 解析与权限校验，返回"将要删除的完整条目"，**不写库**。5.5.1 要求 Agent 在真实删除前复述此结果给用户确认。
- 所有查询命令默认过滤 `deleted_at IS NOT NULL`；`--include-deleted` 才带出。
- `id` 在软删除期间仍占用，`add` 不会复用；`restore` 因此可行。
- `purge` 的 `--older-than` **必填且无默认值**（评审时曾写 `30d` 默认，已删：没有任何需求依据支持"30 天"这个数字，而它控制的是不可逆操作），并且需要 `--yes`，否则 `VALIDATION_ERROR`。这是唯一不可逆操作，必须双显式确认。
- 其余写命令（`update` / `convert`）对墓碑报 `DELETED`，而非静默新建。

#### 5.2.7 `workreport show`
按 id 精确读取单条。
```bash
workreport show --id <id> [--include-deleted]
```
- 存在 `NOT_FOUND` 语义，无匹配报 `NOT_FOUND`（退出 `1`）。
- 4.7 与 5.2.6 的 Agent 流程依赖它做"改前先读"；此前命令面缺这个原语，Agent 只能用 `list --keyword` 近似定位，是误删的直接来源。

#### 5.2.8 `workreport search`
独立搜索命令，等价于 `list --keyword`。
```bash
workreport search --keyword "登录" [--from ...] [--to ...] [--item-type log|plan] [--limit 200] [--offset 0] [--all]
```
- 默认搜索所有类型。返回信封结构，见 5.2.1。
- 检索语义、转义与大小写规则见 5.3.1；**`search` 与 `list --keyword` 必须共用同一实现**，不得各自持有一份 SQL。

#### 5.2.9 `workreport report`（可选）
按日期生成日报草稿。**格式：按分类分组，列出工作项列表。**
```bash
workreport report --date 2026-09-23 [--planned-for 2026-09-24] [--output <path>]
```
- 主体：`item_type = log` 且 `date = --date` 且未软删除的工作项。
- 按 `category` 分组，组间按**该组首条目的排序键**升序排列，分类名以字典序兜底。
- `--planned-for <DATE>`：附加"计划区"，取 `item_type = plan` 且 `planned_for = <DATE>` 的条目，单独成块。
  - **不再用 `--include-plan` 隐含 `--date + 1`**：周五跑日报会给出周六的计划，语义错误。计划日必须由调用方显式给出，"下一个工作日是哪天"属于日历知识，归 Agent（见 5.5）。
  - 区块标题随实际日期变化（`明日计划` / `周六计划` / `后日计划`），不硬编码"明日"。
- **`category` 为 NULL 的条目归入 `未分类` 组**，不丢弃。原稿"空分类不显示"字面上会静默吞掉无分类记录，属数据丢失级错误；已改。**不提供隐藏开关**（评审时曾加 `--exclude-uncategorized`，已删：没有任何需求要求隐藏未分类项，多一个 flag 就多一条测试路径）。
- **组内排序**：`time ASC NULLS LAST, created_at ASC, id ASC`。原稿示例出现 1./2. 编号但全文未定义次序，同一份数据两次生成可能给出不同日报，无法做回归测试。
- 若指定日期无日志且无计划区，输出仍生成文件／stdout，正文为 `无工作记录`，退出码 `0`（空结果不是错误，见 5.2.1）。
- **输出去向**：
  - 未给 `--output` → Markdown 写 `stdout`（此时 `stdout` 不是 JSON，属 `--format markdown` 的例外，须在 `describe` 中标注）。
  - 给了 `--output` → 文件写 Markdown，`stdout` 输出 `{"path":"...","log_count":N,"plan_count":N,"groups":["A项目","未分类"]}`；**不把 Markdown 同时打到 stdout**，避免大文本双份进入 Agent 上下文。
  - 原稿两处并存且未定优先级。
- `--output` 路径按 5.3.0 展开，目录不存在时自动创建，已存在同名文件时拒绝覆盖（`PATH_EXISTS`，需 `--force`），与 `backup` 行为一致。

**日报格式的唯一真源是本节**
`report` 的分组键、组间顺序、组内排序、未分类归组规则（本节上半部分）即**日报格式的定义**，Agent 自行整理日报时**必须遵循同一套规则**，SKILL.md 不另写一份排序/分组定义。理由：否则 CLI 一份模板、Agent 一份模板，两条生成路径会给出不同日报，且漂移无人负责。
落地方式：SKILL.md 引用本节规则而非复述（与 D6「不手抄契约」同源）；`report` 与 Agent 手工整理若结果不一致，**以 `report` 为准并修 SKILL**。

**输出示例（`--date 2026-09-23`，仅日志）**：
```markdown
信息部事务：
1. 完成用户登录接口联调
2. 修复支付回调超时问题

A项目：
1. 完成登录模块单元测试

未分类：
1. 参加部门周会
```

**输出示例（附加 `--planned-for 2026-09-24`）**：
```markdown
信息部事务：
1. 完成用户登录接口联调
2. 修复支付回调超时问题

A项目：
1. 完成登录模块单元测试

未分类：
1. 参加部门周会

2026-09-24 计划：
信息部事务：
1. 优化登录日志记录
A项目：
1. 编写支付模块单元测试
```

#### 5.2.10 `workreport config`
管理配置。
```bash
workreport config set data_dir ~/my-workreport
workreport config get data_dir
workreport config list
```
- 支持配置：`data_dir`、`default_category`、`default_status`、`default_format`。
- 配置存储于全局配置目录，路径由 `env-paths` 决定（见 5.3）。
- **`config set data_dir` 仅切换数据库路径，不迁移数据。** 因此该命令**必须**在 stderr 输出新旧路径各自的条目数，且新路径为空库时显式警告"旧数据仍在 <旧路径>，本命令未迁移"，并附 `migrated:false` 字段。理由：不警告的话，用户改完配置的直观感受就是"历史记录全丢了"。
  - 需要临时换库而不改配置 → 用全局 `--db <path>`（5.2.0）。
  - 真要迁移 → `export` → 切路径 → `import`（5.2.15）。
- 优先级顺序见 5.4，本命令不再另行定义。

#### 5.2.11 `workreport backup`
备份数据库。
```bash
workreport backup [--output <path>]
```
- **默认输出到 `<data_dir>/backups/workreport-YYYY-MM-DD.db`**（与第 8 节目录规范一致；原稿此处写作 `~/backups/`，属内部矛盾，已统一）。
- **快照实现：`VACUUM INTO <path>`**（不用文件复制）。实测活库 2100 行 → 快照 2100 行、无错误；且产物是**已合并 WAL 的单文件**，不附带 `-wal`/`-shm`，正好是备份想要的形态。
  - `node:sqlite` **没有** `backup()` 方法（实测原型方法枚举，见附录 B），故 `VACUUM INTO` 是主路径。
  - `db.serialize('main')` 实测同样完整（含未 checkpoint 的 WAL 数据：活库 500 行、`-wal` 4,124,152 字节、序列化仅 81,920 字节、重开计数仍 500 行、丢失 0），并在并发改库时连做 40 次快照全部 `integrity_check = ok`，未见撕裂。**但不如 `VACUUM INTO` 直接**：它要在内存里攒整个库再手写文件，库变大后内存开销线性上升。故 `serialize()` 只作为"需要字节流而非文件"时的备选。
- 目标目录不存在时自动创建；目标文件已存在时默认**拒绝覆盖**并报 `PATH_EXISTS`，需 `--force`。原稿"默认覆盖"对备份这种幂等命名场景太危险 —— 同日多次备份会互相冲掉。
- 返回 `{"path":"...","size_bytes":N,"item_count":N}`。

#### 5.2.12 `workreport categories`
列出已有分类及其条目数，供 Agent 做**分类归一化**。
```bash
workreport categories --format json
```
```json
[{"category":"A项目","count":42},{"category":"信息部事务","count":17}]
```
- `category` 是自由文本（5.1），"A项目" / "A 项目" / "项目A" 会各自成组，直接把 5.2.9 的日报分组打碎。
- **`add` 之前应先调用本命令取规范名** —— 这条必须写进 5.5.1 的 SKILL 规约，否则日报质量随录入时间衰减。
- `--prefix <s>` 支持前缀查漏，供 Agent 判断"是否已有近似分类"。

> 本命令的优先级高于 `report`：没有分类归一化手段，`report` 输出的是碎片。

#### 5.2.13 `workreport doctor`
环境与库自检，结构化输出，供 Agent 与人类排障。
```bash
workreport doctor --format json
```
```json
{"cli_version":"1.0.0","node":"v24.18.0","data_dir":"/abs/path","db_path":"/abs/path/workreport.db",
 "config_path":"/abs/path/config.json","db_open":true,
 "schema_version":1,"item_count":127,"deleted_count":3,
 "journal_mode":"wal","writable":true,"problems":[]}
```
- `data_dir`／`db_path`／`config_path` 一律回显**展开后的绝对路径**（与 5.3.0 第 3 条一致）—— 这是用户与 Agent 判断"数据到底在哪"的唯一可信出口，也顺带解决 10.1 O13 的口径问题。
- **不探测 FTS5**：本工具不使用 FTS5（D1），报告该能力只会诱导实现去修一个不需要修的东西。
- `problems` 数组的元素**必须是 5.7.3 已有的错误码**，不新造一套健康码词表（评审时曾列 `DB_MISSING`/`WAL_STALE` 等未定义值，已删：它们既无出处也无对应处置，只会让 SKILL 里出现"看到码不知道怎么办"的分支）。空数组表示健康。
- **只读**：不迁移、不修复、不改权限，避免 Agent 借助 `doctor` 产生写副作用。
- `format`／`format_source`（取值 `flag`／`config`／`default`）：回显"其余命令这会以什么呈现形态输出、由谁决定"。5.4 要求的来源标注在 `config list` 落地前先由本命令承担一半；配置非法时这两个字段**缺席**，原因由 `problems` 里的 `CONFIG_INVALID` 说明 —— 缺席比报一个假装生效的值诚实。
- `sqlite3` 依赖自检在此暴露，不再散落到 `--help`（原稿 5.3.1 的"首次降级时警告"没有结构化出口，Agent 无法判断，故由本命令承担）。

#### 5.2.14 `workreport describe`

导出命令面与契约的机器可读自描述，供 Agent 在运行时获取真实参数规格，替代 SKILL.md 里手抄的命令表。

```bash
workreport describe --format json
```

返回结构（字段名即契约）：

```json
{
  "version": "1.0.0",
  "commands": [
    {"name":"add","flags":[{"name":"--content","type":"string","required":true},
                            {"name":"--status","type":"enum","values":["planned","in_progress","done","blocked"]}]}
  ],
  "constraints": [
    {"when":"item_type=log","forbid":"status=planned","error_code":"CONFLICT_STATUS_PLANNED_FOR_LOG"}
  ],
  "error_codes": [{"code":"NOT_FOUND","exit":1}],
  "exit_codes": [{"code":1,"meaning":"business_or_validation"}],
  "limits": {"content_max_chars":2000,"default_limit":200}
}
```

要求：
- 该输出**必须由命令定义的同一份元数据生成**，不允许另写一份常量表 —— 否则自描述本身就是漂移源。
- `describe` 输出同样受 5.7.1 的 semver 治理。
- 只读命令，不打开数据库，因此**必须能在 DB 损坏时正常工作**（这正是 Agent 需要用它判断环境的地方）。

#### 5.2.15 `workreport export` / `workreport import`（后续迭代）
- 导出格式：JSON Lines（每行一个工作项）。
- 导入时若 `id` 冲突，默认跳过并报告；支持 `--force` 覆盖。
- 支持增量导入。
- 因 `workreport add` 会重新生成 `id`，`import` 是**保留原 id 的唯一路径**，也是跨机器迁移与 schema 降级救险的唯一手段 —— 因此它虽排在后续迭代，但 `schema_version` 迁移（10.1 O10）定稿时须一并预留其格式版本字段。

### 5.3 存储方案

- **数据库**：SQLite，驱动为 Node 内置 **`node:sqlite`**（无原生模块，决策 D38，实测见附录 B）。
- **全局目录**（数据）：
  - Linux：`~/.local/share/workreport/workreport.db`
  - macOS：`~/Library/Application Support/workreport/workreport.db`
  - Windows：`%APPDATA%\workreport\workreport.db`（`Roaming`，路径含空格，见第 6 节）
- **配置目录**：一律由 `env-paths` 的 `config` 给出，**不再手写路径常量**。
  - Linux：`~/.config/workreport/`
  - macOS：`~/Library/Preferences/workreport/`
  - Windows：`%APPDATA%\workreport\`
- **数据目录与配置目录在 Windows 上同为 `%APPDATA%\workreport\`** —— 这是 `env-paths` 的实际行为，第 8 节据此修正，不再声称两者分离。
- 环境变量覆盖：`WORKREPORT_HOME` 指定数据目录，优先级高于 `config.json`。
- 不在任何运行目录创建文件。

#### 5.3.0 路径展开规则（不依赖 shell）

**所有接受路径的入参（`--output`、`--db`、`config set data_dir`、`WORKREPORT_HOME`）必须由 CLI 自行展开 `~`、`$HOME`、`%APPDATA%` 与相对路径，不得假设 shell 已处理。**

理由：AI Agent 经 `execFile`/`spawn` 调用 CLI 时**不经过 shell**，`~/backups/x.db` 会原样传入。若不展开，CLI 会在**当前工作目录**下创建一个字面名为 `~` 的目录 —— 直接违反第 1 节"零运行目录污染"这条核心原则，且不报错、只留下垃圾。

实现要求：
1. `~` / `~/x` → `os.homedir()` 拼接；`$VAR` / `%VAR%` 两种写法都支持（Windows 下 Agent 常抄到 `%` 写法）。
2. 展开后再 `path.resolve`，禁止把未展开字符串交给 `fs`。
3. 展开结果须在 `doctor` 与 `config get` 输出中回显为**绝对路径**，让人与 Agent 都能看见真实落点。
4. 无 `~` 前缀且非绝对的路径按当前工作目录解析，但须在 stderr 提示（可被 `--quiet` 抑制）—— 因为这几乎总是调用方的错误。

#### 5.3.1 关键词检索实现（不引入 FTS5）

**决策**：`search` 与 `list --keyword` 统一使用 `content LIKE ? ESCAPE '\'` 子串匹配，不使用 FTS5，不设降级分支。

**理由**（实测于 SQLite 3.53.1 / Node v24.18.0，20000 行中文语料）：

| 方案 | 查询 | 命中 | 耗时 |
| :--- | :--- | :--- | :--- |
| `LIKE '%kw%'` | `登录` | 3334 行 | 6.06 ms |
| `LIKE '%kw%'` | `支付回调超时` | 3334 行 | 4.95 ms |
| FTS5 `unicode61` | `登录` / `接口联调` / 整句 | **0 行** | — |
| FTS5 `trigram` | `登录`（2 字） | **0 行** | 0.01 ms |
| FTS5 `trigram` | `支付回调超时`（4 字） | 3334 行 | 1.55 ms |

- `unicode61` 以"非字母字符"为分隔符；中文无空格，整句被切为单一 token，任意子串查询恒为 0。
- `trigram` 的 token 固定为 3 字符滑窗，**2 字中文词（登录 / 支付 / 联调 / 权限 / 缓存）在索引中不存在**，属硬限制，不可配置绕过。
- FTS5 快约 4 倍，但查询仅占 200ms 预算（见第 6 节）的 3%，而本工具数据量为个人记录量级（千级）。
- 中文可用的 FTS5 路径（ICU 编译期分词器、C 层自定义分词插件、JS 预分词影子列）实现与维护成本均远高于收益。

**实现约束（必须遵守）**：

1. **通配符转义**：`%`、`_`、`\` 是 `LIKE` 元字符。按序转义 `\` → `\\`、`%` → `\%`、`_` → `\_`，并统一声明 `ESCAPE '\'`。漏转义会使含 `%` 的关键词返回错误结果且**不报错**。
2. **参数绑定**：关键词一律经占位符绑定（`LIKE ?`），禁止字符串拼接。
3. **大小写**：SQLite `LIKE` 对 ASCII 不区分大小写（`api` 命中 `API`），对非 ASCII 区分。此为预期行为，须在 `--help` 与 SKILL.md 中声明。
4. **空关键词**：`--keyword ""` 或纯空白必须报 `VALIDATION_ERROR`，不得退化为无条件全表返回。
5. **多词与排序**：v1 不分词、不做相关性排序；关键词含空格时按整串子串匹配。结果排序规则与 `list` 一致（见 5.2.3）。
6. **无命中语义**：返回空集合（见 5.2.1），禁止用错误码表达"无结果"。

**再评估触发条件**：仅当 `search` 在真实数据上实测超过 200ms 预算时，才重新评估检索方案；在此之前不得为此增加索引或分词依赖。

#### 5.3.2 Schema 版本与迁移

**这是 M0 的交付物，不是后续优化项。** 原稿全文未提迁移策略；一旦用户升级 CLI 而复用旧库，无 `schema_version` 就是直接崩库，而本工具在 v1 前没有 `import`／`export` 可自救（10.1 O10）。

- `work_items` 建表时同步建 `schema_version(version INTEGER NOT NULL)` 单行表；新库初始化为当前版本。
- 每次启动（除 `describe`）在一个事务内完成：读版本 → 顺序应用 `migrations[N]` → 写新版本 → 提交。
- 迁移数组**只追加不改写**，历史迁移文件不可修改 —— 否则老用户升上来会走到不同路径。
- 迁移失败必须回滚并保持原版本号，报 `MIGRATION_FAILED`（退出 `3`），**不得留下半迁移的库**。
- `schema_version > 本 CLI 支持版本` → `SCHEMA_TOO_NEW`，提示"请升级 workreport"，绝不尝试降级解释。
- 存在 `.db` 文件但无 `work_items` 表 → `DB_NOT_INITIALIZED`，不静默建表（静默建表会把一个误指向的非本工具库变成"看起来正常"的空库，用户以为数据没了）。
- 迁移须在三平台 CI 上跑"旧版本建库 → 新版本打开"的用例，这是唯一能真正验证它的方式。

### 5.4 配置管理

配置文件 `config.json`：
```json
{
  "data_dir": "/home/user/.local/share/workreport",
  "default_category": null,
  "default_status": "done",
  "default_format": "json"
}
```
- `config set` 写入配置；`data_dir` 一律存**展开后的绝对路径**（见 5.3.0），`config get` 原样回显，不再二次解析。
- `config get` 读取。`config list` 输出全部生效值，**并标注每项的来源**（`env` / `file` / `default`）—— 否则用户无法解释"为什么改了配置没生效"。
- **三个默认值都真被消费**（D47）：`data_dir` 决定落点；`default_category` / `default_status` 是 `add` 的缺省来源（`default_status` 只作用于 `log`，`plan` 的状态缺省仍是 `planned`，否则会给计划项塞进一个与类型相悖的状态）；`default_format` 是**未显式给 `--format` 时**的呈现缺省，优先级恒为 `--format` > 配置 > `json`。
- 配置里的值非法**不静默回落**（D31 同一判据）：`default_format` 非 `json|table|markdown` → `CONFIG_INVALID`、退出 `3`。`doctor` 例外 —— 它把 `CONFIG_INVALID` 记进 `problems`，并让 `format`／`format_source` 两个字段**缺席**，而不是报一个假装生效的值。

**配置解析顺序（写死，唯一优先级）**
```
--db 参数  >  环境变量 WORKREPORT_HOME  >  config.json 的 data_dir  >  env-paths 平台默认值
```
- 非法 JSON → `CONFIG_INVALID`（退出 `3`），**不得静默回落默认值**：回落会让一次配置写错的表现为"数据凭空消失"，是最难排查的故障形态。
- `default_status` 须与 `item_type` 联动校验（`log` 不能默认 `planned`），否则配置本身就能制造 5.1.1 违规。非法值报 `CONFIG_INVALID`。

### 5.5 AI / SKILL 集成

CLI 不集成 AI。外部 Agent 通过 SKILL 调用 CLI。

**SKILL.md 不写命令细节** —— 参数、枚举、错误码一律运行时取自 `workreport describe`（5.2.14）。下面列的是**编排策略**，即那些 CLI 无法自描述、必须由 Agent 承担的知识：

- **分类归一化优先于写入**：`add` 之前先 `workreport categories`，把用户口语（"A 项目"）映射到已有规范名（"A项目"）。这是日报质量的第一道防线 —— 分类碎片化不可逆，只能靠录入时约束（见 5.2.12）。
- **相对日期归 Agent**："上周五""明天"必须由 Agent 解析成绝对 `YYYY-MM-DD` 再传参，CLI 不做自然语言日期。同时按 5.1 的时区约定，用**用户本地日历**而非 UTC 日期。
- **计划区日期归 Agent**：`report --planned-for` 需 Agent 算出"下一个工作日"，CLI 不猜（见 5.2.9）。
- **改前先读**：`update` / `convert` / `delete` 一律先 `show` 或 `list` 定位 `id`，不凭记忆拼 ID。
- **长内容走 stdin**：内容含引号、换行或接近上限时用 `--content -`，不要拼进命令行（见 5.2.2）。
- **截图识别**由 Agent 视觉能力完成，识别后 `add --source screenshot`。
- 各意图到命令的映射示例见附录；示例若与 `describe` 冲突，**以 `describe` 为准**。

#### 5.5.1 契约获取与错误处理（SKILL 必须写明）

- **不硬编码命令面**：Agent 首次调用或调用失败时读取 `workreport describe --format json` 获取参数、枚举与错误码，而非依赖 SKILL.md 里的静态示例。
- **按 `code` 分支，不按文案分支**：`error` 描述可随版本变化。
- **退出码 `1`**：读 `code` 修正参数后重试一次；仍失败则报告用户。**禁止**对同一参数原样重试。
- **退出码 `2`**：视为自身调用方式错误，回到 `describe` 纠正，不重试。
- **退出码 `3`**：立即停止并转告用户（环境或数据问题），**不得**自动重试或改写数据。
- **幂等约束**：`add` 非幂等。写操作超时或结果未知时，必须先 `list` 校验是否已写入，再决定是否重试 —— 否则产生重复记录。
- **删除前置**：调用 `delete` 前必须先 `show`/`list` 确认目标条目，并向用户复述确认。

#### 5.5.2 SKILL 部署方式

- `SKILL.md` 放置在 Agent 客户端指定的 skills 目录，或项目根目录。
- 具体路径取决于客户端（如 Claude Code 的 `.claude/skills/`，Cursor 的 `.cursor/skills/` 等）。
- 建议在项目文档中提供各客户端的部署示例。

### 5.6 输出格式

呈现层细节，数据流契约见 5.2.1，二者不得互相重复定义。

- 默认 `json`，便于 Agent 解析；`default_format` 配置可改默认值。
- `--format table`：人类可读表格，列固定为 `ID`、`日期`、`类型`、`分类`、`状态`、`内容`。
  - `ID` 列显示**短前缀**（默认 12 字符，见 5.1.3 与 D46），非完整 ULID。
  - `内容` 超 40 字符截断加 `…`；**换行替换为空格**，避免破表。
  - 列宽按终端宽度自适应；非 TTY 时用固定宽度。
- `--format markdown`：每行 `- [日期] 内容 (分类)`；`内容` 内换行同样替换为空格。
- 空结果：见 5.2.1（JSON 为空集合信封，table/markdown「无记录」，退出码 `0`）。

### 5.7 错误契约（稳定 API）

#### 5.7.1 治理规则

错误码与退出码是**对外契约的一部分**，与命令面同等对待：

- 码值集合受 semver 治理：**新增**码为 minor 版本；**删除**码、**改名**、**变更退出码归属**为 major 版本。
- 码表由 `workreport describe --format json` 机器可读导出（见 5.2.14）。**SKILL.md 不得手抄码表与枚举值**，须在运行时读取 `describe` 输出，否则文档必然与实现漂移。
- 实现层要求：错误码集中定义于单一模块（枚举常量 + 退出码映射表），禁止在各命令内散落字符串字面量。

#### 5.7.2 退出码

分档依据是**谁能修** —— 这决定 Agent 该重试、该改参数、还是该停下来交给人类：

| 码 | 含义 | Agent 应有动作 |
| :--- | :--- | :--- |
| `0` | 成功（含空结果） | 继续 |
| `1` | 业务／校验错：参数可修正后达成合法 | 读 `code`，重组参数重试；不可盲目原参数重试 |
| `2` | 用法错：未知命令／flag、缺必填（框架层拦截） | 命令本身写错，按 `describe` 纠正调用方式 |
| `3` | 环境错：DB 锁定／损坏、路径不可写、配置非法、迁移失败 | **停止**，向用户报告，不得重试 |

#### 5.7.3 错误码表

| code | 触发条件 | 退出码 |
| :--- | :--- | :--- |
| `USAGE_ERROR` | 未知子命令／flag，或框架层必填缺失 | 2 |
| `VALIDATION_ERROR` | `date`/`time`/`planned_for` 格式非法、枚举值非法、`keyword` 为空白、`content` 为空 | 1 |
| `CONFLICT_STATUS_PLANNED_FOR_LOG` | `item_type=log` 且 `status=planned`（5.1.1 禁止） | 1 |
| `CONFLICT_PLANNED_FOR_ON_LOG` | `item_type=log` 且 `planned_for` 非空 | 1 |
| `CONFLICT_PLAN_MISSING_PLANNED_FOR` | `item_type=plan` 且 `planned_for` 缺失 | 1 |
| `NOT_FOUND` | `--id` 无匹配记录 | 1 |
| `AMBIGUOUS_ID` | `--id` 短前缀命中多条（见 5.1.3、D25），错误对象带 `matches` | 1 |
| `CONVERT_SOURCE_TYPE_MISMATCH` | `convert` 的源项 `item_type` 与 `--to` 要求不符（含 `--to log` 但源已是 `log`） | 1 |
| `DELETED` | 目标已被软删除，需 `restore` 或 `--include-deleted` | 1 |
| `DB_LOCKED` | WAL 下 `busy_timeout` 耗尽，重试后仍失败 | 3 |
| `DB_CORRUPT` | 库文件损坏或不是 SQLite 数据库 | 3 |
| `MIGRATION_FAILED` | schema 版本高于本 CLI，或迁移中断已回滚 | 3 |
| `PATH_NOT_WRITABLE` | 数据目录／备份／报告目标不可写或创建失败 | 3 |
| `PATH_EXISTS` | `backup`／`report --output` 目标文件已存在且未给 `--force` | 1 |
| `SCHEMA_TOO_NEW` | 库的 `schema_version` 高于本 CLI 支持版本 | 3 |
| `DB_NOT_INITIALIZED` | 目标库存在但无 `work_items` 表 | 3 |
| `CONFIG_INVALID` | `config.json` 解析失败或字段值非法 | 3 |

- `CONVERT_SOURCE_TYPE_MISMATCH` 覆盖两个方向（`--to log` 但源已是 `log`、`--to plan` 但源已是 `plan`），由 `expected`／`actual` 字段区分，不再各占一个码（见 5.2.5）。

---

## 6. 非功能需求

- **性能**：单次命令响应 < 200ms（1000 条记录以内）。该预算的大头是 Node 进程冷启动与模块加载；数据操作本身在 20000 行量级下实测约 6ms（见 5.3.1），不构成瓶颈。指标须包含完整进程时间（从进程启动到输出结束），不含 npm 全局安装。
- **并发安全**：启动时 `PRAGMA journal_mode=WAL`、`busy_timeout=5000`、`synchronous=NORMAL`、`wal_autocheckpoint=10000`（D49）；写操作置于单个 IMMEDIATE 事务内。仅靠"SQLite 事务"不足以保证多进程写入安全 —— 默认 rollback-journal 模式下并发写直接 `SQLITE_BUSY`。
  - **durability 档位的确切含义**（按 SQLite 的 `pragma` 文档）：WAL 下 `synchronous=NORMAL` 是"每次 checkpoint 前 sync WAL、checkpoint 完成后 sync 库文件、复用 WAL 时 sync 文件头，**多数事务期间不做任何 sync**"。因此**应用崩溃不丢已提交事务**（这一点与 `synchronous` 设置无关），而**掉电或 OS 崩溃时，最近若干笔已提交但尚未 checkpoint 的记录可能回滚**；库本身不会损坏。用户 2026-09-29 明确接受该交换。
  - **为什么非换不可**（本地实测，4 进程 × 250 个 IMMEDIATE 事务，schema 由真实 CLI 建库，脚本见 `spikes/o16-lock-contention/`）：

    | 画像 | 总耗时 | `SQLITE_BUSY` | p95 | p999 |
    | :--- | ---: | ---: | ---: | ---: |
    | FULL（原设置） | 139.75s | **5** | 2559ms | 5527ms（撞满 5 秒预算） |
    | FULL + `wal_autocheckpoint=10000` | 50.99s | **12** | 154ms | 5545ms |
    | FULL + `busy_timeout=15000` | 148.94s | 0 | 2901ms | 9135ms |
    | **NORMAL** | 2.85s | 0 | 0.3ms | 681ms |
    | **NORMAL + `wal_autocheckpoint=10000`** | 1.27s | 0 | 0.3ms | 258ms |

    根因是**锁被持有多久**，不是**等待预算多大**：FULL 下每次 COMMIT 都 fsync，写锁持有从 ~40ms 起，四个进程排队后必然有人把 5 秒预算耗光；把预算放宽到 15 秒只是让人等更久而已（p999 反而 9.1s），只调 checkpoint 阈值甚至让失败变多。
  - **对单命令的影响有限**：`add` 端到端 327ms → 286ms（约 12%），因为大头是进程冷启动与写路径开销；数量级的收益在批量与并发场景。性能预算那句"单次命令 < 200ms"仍未达成，瓶颈另有其处（见 10.1 O17）。
  - 驱动侧注意：`busy_timeout` 这个 PRAGMA 的返回列名是 **`timeout`** 而非 `busy_timeout`，`doctor` 读取时按 `timeout` 取。
- **可移植性**：支持 Linux、macOS、Windows。
- **依赖最小化**（与第 7 节的选型判断保持一致）：
  - 运行时依赖：`commander`、`ulid`、`env-paths` —— **SQLite 走 Node 内置 `node:sqlite`，无原生模块**（O9 已闭合，见 D38）。
  - `dayjs` **待评估删除**：CLI 只需取本地今天、校验 `YYYY-MM-DD`、字典序比较日期，原生能力足够（见第 7 节）。
  - 开发依赖：`typescript`、`vitest`、`tsup`。
  - **检索零额外依赖**：不使用 FTS5、不引入分词器、不引入 ICU（理由与实测见 5.3.1）。`search` 与 `list --keyword` 共用同一实现。
  - 所有路径参数（`--output`、`--db`、`config` 的 `data_dir`）由 CLI 自行展开 `~` 与 `$VAR`，**不得依赖 shell** —— Agent 经 `execFile` 调用不经过 shell，未展开会污染当前工作目录，违反第 1 节"零运行目录污染"。
- **Node 版本**：`engines.node` 暂定 **`>=24.0.0`**。依据：`node:sqlite` 在 v24.18.0 实测可用且**不产生 ExperimentalWarning**（stderr 干净，不违反 5.2.1 的流契约）。22.x 未测 —— 若要下探须另验，不要凭"22.5 起存在"直接写 `>=22.5.0`。
- **安装**：`npm install -g @phinnpeng/workreport`。采用 `node:sqlite` 后此路径**不再有编译工具链要求**（无 prebuilt 下载、无 node-gyp），这是驱动决策的主要收益。
- **数据隐私**：所有数据本地存储，**运行期零网络请求**。选 `node:sqlite` 后连安装期的 prebuilt 下载也消失，供应链面缩到三个纯 JS 包。
- **Windows 兼容性**：目录由 `env-paths` 给出（第 8 节）；数据目录路径含空格（`AppData\Roaming`），错误信息与 `doctor` 回显须原样带空格而非截断。原生模块编译风险随 `node:sqlite` 的采用而消失。

---

## 7. 技术栈

| 组件 | 选型 |
| :--- | :--- |
| 语言 | Node.js + TypeScript |
| 数据库 | SQLite，驱动 **`node:sqlite`**（Node 内置，零原生依赖；spike 实测见附录 B，决策 D38） |
| CLI 框架 | `commander`（定稿，不再二选一） |
| 日期处理 | **优先用原生 `Date` + `Intl.DateTimeFormat`**，`dayjs` 待评估是否可去掉 |
| ID 生成 | `ulid`，须用**单调递增工厂**（`monotonicFactory()`） |
| 关键词检索 | SQLite `LIKE ... ESCAPE`（不使用 FTS5，理由见 5.3.1） |
| 平台目录 | `env-paths`（定稿，见第 8 节） |
| 包管理 | npm |
| 测试 | `vitest`（定稿） |
| 构建 | `tsup`（定稿） |

两处依赖判断说明：

- **`dayjs` 可能是多余的**。第 5.5 节已把"上周五""明天"这类相对日期解析划归 Agent，CLI 侧只剩三件事：取本地今天（`YYYY-MM-DD`）、校验格式、比较大小。字符串按字典序比较对 `YYYY-MM-DD` 天然正确，无需日期库。这与"依赖最小化"（第 6 节）直接相关 —— 定稿前请按此复核。
- **`ulid` 必须用单调工厂**。默认 `ulid()` 在同一毫秒内取 `Date.now()`，同毫秒批量写入（Agent 一次补录多条）会失去排序保证，而 5.2.3 的全序分页与 D25 的前缀唯一性都建立在"id 随时间单调"之上。

---

## 8. 目录规范

**目录一律由 `env-paths` 给出，代码中不得出现手写平台路径。** 原稿 5.3、5.2.10、本节三处对备份目录与配置目录的说法互不一致，现统一如下：

| 平台 | 数据目录（`paths.data`） | 配置目录（`paths.config`） |
| :--- | :--- | :--- |
| Linux | `~/.local/share/workreport/` ✅CI 实测 | `~/.config/workreport/`（同） |
| macOS | `~/Library/Application Support/workreport/`（同） | `~/Library/Preferences/workreport/`（同，**存疑项已落定**） |
| Windows | `%LOCALAPPDATA%\workreport\Data\` ✅实测 | `%APPDATA%\workreport\Config\` ✅实测 |

> ✅ 标记的行是 M0 实现期在 Windows 上实测得出（`doctor` 回显）。**原稿写的 `%APPDATA%\workreport\` 是错的**，且派生出一条错结论（见下）。三行现均由 AC-8 的三平台 CI 实测断言：`npm run ci:paths` 在三台 runner 上各跑一次 `doctor`，把实际 `data_dir`／`config_path` 与本表逐条比对，Ubuntu 24.04 / macOS 14 / Windows 全部相符（run 36530 起）。

```
<数据目录>/
├── workreport.db                   # SQLite 主库
├── workreport.db-wal               # WAL（见第 6 节）
├── workreport.db-shm
└── backups/                     # 默认备份目录 —— 在数据目录之内，不是 ~/backups
    └── workreport-YYYY-MM-DD.db

<配置目录>/config.json
```

三条必须照办的推论：

1. **Windows 上数据目录与配置目录是两个不同目录**：实测为 `%LOCALAPPDATA%\workreport\Data\` 与 `%APPDATA%\workreport\Config\`。原稿"两者同为 `%APPDATA%\workreport\`、config.json 与 workreport.db 并列"的说法**已被实测推翻**（它派生自 D27 的一次未验证断言）。影响：只备份 `%APPDATA%` 会漏掉整个数据库，因为库在 `%LOCALAPPDATA%` 下 —— 备份与迁移文档必须按两个目录写。
2. **备份默认落在 `<数据目录>/backups/`**，而非 `~/backups/`。理由：用户迁移或整体备份时只需处理一个目录，且 `WORKREPORT_HOME` 覆盖后备份跟随移动，不会出现"数据在新址、备份在老址"的割裂。
3. `WORKREPORT_HOME` 只覆盖**数据目录**；配置目录不受其影响（否则改一个环境变量会把 `config.json` 也搬走，导致下次启动读不到配置）。临时换库用 `--db`。

> 该表已由 CI 实测收口：`env-paths` 的 macOS `config` 实际返回 `~/Library/Preferences/workreport`（不是 `Application Support`），Linux 为 `$XDG_CONFIG_HOME 或 ~/.config` 之后**仍追加应用名**。二者均由 `doctor` 回显、由 `npm run ci:paths` 断言，实现未照抄本表写死路径（O13 已闭合）。

---

## 9. 里程碑

| 阶段 | 内容 | 预计 |
| :--- | :--- | :--- |
| **M0** | **地基**：schema + `schema_version` 迁移框架（5.3.2）、WAL/busy_timeout、流分离契约与紧凑 JSON（5.2.1）、错误码与退出码骨架（5.7）、路径展开（5.3.0）、`describe`（5.2.14）、三平台 CI matrix | 1 周 |
| M1 | `add` / `list` / `search` / `show` / `categories`（含信封与全序分页） | 1 周 |
| M2 | `update` / `convert` / `delete` + `restore` + `purge` / `config` / `backup` / `doctor` | 1.5 周 |
| M3 | 可选 `report` 命令 + 模板 | 3 天 |
| M4 | SKILL.md（按 5.5.1：只写编排策略，命令细节引 `describe`）+ 文档 | 2 天 |
| M5 | 发布打磨：`engines.node`、bin 冒烟测试、跨平台手工验收 | 3 天 |

**排序修正**：
- **M0 是新增阶段**。原稿把迁移、契约、CI 全放到 M5"跨平台测试与发布"，但这些是地基 —— 先写命令再补契约，等于把 5.2/5.3 全部命令重写一遍。
- **`search` 从 M2 提前到 M1**：4.7 与 5.5 的 Agent 流程是"先搜到 id 再操作"，`search` 不在 M1 就没法端到端验证任何写命令。
- **CI 从 M5 提前到 M0**：没有三矩阵流水线，Windows 的路径展开与引号问题会在 M5 集中爆发。
- 总工期从原估 4 周调整为约 5 周。原估未计入 M0，且把驱动选型当成"测一下"，实际是阻塞 M0 的决策项（已由 D38 的 spike 闭合）。

---

## 10. 待确认

- **项目名称**：现为 **`@phinnpeng/workreport`**（命令名 `workreport`，GitHub 仓库 `PhinnPeng/WorkLog`）。原名 `worklog` 于 2026-09-24 整体更名（D44，取代 D37），仓库名次日单独定为 `WorkLog`（D50）；当年走 scoped 是因为裸名 `worklog` 与 `worklog-cli` 实测均被占用，那段实测记录仍原样保留在 10.2。两项待自证事项未变：scope 归属、npm 登录态。
- **里程碑时间估算**：已在第 9 节重估完毕（新增 M0、`search` 与 CI 提前、总工期 4 周 → 约 5 周），此项**已闭合**，保留仅为可追溯。

### 10.2 名称占用实测（2026-09-24，npm registry + GitHub API）

| 候选 | 结论 | 证据 |
| :--- | :--- | :--- |
| `worklog` | **占用** | v0.1.9，maintainer `distilledhype`，last modified **2022-06-29**，描述"Log your work to a specific file, from the cli." —— 语义与本工具高度重叠，但已停更 4 年 |
| `worklog-cli` | **占用** | v1.0.2，maintainer `ramyalakhani`，last modified **2025-06-18**，描述"A CLI tool for managing worklogs and timesheets" —— 活跃且语义重叠 |
| `phinn-worklog` / `worklog-cli-tool` / `pwlog` / `worklogx` | 可用 | registry 查询无返回 |
| **`@phinnpeng/worklog`** | ~~采用~~ → **作废**（D44 更名） | 原实测：registry 返回 404（包名空置）。该结论针对旧名，按原样保留为历史证据 |
| `github.com/phinnpeng` 用户 | 存在 | API `200` |
| `github.com/phinnpeng/worklog` 仓库 | 可用（已不用此名） | API `404` |
| **`@phinnpeng/workreport`** | **采用** | 2026-09-24 复测：`npm view @phinnpeng/workreport` → 404（无人发过此包） |
| `workreport` / `workreport-cli` / `pwreport` | 可用 | 2026-09-24 复测：`npm view` 均 404。注意这只证明**没有同名包**，不等于没有任何包声明了 `bin: workreport` —— 但上表那两个抢过 `worklog` bin 的包与本命令名无关 |
| `github.com/PhinnPeng/WorkReport` 仓库 | **已存在** | 2026-09-24 复测：API `200`，`private: false`，`default_branch: main`，`size: 0` 且 `pushed_at == created_at`（空仓，尚无提交）。**2026-09-29 该仓库改名为 `PhinnPeng/WorkLog`**：旧名 API 返回 301 → `repositories/1385154844`，规范名 `PhinnPeng/WorkLog`，repo id 不变（同一仓库，见 D50） |

**两点尚未证实，发布前须自己确认**（我无法从命令行验证，返回码不构成结论）：

1. **npm scope `phinnpeng` 的归属**。`www.npmjs.com/~phinnpeng` 与 `/org/phinnpeng` 均返回 **403**（反爬拦截，非"不存在"），`registry.npmjs.org/-/user/org.couchdb.user:phinnpeng` 返回 **401**（该端点本身要求鉴权）。→ 包名 404 只证明这个包没人发过，**不证明这个 scope 归你**。需在 npm 网站登录/注册后确认。
2. **本机 npm 未登录**：`npm whoami` → `need auth`。发布需先 `npm adduser` 并 `npm access` 权限设置。

**一个比包名更要紧的事实**：上面两个已占用的包**都声明了 `"bin": {"worklog": ...}`**（`worklog`→`cli.js`，`worklog-cli`→`index.js`）。

含义：`worklog` 这个**全局命令名本身是竞争资源**，不只是 registry 名字。第 1 节"若被占用则改用 `@scope/worklog`，**命令名保持 `worklog`**"这句话现在需要重新审视 —— 换 scoped 包名能解决 registry 冲突，但**解决不了全局 bin 冲突**：若用户此前装过那两个包中的任一个，`npm i -g <我们的包>` 会去抢同一个 `worklog` 可执行入口。

这不阻断开发（本地 `npm link` 与干净环境下无感），但它是发布前必须处理的一项，且会影响 README 的安装说明写法。**后续：2026-09-24 的更名（D44）把命令名从 `worklog` 换成了 `workreport`，上面这条 bin 争抢因此不再成立**，README 按 scoped 包名常规写法即可；本节真正遗留的仍是上面两点（scope 归属、npm 登录态）。

### 10.1 开放决策（评审中挂起）

| # | 议题 | 挂起于 |
| :--- | :--- | :--- |
| O9 | ~~`better-sqlite3` vs 内置 `node:sqlite`~~ | **已闭合：采用 `node:sqlite`，去掉 `better-sqlite3`**。spike 实测见附录 B 与 D38；`engines.node` 下限暂定 `>=24.0.0`（仅在 v24.18.0 验证过，若要下探 22.x 需另测） |
| O11 | ~~计划完成率统计~~ | **已闭合：不做**（用户 2026-09-24 明确"不需要计划完成率"）。见 D33 |
| O12 | ~~`--count` 是否入 `describe.limits`~~ | **已闭合：`--count` 整个删掉**，问题不存在。见 D34 |
| **O14** | ~~包名未定~~ | **已闭合：采用 `@phinnpeng/workreport`，命令名 `workreport`**（用户 2026-09-24 先定 `worklog`（D37），同日更名，见 D44）。遗留两项发布前须自证：scope 归属、npm 登录态（10.2） |
| ~~O13~~ | ~~第 8 节的三平台目录表未按实测校验~~ | **已闭合（2026-09-29）**：三平台 CI 各跑一次 `doctor`，实际落点与第 8 节逐条相符 —— macOS 的 `config` 确为 `~/Library/Preferences/workreport`，Linux 的 XDG 变量只替换基目录、`env-paths` 仍追加应用名。断言在 `.github/workflows/ci.yml` + `npm run ci:paths` |
| ~~O16~~ | ~~AC-3 出现真实 `SQLITE_BUSY`，判据是"重试由谁做"~~ | **已闭合（D49，用户 2026-09-29 接受掉电窗口换吞吐）**：根因不是等待预算而是**锁持有时间** —— `synchronous=FULL` 下每次提交都 fsync，写锁持有 ~40ms 起，四进程排队必然有人烧光 5 秒预算。改 `synchronous=NORMAL`（+`wal_autocheckpoint=10000`）后同一负载 139.75s／5 笔失败 → 1.27s／0 笔。①（CLI 退避）与②（放宽预算）经实测**都不缩短时间**：②总耗时 148.94s 且 p999 9.1s，①本地照样漏 16 笔失败 |
| **O17** | 第 6 节的性能预算"单次命令响应 < 200ms"未达成：实测 `add` 端到端 267–378ms（`synchronous=NORMAL` 后 260–313ms），只读 `doctor` ~130ms。差额主要在 Node 进程冷启动 + 模块加载与写路径建立（打开 WAL/ shm、迁移检查），而非数据操作。候选：①把预算改成与实测相符并按场景分档（只读 vs 写入）；②压启动成本（bundle 体量、懒加载 commander）；③接受现状不写预算 | 待用户拍板（现值仍按 PRD 原文挂着，未静默改指标） |
| **O15** | ~~`limits.id_prefix_display` 是否从 8 加长~~ | **已闭合：改为 12**（用户 2026-09-29 拍板"加长"）。判据与实测见 5.1.3、D45、D46；`describe.limits` 广告值随之变化，属 minor |

> O1–O8、O10–O16 已定稿，收进第 11 章 **D12–D51**（该章按「检索与存储／输出契约／命令语义」三节编排，非连续对应关系）。后续事项已转 Trellis 任务承载；O15 由 D46 闭合、O16 由 D49 闭合，**O17 待拍板**。

---

## 11. 已决策记录（v0.5 → v0.6）

### 11.1 检索与存储

| # | 决策 | 状态 | 落点 |
| :--- | :--- | :--- | :--- |
| D1 | **移除 FTS5**，中文检索统一 `LIKE ... ESCAPE`；无分词器／无 ICU／无全文依赖 | 已实测验证（SQLite 3.53.1，`unicode61` 中文恒 0 命中，`trigram` 对 2 字词恒 0） | 5.1.2、5.3.1、第 6 节、第 7 节 |
| D12 | 约束**必须落 DB 层 `CHECK`**，CLI 校验只负责美化错误信息；`content` 上限 2000 字符；`source` 改 `NOT NULL DEFAULT 'user'` | 已定稿 | 5.1.1、5.1.4 |
| D13 | **删除低基数单列索引**（`idx_status`/`idx_item_type`），改为按查询形态建复合索引 + 软删除部分索引 | 已定稿 | 5.1.2 |
| D14 | **schema 迁移框架属 M0**，含 `schema_version` 表、只追加的迁移数组、失败回滚、`SCHEMA_TOO_NEW`、非本工具库不静默建表 | 已定稿 | 5.3.2、第 9 节 |
| D15 | 时区写死：`*_at` 为 UTC 带 `Z`，`date`/`time`/`planned_for` 为**无时区本地日历值**，不做换算 | 已定稿 | 5.1 |
| D16 | **不加 `converted_from` 溯源列**。理由：SQLite 加可空列成本极低，"现在不加以后贵"的论证不成立；当前目标（2.1）无一处依赖完成率统计 | 已定稿（O11 已由 D33 确认关闭） | 5.2.5 |
| D38 | **采用 Node 内置 `node:sqlite`，移除 `better-sqlite3`**。判据：D1 已确定不用 FTS5，原生模块的最大收益消失，而 `npm i -g` 零编译是直接收益。原稿假设的 `backup()` 在 `node:sqlite` **确实不存在**，备份改走 `VACUUM INTO`（实测 2100→2100 完整、产物无 WAL 附属文件）。并发写、快照一致性、错误码、冷启动、无实验警告五项均有实测数字 | 已定稿（关闭 O9）；跨平台待 M0 CI 复跑 | 第 6、7 节、5.2.11、附录 B |
| D39 | **DB `CHECK` 不作为错误码来源**：实测所有 CHECK 违规 `errcode` 恒为 275、无法区分是哪条约束，故 CLI 前置校验是唯一能给出精确 `CONFLICT_*` 的地方；CHECK 失败统一映射 `VALIDATION_ERROR`。驱动错误分支一律用 `err.errcode`（`err.code` 恒为 `ERR_SQLITE_ERROR`，不可用） | 已定稿 | 5.1.1、5.2.2、5.7.3 |

| D40 | **不引入数据库迁移工具，维持手写迁移数组**。四条冲突：① goose/dbmate/sqitch 默认"库存在但无版本表就初始化"，正是 AC-2 禁止的静默建表动作；② 各工具自带历史表（`goose_db_version`、带 checksum 的 `schema_migrations`）与我们的 `schema_version` 构成两份版本真相，违反 D6/门禁 C 的同源原则；③ 其"逐文件应用 + 标记未应用"的恢复语义与我们 `MIGRATION_FAILED` 需整体回滚的要求不符；④ 唯一现成的 `better-sqlite3-migrations` 绑死 D38 已移除的原生依赖。量级佐证：当前迁移面是一张表加四个索引，而 SQLite 不支持 `ALTER COLUMN`，将来改约束本身就得手写"建表→搬→改名"。留口：若日后需要 `.sql` 文件形态便于 review，只把数组元素换成"读命名 SQL 并在同事务内 exec"，runner 的版本语义不动 —— 在第一次真实迁移发生前不做 | 已定稿 | 5.3.2、design.md §4 |
| D41 | **`node:sqlite` 必须经计算说明符引入**：esbuild（tsup）对内置模块一律剥 `node:` 前缀，`node:sqlite` 会被改写成 `sqlite`；fs/path/os 无害（存在同名遗留内置），但 Node 只在 `node:sqlite` 下暴露 SQLite，产物运行即 `ERR_MODULE_NOT_FOUND`，且**只在打包后暴露、typecheck 与单测全测不到**。解法见 `src/db/sqlite.ts` 的 `'node:' + 'sqlite'` 计算说明符 | 已定稿 | src/db/sqlite.ts |
| D42 | **Windows 目录实测纠正**：`paths.data = %LOCALAPPDATA%\workreport\Data`、`paths.config = %APPDATA%\workreport\Config`，两者不同目录；D27 的"同目录"结论作废，第 8 节表格与推论 1 已按实测改写。备份/迁移文档必须覆盖两个目录，否则只备份 Roaming 会整个漏掉数据库 | 已定稿（部分闭合 O13 的 Windows 项） | 第 8 节、5.2.11 |
| D43 | **`doctor` 对不存在的目录不得报 `PATH_NOT_WRITABLE`**：首版对 `dirname(db_path)` 直接 `W_OK`，而目录在首次写入前本就不存在 —— 全新安装的第一次体检即误报不可写。改为向上取最近已存在祖先判定 | 已定稿 | 5.2.13 |
| D44 | **项目整体更名 `worklog` → `workreport`**（用户 2026-09-24 定，取代 D37）。覆盖六类落点：npm 包名 `@phinnpeng/workreport`、全局命令名与 `bin` 字段、环境变量 `WORKREPORT_HOME`（原 `WORKLOG_HOME`）、`env-paths` 应用标识 `workreport`（连带第 8 节三平台目录与默认库名 `workreport.db`）、内部符号 `WorkReportError`／`WORKREPORT_ERROR_CODES`／`WORKREPORT_SCHEMA_VERSION_APPLIED`、本文全部表述。取舍：0.1.0 未发布、无外部用户，故数据目录与库文件名一并改且**不读旧路径、不留兼容映射** —— 只改一半会让名为 `workreport` 的命令往 `worklog` 目录写数据。附带收益：命令名不再与 D36 那两个占用包争同一全局 bin。第三方的包名实测证据（`worklog`、`worklog-cli`、`worklogx` 等）在 10.2 按原样保留，不随更名改写；新名字的占用情况已同日复测（10.2） | 已定稿 | 第 1 节、8、10.2 |
| D45 | **实测推翻 5.1.3 的"8 字符前缀在千级数据下几乎必然唯一"**：ULID 前 10 位编码 48 位毫秒时间戳，前 8 位只承载高 36 位，低 12 位落在第 9–10 位 —— 同一约 4 秒窗口内录入的条目必然共享前 8 字符。M1 实现期两次相邻 `add` 即撞出 `AMBIGUOUS_ID`，`table` 里两行 ID 完全相同；而密集录入正是本工具的主形态，"千级数据才可能撞"的前提不成立。处置（已落地）：`AMBIGUOUS_ID` 的 `matches` 改为**完整 26 位 id**，因为短前缀本身就是歧义源，列短前缀等于把歧义原样还回去、`hint: 补长前缀` 无从执行；前缀解析用 `upper(substr(id,1,length(?))) = ?` 绑定参数，大小写不敏感且不开出 LIKE 元字符面。未拍板：`limits.id_prefix_display` 是否加长（挂 O15，改值属 minor） | 已定稿（O15 现由 D46 闭合） | 5.1.3、10.1、5.2.7 |
| D46 | **契约值与四处口径收口**（用户 2026-09-29 拍"加长"）：① `limits.id_prefix_display` **8 → 12**（闭合 D45 留下的 O15），`table` 的 ID 列随之加长；② `describe` 的 flag 补 `name`／`type` —— 5.2.14 的示例里字段名即契约，缺 `name` 会让 AC-7"describe 的 flag 名与 `--help` 一致"没有可读对象；`declaration`／`description`／`scope` 保留为实现侧，只增字段属 minor；③ 落地 5.3.0 第 4 条：相对 `--db` 按 cwd 解析时在 stderr 提示真实落点（`--quiet` 抑制）。此前 `looksUnexpanded` 定义后从未接线，即该条一直未实现；提示文本两段都设上界（原始入参 80／路径 120），因为既有的 5.2.1 隐私用例正拿 500 字符的 `--db` 探测回显；④ 5.2.0 着色口径见本节上方补充 —— `--no-color` 此前是空头声明（全仓无任何着色实现）；⑤ 业务枚举非法值（`--status nope` 等）不再交给 commander `choices`，改由命令层报 `VALIDATION_ERROR`／退出 1，否则会被升级成 `USAGE_ERROR`／2，误导 Agent 去改调用方式而不是改参数（`--format` 这类调用方式参数仍走 choices） | 已定稿 | 5.1.3、5.2.0、5.2.14、5.3.0、5.6、5.7.3 |
| D47 | **三处 PRD 偏差按推荐方案收口**（用户 2026-09-29 拍"按推荐处理"）：① `config.default_format` 接进生效链 —— 新增 `src/cli/format.ts` 单点裁决 `--format` > 配置 > `json`，非法值 `CONFIG_INVALID`／3 不回落（D31），`doctor` 回显 `format`／`format_source`。此前该键只存在于 `FileConfig` 类型里、无人消费，而同类的 `data_dir`／`default_category`／`default_status` 已生效，属"能力只实现一半"。② `--keyword` 与 `search --keyword` 的 flag 描述写明大小写语义（ASCII 不区分、非 ASCII 区分），落实 5.3.1 第 3 条"须在 `--help` 中写明" —— Agent 只读 `describe` 就知道 `api` 命中 `API`。③ **M0 S7 三平台 CI 落地**：`.github/workflows/ci.yml`（ubuntu-24.04 / macos-14 / windows-latest × Node 24，跑完整 `npm run verify`）+ `npm run ci:paths`（`doctor` 打印 `env-paths` 实际落点、与第 8 节逐条断言、结果写进 job summary；不符按约定改文档不改断言）+ `npm run ci:global`（`npm pack` → 隔离 prefix 全局装 → 断言安装输出无 `node-gyp`／`prebuild` 痕迹、bin 入口存在、空目录跑 `describe` 零污染）。并把"低版本建库 → 高版本 CLI 打开"从库层函数升到**真实产物**用例：v1 旧库（无索引）经 `dist/index.js list` 读到旧数据并补到当前版本。④ 测试执行改 `fileParallelism: false`：AC-3 的"零 DB_LOCKED"测的是多进程写安全性而非本机调度能力，实测五个套件同时派生进程会把 `busy_timeout=5000` 抢穿（单跑必绿、全量偶挂） | 已定稿（O13 由 D48 闭合） | 5.4、5.2.13、5.3.1、5.3.2、第 8 节、第 9 节 |
| D48 | **三平台 CI 首绿并闭合 O13；同时暴露 Windows 慢盘下的锁预算问题（O16）**。① `npm run ci:paths` 在 ubuntu-24.04 / macos-14 / windows-latest 上各跑一次 `doctor`，实测落点与第 8 节逐条相符 —— macOS `config = ~/Library/Preferences/workreport` 的存疑项落定，Linux 侧确认 `XDG_CONFIG_HOME` 只替换基目录、`env-paths` 之后仍追加应用名。② `npm run ci:global` 证实三平台 `npm install -g` 均无 `node-gyp`/`prebuild` 痕迹（D38 的收益成立）。③ 排查通道：作业日志端点对公开仓也要管理员权限（实测 403）、匿名 REST 仅 60 次/小时，故 CI 每个 job 把结论写成 `ci-diagnosis/<os>.md` 提交到独立分支，从 `raw.githubusercontent.com`／`git fetch` 直读，成功失败都写。④ 这条通道当场揪出四处只在非 Windows 才出的错：CI 脚本把三平台期望值写成对象字面量导致 Linux 先抛 `ERR_INVALID_ARG_TYPE`；全局 bin 在 POSIX 是 `<prefix>/bin` 而非从 `npm root -g` 反推的 `<prefix>/lib/bin`；测试的 XDG/APPDATA 沙箱不全（会写到 runner 真实主目录）；macOS `tmpdir()` 是符号链接须先 `realpathSync`。⑤ **未收口**：AC-3 在 Windows runner 上出现 1 次 `SQLITE_BUSY`（`busy_timeout=5000` 用尽），本地 Windows 与 Linux/macOS 均零 `DB_LOCKED` —— 按 AC-8 的纪律不降负载、不改断言换绿，登记为 O16 待拍 | 已定稿（①②③④；⑤ 由 D49 闭合） | 第 6 节、第 8 节、9、10.1 |
| D49 | **O16 的正解不是等待预算，而是锁被持有多久：`synchronous` 改 NORMAL**（用户 2026-09-29 接受"掉电窗口换吞吐"）。① 本地真并发复现了 runner 上的失败：4 进程 × 250 个 IMMEDIATE 事务在 `synchronous=FULL` 下总耗时 139.75s、1000 笔中 5 笔 `SQLITE_BUSY`（p999 5527ms，正好撞满 5 秒预算）—— 说明这不是 Windows 慢盘特例，而是排队必然。② 两个原候选被实测证否：`busy_timeout` 放宽到 15000 → 148.94s、p999 9135ms（不省时间，只是让人等更久）；CLI 侧退避重试 3 次 → 143.2s 且仍漏 16 笔失败；另测"只调 `wal_autocheckpoint=10000` 不动 synchronous" → 50.99s、失败反而增到 12 笔。③ 换 `synchronous=NORMAL` → 2.85s／0 失败；再配 `wal_autocheckpoint=10000` → **1.27s／0 失败、p999 258ms**；AC-3 用例本身从 1.2–5.7s 降到 829ms。**三平台 CI 复跑全绿**（run 36542928932：ubuntu-24.04 / macos-14 / windows-latest 各 77/77，AC-3 分别 401ms／474ms／957ms，原先报错的 Windows 从 20.4s／1 笔失败转为绿）。④ 代价按 SQLite `pragma` 文档写进第 6 节：应用崩溃不丢已提交事务，**掉电 / OS 崩溃可能回滚最近若干笔尚未 checkpoint 的提交**，库不损坏。⑤ 单命令只快约 12%（327ms→286ms，瓶颈在进程冷启动与写路径建立），因此另开 O17 追踪"第 6 节 < 200ms 预算未达成"，不静默改指标。⑥ 附录 B 那条"零 `SQLITE_BUSY`"旧结论已标注为不稳定（当时未记 `synchronous` 档位与编排方式）。脚本与数据在 `spikes/o16-lock-contention/`；其中 `bench.mjs` 首版把四个 worker 用 `execFileSync` 串行跑，测的是单价而非争抢，已改为并发后重测 | 已定稿 | 第 6 节、10.1、附录 B |
| D50 | **GitHub 仓库名定为 `PhinnPeng/WorkLog`，与包名/命令名解耦**（用户 2026-09-29："远程仓库已改名为 WorkLog，采用 WorkLog 即可"）。核过的证据：旧名 `PhinnPeng/WorkReport` 的 API 返回 **301 → `repositories/1385154844`**，规范名 `PhinnPeng/WorkLog`，**repo id 不变**（是改名而非新建，远端 `main` 仍指向改名前的最后一次提交）。落地：`git remote set-url origin git@github.com:PhinnPeng/WorkLog.git`，`fetch`/`push` 双向已验（`HEAD == origin/main`，push 报 `Everything up-to-date`）。**范围边界要写清**：仓库名只是托管位置，npm 包名 `@phinnpeng/workreport`、命令名 `workreport`、环境变量 `WORKREPORT_HOME`、`env-paths` 应用标识 `workreport`（第 8 节的三平台目录）**全部不变** —— 它们是与外部调用方约定的契约（5.7.1 semver 治理），而 D36/10.2 记录的裸名 `worklog` 抢占风险正是靠命令名不叫 `worklog` 才消解的。若将来要把产品名也改回 WorkLog，那是一次**新的破坏性更名**，需重走 10.2 的占用实测 | 已定稿 | 第 1 节、10.2、D44 |
| D51 | **提交历史压缩为单条根提交**（用户 2026-09-29："抹掉，并清理远端历史，保持为当前状态的首次提交"）。起因是仓库最初 5 条提交的正文带 `Co-Authored-By: Claude <noreply@anthropic.com>` 尾注 —— 那是当时所用命令行工具的默认署名行为，author/committer 一直是 `phinnpeng`，从未被改写，GitHub 只是把尾注解析成共同作者显示出来。做法：先给改写前的 HEAD 打本地标记（保留回滚路径，不推远端），再以 orphan 分支把当前工作树提交成唯一根提交，`push --force` 覆盖远端 `main`，并删除 `ci-diagnosis` 分支（CI 下次运行自行重建）。**代价与边界，如实记下**：① 原先 47 条提交的逐条可追溯性没有了，里程碑复原只能靠本章 D 记录、`spikes/` 与 README 状态表；② 此前文档引用的 commit SHA 全部失效，故 D50 已改成不含 SHA 的表述（CI run 编号与 repo id 不受影响）；③ GitHub 侧 Actions 的历史 run 记录、以及内部 GC 完成前的悬挂对象，不是一次分支强推能清除的范围 —— 远端分支历史被替换是确定的，但"全网无痕"这种话不该写 | 已定稿 | 第 1 节、11 章 |

### 11.2 输出契约

| # | 决策 | 状态 | 落点 |
| :--- | :--- | :--- | :--- |
| D2 | **流分离为硬约束**：`stdout` 只放数据体，警告／提示／错误全进 `stderr`；UTF-8 无 BOM，末尾一个换行 | 已定稿 | 5.2.1 |
| D3 | **错误对象恒为 stderr 单行 JSON，不随 `--format` 变化**；调用方只对 `code` 分支，`error` 文案不入契约；错误内 `content` 超 80 字符须截断 | 已定稿 | 5.2.1、5.7 |
| D4 | **错误码与退出码是稳定 API**，受 semver 治理：新增码 = minor，删除／改名／改退出码归属 = major | 已定稿 | 5.7.1 |
| D5 | **退出码按"谁能修"分档**：`0` 成功／`1` 业务校验（Agent 改参数）／`2` 用法错（Agent 改调用方式）／`3` 环境错（须交人类） | 已定稿 | 5.7.2 |
| D7 | **JSON 默认单行紧凑**，`--pretty` 才缩进（200 条约省 24KB token） | 已定稿 | 5.2.0、5.2.1 |
| D8 | **空结果是 `exit 0` 不是错误**，禁止用错误码表达"无结果" | 已定稿 | 5.2.1、5.7.2 |
| D17 | **集合命令返回信封** `{items,limit,offset,truncated}`；`truncated` 由 **limit+1 探测**得出，**不算 `total`、不提供 `--count`** | 已定稿 | 5.2.1、5.2.3 |
| D18 | **分页必须全序**：`date DESC, time DESC NULLS LAST, created_at ASC, id ASC`。无二级排序键则 offset 翻页会重复与漏项 | 已定稿 | 5.2.3 |
| D19 | `--all` 表示不限，**不提供 `--limit 0`**（0 可读作"零条"也可读作"不限"，歧义） | 已定稿 | 5.2.3 |
| D20 | `--format`／`--pretty`／`--quiet`／`--db`／`--no-color` 提为**全局层**，不再散落于各命令示例 | 已定稿 | 5.2.0 |

### 11.3 命令语义

| # | 决策 | 状态 | 落点 |
| :--- | :--- | :--- | :--- |
| D6 | **`describe --format json` 导出命令面契约**，与命令定义同源生成；只读、不开库、DB 损坏时仍可用。SKILL.md 不得手抄参数与码表 | 已定稿 | 5.2.14、5.5.1 |
| D9 | **`add` 非幂等**：写操作结果未知时先 `list` 校验再决定是否重试；`exit 3` 禁止自动重试 | 已定稿 | 5.5.1 |
| D10 | **并发须显式 WAL + `busy_timeout`**，原"SQLite 事务保证多进程写入安全"不成立 | 已定稿 | 第 6 节 |
| D11 | 空 `--keyword` 报 `VALIDATION_ERROR`，不退化为全表返回 | 已定稿 | 5.3.1 |
| D21 | **跨字段冲突一律报错，不静默纠正**（`CONFLICT_*`）。理由：LLM 看不到被改写的值，会按原意复述给用户，产生无信号的错数据。唯一例外是 `convert` | 已定稿 | 5.2.2、5.7.3 |
| D22 | **类型迁移收敛为单一路径**：`update` 拒绝 `--item-type`（`USAGE_ERROR`），`convert` 改双向 `--to log\|plan`。联动状态机只留一份实现 | 已定稿 | 5.2.4、5.2.5 |
| D23 | **删除改为软删除** + `restore` / `purge` / `--dry-run`；`delete` 返回被删条目全文。物理删除在手动备份的工具里等同不可恢复丢失 | 已定稿 | 5.2.6 |
| D24 | 新增 `show`（改前先读）、`categories`（分类归一化）、`doctor`（结构化自检）三个命令；`categories` 优先级高于 `report` | 已定稿 | 5.2.7、5.2.12、5.2.13 |
| D25 | **`--id` 支持 ULID 唯一前缀**（多条命中报 `AMBIGUOUS_ID`），`table` 显示 8 字符短前缀 | 已定稿 | 5.1.3 |
| D26 | **路径展开由 CLI 承担，不依赖 shell**（Agent 走 `execFile` 不经 shell，`~` 会原样传入并污染当前目录） | 已定稿 | 5.3.0 |
| D27 | 目录规范统一：备份默认 `<data_dir>/backups/`；配置目录由 `env-paths` 给出；Windows 下数据与配置同目录（原稿三处互相矛盾） | 已定稿 | 5.3、第 8 节 |
| D28 | `report` 修正四处：`--planned-for` 取代 `--include-plan` 的硬编码 +1 天（周五会给出周六）、NULL 分类归 `未分类` 而非丢弃、组内排序写死、`--output` 时 stdout 只放摘要对象 | 已定稿 | 5.2.9 |
| D29 | `backup`／`report --output` **默认拒绝覆盖**（`PATH_EXISTS` + `--force`）。原稿"默认覆盖"会让同日多次备份互相冲掉 | 已定稿 | 5.2.11、5.2.9 |
| D30 | `config set data_dir` 必须回显新旧库条目数并警告未迁移；临时换库走 `--db`，真迁移走 `export`/`import` | 已定稿 | 5.2.10 |
| D31 | 配置解析顺序写死 `--db > WORKREPORT_HOME > config.data_dir > env-paths 默认`；非法 JSON **不静默回落**默认值（回落会把配置写错表现成"数据消失"） | 已定稿 | 5.4 |
| D32 | **新增 M0 地基阶段**；`search` 提前到 M1（写命令的端到端验证依赖它）；CI 提前到 M0。总工期 4 周 → 约 5 周 | 已定稿 | 第 9 节 |
| D33 | **不做计划完成率统计**（用户 2026-09-24 明确）。`list --overdue` 保留，服务"今天补做哪些遗留计划"，与完成率无关 | 已定稿（关闭 O11） | 5.2.3、5.2.5 |
| D34 | **删除 `--count` 与 `total`**：第 2.1 节无任一目标需要匹配总数，`truncated` 已足够；将来要加是 minor，无反悔成本 | 已定稿（关闭 O12） | 5.2.1、5.2.3 |
| D35 | **日报格式的唯一真源是 5.2.9**，Agent 手工整理须遵循同一套分组/排序规则，SKILL.md 只引用不复述；两者不一致时以 `report` 为准 | 已定稿 | 5.2.9、5.5 |
| D36 | 名称实测：`worklog` 与 `worklog-cli` **均已被占用**，且两者都注册全局 bin `worklog` → 原稿兜底失效，且 bin 名本身是竞争资源 | 已记录为事实 | 第 1 节、10.2 |
| D37 | ~~包名采用 `@phinnpeng/worklog`，命令名保持 `worklog`，仓库 `phinnpeng/worklog`~~ **已被 D44 更名取代**；其中"走 scoped 路线"一条仍沿用 | 已作废（关闭 O14 现由 D44 承接） | 第 1 节、10.2、D44 |

> 版本 **v0.6**。本文内已无未决项：原 O13 与三项发布前置（npm scope 自证、全局 bin 争抢说明、spike 脚本入 CI）已全部转为 Trellis 任务承载 —— 见 `.trellis/tasks/09-24-m0-foundation/`（R8/AC-8、R10）与 `.trellis/tasks/09-24-publish-preflight/`。后续事项的登记处是 `.trellis/tasks/`，不再回写本文档。

---

**附录 A：SKILL.md 骨架（示意，非规范）**

> 本附录**刻意不含具体参数**。D6 已定稿：SKILL.md 不得手抄参数、枚举与错误码，一律运行时取自 `workreport describe`（5.2.14）。若本附录与 `describe` 输出冲突，**以 `describe` 为准**。
> 之所以保留这份骨架，是因为"什么时候该调哪个命令、哪一步不能省"属于编排知识，`describe` 描述不了。

```markdown
# WorkReport Skill

## 前置：取契约
首次调用或任一调用失败时，先 `workreport describe --format json`，
按其中的 commands / constraints / error_codes 组织后续调用。

## 记录工作项（"记录 / 补录 / 先记下来"）
1. 相对日期 → 绝对日期（用用户本地日历，不是 UTC）。
2. `workreport categories` → 把口语分类映射到已有规范名，映射不上才新建。
3. 内容含引号 / 换行 / 接近上限 → 走 stdin。
4. 调用 `add`。冲突报错时改参数，不要指望 CLI 自动纠正。

## 记录计划（"明天要做 / 计划"）
1. 解析计划日期（必给，无默认）。
2. 调用 `add`（plan 形态）。

## 查询计划
`list`，按计划日期过滤；读 `.items`，并检查 `.truncated`。

## 计划转工作项（"把某计划转为工作项"）
1. `list` 或 `search` 定位 → 拿 `id`。**禁止凭记忆或凭上次输出拼 ID。**
2. `convert`（类型迁移的唯一入口，`update` 不接受改类型）。

## 删除（"删掉那条"）
1. `show` 取回完整条目。
2. 向用户复述内容并取得确认。
3. `delete`（软删除）。返回体即撤销依据。

## 生成日报
1. 确认日期。
2. `list` 取当日日志；如要计划区，自行算出目标日期再调 `report`
   —— CLI 不替你判断"下一个工作日"。
3. 未分类条目单列成组，不要丢掉。

## 搜索
`search`；中文按**整串子串**匹配，不是分词。搜不到不等于没有，
可换更短的子串重试。

## 失败处理
按 stderr 的 `code` 分支；退出码 3 停下交人类，不要重试，不要改数据。
```

**附录 B：本次评审的实测依据**

| 结论 | 验证方式 | 环境 |
| :--- | :--- | :--- |
| FTS5 `unicode61` 对中文子串恒 0 命中 | 建表插入 `完成用户登录接口联调与登录模块单元测试`，`MATCH '登录'` / `'接口联调'` / 整句均返回 0 | SQLite 3.53.1 |
| FTS5 `trigram` 对 2 字中文 0 命中 | 同上，`MATCH '登录'` → 0，`MATCH '支付回调超时'` → 1 | SQLite 3.53.1 |
| `LIKE` 性能足以替代 FTS5 | 20000 行中文语料：`LIKE '%登录%'` 3334 行 6.06ms；`trigram` 1.55ms | Node v24.18.0 |
| `node:sqlite` 无 `backup()` | 枚举 `DatabaseSync` 原型方法：`open, close, prepare, exec, function, createTagStore, location, aggregate, createSession, applyChangeset, enableLoadExtension, enableDefensive, loadExtension, serialize, deserialize, setAuthorizer` | Node v24.18.0 |
| `node:sqlite` 含 FTS5 且 SQLite 版本 | `CREATE VIRTUAL TABLE ... fts5` 成功；`sqlite_version()` = 3.53.1 | Node v24.18.0 |

**O9 驱动 spike（2026-09-24 追加，同一环境）**

| 结论 | 验证方式 | 数字 |
| :--- | :--- | :--- |
| WAL 真的生效 | `PRAGMA journal_mode` 回读 | `wal` |
| `busy_timeout` 真的生效（不是设了不管） | 一进程持 `BEGIN IMMEDIATE`，另一进程超时后取锁 | 抛 `database is locked`，等待后失败而非立刻失败 |
| **多进程并发写不丢数据** | 4 进程 × 250 个 IMMEDIATE 事务写同一库，随后全表校验 | 1000/1000 落库、`distinct id`=1000、`lost`=0、`integrity_check`=`ok`、`SQLITE_BUSY` 0 次 —— **该"零 BUSY"结论不稳定**：同一负载在 `synchronous=FULL` 下后来实测到 5–12 笔 BUSY（见 D49 与 `spikes/o16-lock-contention/results.md`），当初未记录 `synchronous` 档位与并发编排方式。不丢数据与 `integrity_check=ok` 两点仍成立 |
| `serialize()` **不遗漏未 checkpoint 的 WAL 数据** | 插 500 行不 checkpoint，序列化后另开库计数 | 活库 500 / 快照 500、丢失 0；`-wal` 达 4,124,152 字节而序列化产物仅 81,920 字节 |
| `serialize()` 在并发改库时不撕裂 | 边跑 2 个并发写进程边连续快照，逐个 `integrity_check` | 40 次快照，完整性失败 0，行数单调不减 |
| `VACUUM INTO` 可作备份主路径 | 活库 `VACUUM INTO` 到新文件后只读打开计数 | 2100 → 2100，无错误，产物不含 `-wal`/`-shm` |
| **CHECK 失败无法程序化细分** | 三类跨字段违规 + 坏枚举分别插入 | `errcode` 恒为 **275**，仅 `e.message` 带约束文本 → 见 5.1.1 的映射结论 |
| 错误分支要用 `errcode` 而非 `code` | 取锁冲突 / 主键重复 / 坏枚举 | `err.code` 恒 `ERR_SQLITE_ERROR`；`errcode` 分别为 **5**(BUSY)、**1555**(UNIQUE)、**275**(CHECK) |
| 冷启动开销可忽略 | `node -e` 完整进程计时：require + 开库 + 一次 `LIKE` 查询 | **1.9–2.9ms**（1000 行库），远低于 200ms 预算 |
| 无实验性警告污染 stderr | 不加任何过滤直接看 `node -e "require('node:sqlite')"` 的 stderr | 无 `ExperimentalWarning` |

> **spike 的边界，别过度解读**：全部数据来自**单台 Windows 机、Node v24.18.0、单次运行**，规模仅到千级事务。它证明的是"`node:sqlite` 的 WAL 并发语义与快照能力可用、且没有 `better-sqlite3` 才能提供的 `backup()` 这一处真实缺口"，**不是**跨平台稳定性结论 —— Linux/macOS 与 22.x 的行为仍需在 M0 的 CI 三矩阵里复跑同一套脚本。驱动决策（D38）成立所依赖的是上面这组事实，不是"测过了很多遍"。

> 表中数字为本机单次测量，用于**量级判断**（LIKE 与 FTS5 差距在毫秒级、远小于 200ms 预算），不作为基准测试结论。D1 的成立不依赖耗时数字，只依赖"中文 0 命中"这一条。
