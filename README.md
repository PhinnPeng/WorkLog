# WorkReport

本地优先、面向 AI Agent 驱动的命令行工作记录工具。不集成 LLM，只做"哑存储 + 检索"层：
工作项（`log` 已完成的事／`plan` 计划要做的事）落在用户全局目录的 SQLite 里，
日报由外部 Agent 读出来整理。

契约的单一真源是 [`docs/PRD.md`](docs/PRD.md)，命令参数不要照抄本文，运行时取：

```bash
workreport describe --format json
```

## 实现状态

| 阶段 | 内容 | 状态 |
| :--- | :--- | :--- |
| M0 | schema 与迁移、WAL/busy_timeout、流分离契约、错误码与退出码、路径展开、`describe`/`doctor` | ✅ 完成（三道门禁全绿） |
| M1 | `add` / `list` / `show` / `search` / `categories` | ✅ 完成 |
| M0 S7 | 三平台 CI matrix（`env-paths` 实测对齐 PRD 第 8 节） | ✅ 三平台全绿（run 36542928932：ubuntu / macOS / Windows 各 77/77 + 目录断言 + 无编译工具链） |
| M2+ | `update` / `convert` / `delete`+`restore`+`purge` / `config` / `backup` / `report` | ❌ 未开始 |

未实现的命令会以 `USAGE_ERROR`（退出码 2）拒绝，而不是半途行为。

## 跑起来

要求 Node ≥ 24（使用内置 `node:sqlite`，无编译工具链依赖）。

```bash
npm ci
npm run build
npm run demo      # 建一个演示库，十步走完录入→冲突→检索→自检→表格
```

演示库落在 `.tmp-demo/demo.db`，可继续把玩：

```bash
node dist/index.js --db .tmp-demo/demo.db list --format table
node dist/index.js --db .tmp-demo/demo.db categories
```

## 用法速览

```bash
# 记一条已完成的事
workreport add --content "完成登录接口联调" --category "A项目" --status done

# 含引号／换行的内容走 stdin，别挤进命令行
workreport add --content - --category "A项目" < note.txt

# 记一条计划（必须给出归属日）
workreport add --content "评审导出方案" --item-type plan --planned-for 2026-10-15

# 录入前先做分类归一化，别让"A项目/A 项目/项目A"各自成组
workreport categories
workreport list --date 2026-09-29 --format json
workreport search --keyword "支付回调"
workreport show --id 01M3NMR7K2QW4
workreport doctor
```

全局选项：`--format json|table|markdown`、`--pretty`、`--quiet`、`--db <path>`、`--no-color`。

## 契约要点

- **流分离**：`stdout` 只有数据体；警告与错误一律 `stderr`。错误恒为单行 JSON，且不随 `--format` 变化。
- **退出码按"谁能修"分档**：`0` 成功（含空结果）／`1` 业务校验，Agent 改参数重试／`2` 用法错，按 `describe` 纠正调用／`3` 环境错，**停止并交回人类**。
- **跨字段冲突一律报错，不静默纠正**：`log` 不能 `status=planned`、不能带 `planned_for`；`plan` 必须有 `planned_for`。
- **截断可判定**：`list`/`search` 返回 `{items, limit, offset, truncated}`；`truncated` 由 `limit+1` 探测得出，不含 `total`。
- **排序是全序**（`date DESC, time DESC NULLS LAST, created_at ASC, id ASC`），否则 `--offset` 翻页会重复和漏项。
- **检索是 `LIKE` 子串**，元字符按 `\`→`%`→`_` 转义；中文子串用 FTS5 是走不通的（实测见 PRD 5.3.1）。
- **并发与持久化档位**：WAL + `busy_timeout=5000` + `synchronous=NORMAL` + `wal_autocheckpoint=10000`，写操作走单个 `BEGIN IMMEDIATE`。实测 4 进程 × 250 个事务：`FULL` 下 139.75s／1000 笔中 5 笔 `SQLITE_BUSY`，换成 NORMAL 后 1.27s／0 笔（数据与脚本见 `spikes/o16-lock-contention/`）。
- **耐久性口径**：应用崩溃不丢已提交事务；**掉电或 OS 崩溃时，最近若干笔尚未 checkpoint 的提交可能回滚**，库本身不会损坏。这一交换换来的是并发吞吐与尾延迟，取舍记录见 PRD 第 6 节与 D49。

## 数据落在哪

`--db` > `WORKREPORT_HOME` > `config.json` 的 `data_dir` > 平台默认。默认库名 `workreport.db`：

| 平台 | 数据目录 | 配置目录 |
| :--- | :--- | :--- |
| Windows | `%LOCALAPPDATA%\workreport\Data\` ✅CI 实测 | `%APPDATA%\workreport\Config\` ✅CI 实测 |
| Linux | `~/.local/share/workreport/` ✅CI 实测 | `~/.config/workreport/` ✅CI 实测 |
| macOS | `~/Library/Application Support/workreport/` ✅CI 实测 | `~/Library/Preferences/workreport/` ✅CI 实测（原存疑项已落定） |

Linux/macOS 两行已由三平台 CI 实测确认（`npm run ci:paths` 在 ubuntu-24.04 / macos-14 / windows-latest 上各跑一次 `doctor` 并与本表逐条比对）。macOS 的 `config` 落 `Preferences` 这一项原为存疑，现已落定。
