# 兼容性设计：四条轴的契约与缺口收口

## 背景

本工具的三个"外部世界"各自会先于 CLI 演进，且**都不受本 CLI 控制**：

1. **宿主运行时**（Node 版本）—— 调用方（Agent 宿主）决定用哪个 node 启动我们。
2. **数据**（SQLite 库）—— 库可能由更高版本的 CLI 建立、或含更高版本才认识的取值。
3. **配置**（`config.json`）—— 位于用户全局目录，同一份配置会被不同版本的 CLI 轮流读写。
4. **契约**（命令面 / 错误码 / 退出码）—— Agent 的行为建立在它之上，改动即破坏调用方。

这四条轴各自都已有部分机制，但**从未被作为一组"兼容性契约"写下来**，因此：
缺口的边界靠人记忆、已有机制的价值没人能一眼看出、测什么不测什么没有判据。
本任务把四条轴的策略、现状实测与缺口收口一次写清。

## 范围外

- 跨平台（Windows/macOS/Linux）兼容 —— 那是 M0 的 AC-8 与 PRD 第 8 节，已有三平台 CI 覆盖。
- 库结构与命令语义的设计 —— 见 PRD 5.1／5.2，本任务只管"版本之间如何共存"。
- 网络相关兼容（本工具运行期零网络请求）。

## 现状实测（2026-10-08，Node 22.22.0 / 24.18.0 / 20.16.0）

### 数据轴：已自洽

| 场景 | 实测结果 | 判据 |
| :--- | :--- | :--- |
| 新 CLI 读 N-1 旧库 | 自动迁移、数据完好 | 已有用例 `migrate.test.ts:70` |
| 旧 CLI 读更高 `schema_version` 的库 | `SCHEMA_TOO_NEW` + 退出 3（读/写/`doctor` 三条路径一致） | 已有用例 `migrate.test.ts:100,198` |
| 库里有本版本不认识的**额外列** | 读得到、写得进，额外列的值不被覆盖 | 实测：加 `future_col` 后 `list`/`add` 均正常，值原样保留 |
| 库里有本版本不认识的**枚举值**（如 `status=cancelled`） | 读出即透传、写其他字段不报错 | 实测：`list` 原样返回，`update --content` 成功 |
| 库存在但无 `work_items` 表 | `DB_NOT_INITIALIZED`，绝不静默建表 | 已有用例 `migrate.test.ts:111` |

**为什么已自洽**：① 迁移数组只追加不改写；② `schema_version` 是一道硬闸门，不认识的结构直接拒绝
而不是猜；③ 所有 SELECT 用**显式列清单**（`COLUMNS` 常量），不用 `SELECT *` —— 这一条是额外列
容忍的根本原因，日后加列不必回头改读取层；④ 跨字段校验只判"类型与状态/计划日的联动"，不遍历
未知枚举值，所以不认识的值不会被误改。

### 配置轴：已自洽，但缺自动化用例

| 场景 | 实测结果 |
| :--- | :--- |
| 配置里有本版本不认识的键（更高版本写入的） | `config list` 忽略它继续工作 |
| **旧 CLI 写配置时是否覆盖未知键** | **保留** —— 实测 `config set default_category` 后，`future_key_from_v2` 与嵌套对象原样留在文件里 |
| `config get <未知键>` | `USAGE_ERROR` + 列出可接受的键（明确拒绝，不假装成功） |
| 配置枚举值非法 | `CONFIG_INVALID` + 退出 3，不静默回落（D31） |

**降级安全性成立**：旧版本 CLI 改配置不会抹掉新版本写入的键，所以"用旧版跑一次"不会造成配置丢失。
这一条目前**只靠实测，没有用例钉住** —— 一旦有人把 `writeConfig` 改成"按已知键重建对象"就会破。

### 契约轴：已自洽

- `describe` 与命令定义同源生成（门禁 C 断言"声明集合 === 注册集合"），不存在手抄的第二份命令表（D6）。
- 错误码与退出码受 semver 治理（D4）：新增码 = minor，删除/改名/改归属 = major。
- 错误对象恒为 stderr 单行 JSON、不随 `--format` 变化（D3）。

### 运行时轴：**有缺口**

| 场景 | 实测结果 |
| :--- | :--- |
| Node 22.22.0 / 24.18.0 | 全门禁绿（104/104），stderr 干净 |
| **Node 20.16.0（低于 `engines` 下限）** | **抛 Node 自己的多行堆栈**，违反 5.2.1／D3 |

```
$ node dist/index.js describe
node:internal/modules/esm/translators:447
    throw new ERR_UNKNOWN_BUILTIN_MODULE(url);
Error [ERR_UNKNOWN_BUILTIN_MODULE]: No such built-in module: node:sqlite
    at ModuleLoader.builtinStrategy (...)
Node.js v20.16.0
```

根因：`src/db/sqlite.ts` 在 ESM 顶层 `await import()`，模块不存在时**整条模块图在 `runMain`
之前就断了**，`try/catch` 没有机会接住。Agent 按契约 `JSON.parse(stderr)` 会崩在堆栈的第一行。

严重性：**中**。只影响低于 `engines` 下限的环境（本项目声明 `>=22.22.0 <23 || >=23.4.0`），
但"低于下限"恰恰是最可能发生的误用 —— 用户机器上就装着旧版 Node，而报错方式让人无法
从错误本身看出"是 Node 版本不对"。

## 状态（2026-10-08）：已落地

用户在 2026-10-08 拍"全量按推荐"，CD-1 取 (a)、CD-2 取"新增码"。实现已提交
（`a4b4909`），PRD 记为 **D53**。验收结果：

| AC | 结果 |
| :--- | :--- |
| AC-1 单行 JSON + `RUNTIME_UNSUPPORTED` + 退出 3 + 无堆栈 | ✅ `test/compat.test.ts`（真 Node 20.16.0）+ CI `runtime-refusal` job |
| AC-2 错误对象带 `node` 与 `requires` | ✅ |
| AC-3 4 条兼容性用例全绿；双版本 `npm run verify` 全绿 | ✅ 实际新增 6 条；22.22.0 与 24.18.0 各 **112/112** |
| AC-4 PRD 5.7.3／第 6 节／D53 与实现一致；门禁 A 仍绿 | ✅ 门禁 A 另加两条"例外窄到可验证"的断言 |

**实现与设计的偏差（记录在案）**：① 门禁 A 原为"只有 `cli/output.ts` 能碰流"，入口自举必须写
stderr；处理方式不是整文件放行，而是**加例外并额外断言用量上限**（只许一处 stderr 写入、
只许出现 `RUNTIME_UNSUPPORTED` 一个码）。② 设计里说"单加一个 Node 20 job"，落地时该 job
只跑 `build` + 断言（不跑 `npm ci`/`verify`）——低版本上 devDependencies 未必装得上。
③ 顺带发现并记录：同时并行跑两个 `npm run verify` 会把 `busy_timeout` 抢穿，让并发用例报
假失败（实测复现并写进 `test/concurrency.test.ts` 的注释，判据是"先确认没有并行 verify"）。

## 关键决策（已拍板）

### CD-1 运行时下限外的行为：契约化拒绝，而不是尽力降级（推荐）

两个候选：

- **(a) 契约化拒绝（推荐）**：入口探测到 `node:sqlite` 不可用 → 输出单行 JSON
  `{"error":"…","code":"RUNTIME_UNSUPPORTED",…}` + 退出 3，不打堆栈。
- (b) 尽力降级：把 `node:sqlite` 改成惰性加载，让不吃库的命令（`describe`、`config list/get/set`）
  在低版本 Node 上仍然可用。

**推荐 (a)**，理由：
1. PRD 5.7.2 对退出码 3 的定义就是"环境错，**停止并交回人类**"，"尽力"与这一定义相悖。
2. (b) 的收益面很窄：低版本 Node 上唯一能活的只有 `describe` 与 `config`，而 `describe` 的
   用途是"给 Agent 取命令面" —— Agent 连一条命令都执行不了时，取到命令面也没有意义。
3. (b) 要把 `export const DatabaseSync` 改成惰性单例函数，牵动 4 个 import 点（`backup`/
   `doctor`/`config`/`common`），**为一条边角路径引入常态复杂度**。
4. (a) 与既有的 `SCHEMA_TOO_NEW`／`CONFIG_INVALID` 同一形态：不认识就拒绝，不猜、不半途。

**若日后真要 (b)**：触发条件是"有真实用户报告在旧 Node 上只想用 `describe`"。届时把
`db/sqlite.ts` 改成 `loadSqlite()` 惰性单例即可，本决策不堵死这条路。

### CD-2 新错误码 `RUNTIME_UNSUPPORTED`（推荐）

`:warning: 这会改动 PRD 5.7.3 的稳定契约表`，需按 D4 判定为 **minor**（新增码）。

- code：`RUNTIME_UNSUPPORTED`
- 退出码：**3**（环境错，交回人类各修各的）
- 触发：`node:sqlite` 不可用（模块缺失，或需 `--experimental-sqlite` 而未被允许）
- 错误对象附 `node`（当前版本）与 `requires`（`engines` 范围）两个字段，
  让调用方不必读文档就知道该升到哪

候选替代：复用 `INTERNAL_ERROR`（拒绝 —— 它不携带"该怎么办"的信息，而这是环境错的全部价值）；
复用 `DB_NOT_INITIALIZED`（拒绝 —— 语义是"库不对"，而这里库根本还没被打开）。

## 建议的落地顺序（本任务范围内，待 CD-1/CD-2 拍板后做）

| # | 改动 | 落点 |
| :--- | :--- | :--- |
| 1 | 入口自举：`src/index.ts` 改为"先探测、再动态 import CLI"，探测失败输出契约错误 | `src/index.ts` |
| 2 | 新错误码进码表单点定义与 PRD 5.7.3 | `src/cli/errors.ts`、`docs/PRD.md` |
| 3 | `db/sqlite.ts` 的加载失败改抛携带型号信息的错误，供入口组装 | `src/db/sqlite.ts` |
| 4 | 兼容性测试矩阵（见下） | `test/compat.test.ts`（新增） |
| 5 | PRD 第 6 节补"运行时下限外的行为"一段；决策记 D53 | `docs/PRD.md` |

技术可行性已实测：把入口从**静态 import** 改成**动态 import + try/catch** 后，
顶层 `await import()` 的失败会被入口捕获并转成契约错误（实测输出单行 JSON + 退出 3）；
静态 import 则直接抛多行堆栈。`src/cli/errors.ts` 无任何 import，可被入口安全引用而不引入循环。

## 兼容性测试矩阵（本任务要新增的用例）

四条轴各一个方向，**经 `execFile` 跑真实产物**（与既有测试同一纪律）：

| 轴 | 用例 | 现状 |
| :--- | :--- | :--- |
| 运行时 | 模拟 `node:sqlite` 不可用 → 单行 JSON + `RUNTIME_UNSUPPORTED` + 退出 3，stderr 无堆栈 | ❌ 待加 |
| 数据 | 库里含额外列 → 读写正常，额外列值不被覆盖 | ❌ 待加 |
| 数据 | 库里含未知枚举值 → 读出即透传、改其他字段不报错 | ❌ 待加 |
| 配置 | 旧 CLI 写配置后未知键保留（降级安全） | ❌ 待加 |
| 数据 | N-1 旧库升级、`SCHEMA_TOO_NEW` 拒绝 | ✅ 已有 |

运行时那条**必须用真的低版本 Node 测**，不能只靠模拟：`node:sqlite` 是内置模块，
"摘模块缓存／指向不存在的说明符"这类做法改不了"模块图在 main 之前就断"这一事实，
测到的是另一条路径。两处都能拿到低版本：

- **本地**：本机 nvm 已有 `v20.16.0`（`D:\WorkSoftware\nvm\v20.16.0\node.exe`），已实测复现。
- **CI**：矩阵之外**单加一个 Node 20 job**（只跑 ubuntu，且**不跑**完整 `npm run verify` ——
  低版本上 devDependencies 未必装得上），只做两件事：`npm run build`，然后断言
  `dist/index.js describe` 的输出是单行 JSON、`code=RUNTIME_UNSUPPORTED`、退出 3、
  stderr 不含堆栈行。这条 job 的语义是"**验证拒绝方式合规**"，不是"验证能跑"，
  命名必须写清，否则日后会被人误读成"支持 Node 20"。

另加一条**单元用例**覆盖探测本身：把探测逻辑抽成可传说明符的函数，
传入不存在的说明符断言它抛携带型号信息的错误（这条跑在主矩阵里）。

## 验收标准

- **AC-1** 低于 `engines` 下限时：stderr 为单行 JSON、`code=RUNTIME_UNSUPPORTED`、退出 3，
  且**不含** `at ModuleLoader` 之类的堆栈行；`stdout` 为空。
- **AC-2** 上述错误对象带 `node` 与 `requires` 字段。
- **AC-3** 新增的 4 条兼容性用例全绿；Node 22.22.0 与 24.18.0 下 `npm run verify` 均全绿。
- **AC-4** PRD 5.7.3 码表、第 6 节、D53 与本实现一致；门禁 A（错误码单点定义）仍绿。
