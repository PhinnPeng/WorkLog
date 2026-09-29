# M0 执行计划

> 顺序即依赖。每步给出验证命令；标 🔴 的是门禁，未过不得进下一步。
> R10（`.gitattributes` 归一化）已在本任务正式开工前完成（`i/lf` 120/121、`git add` 警告 0），故不列入步骤。

## S1 仓库与工具链骨架

- `package.json`：`@phinnpeng/worklog`、`bin: {"worklog": "./dist/index.js"}`、`engines.node: ">=24.0.0"`、依赖仅 `commander`/`ulid`/`env-paths`
- TypeScript strict、`tsup` 构建、`vitest` 配置、ESLint
- 🔴 **门禁 A**：lint 规则禁止 `src/**` 出现 `console.log`、`process.stdout`、`process.stderr`，**`cli/output.ts` 除外**；禁止 `errors.ts` 之外出现错误码字符串字面量。没有这条，D2/D3 的契约在多命令后必然破。
- 验证：`npm run build && npm test && npm run lint` 全绿

## S2 `db/conn.ts` + `db/schema.ts`

- 打开连接即施加 `journal_mode=WAL`、`busy_timeout=5000`
- DDL 常量按 PRD 5.1.4 逐字实现（含三条跨字段 `CHECK`、`schema_version` 表）
- 注意实测坑：`PRAGMA busy_timeout` 的返回列名是 `timeout` 而非 `busy_timeout`
- 验证：`sqlite3` 读 `.schema` 比对；插入违规行被 DB 拒绝 → **AC-1**

## S3 `db/migrate.ts`

- 只追加数组、单事务、失败回滚、`SCHEMA_TOO_NEW`、`DB_NOT_INITIALIZED`
- 测试必须包含：N-1 库→N 成功；中途注入异常→版本号与数据都不变；N+1 库→拒绝；有文件无表→不建表 → **AC-2**
- 🔴 **门禁 B**：这四条迁移用例未全绿前，不碰任何命令层。地基错了后面全要返工。

## S4 `cli/errors.ts` + `cli/output.ts`

- Code 枚举、errcode→Code→退出码单表、`emit/warn/fail` 三出口
- 验证：`fail` 在 `--format table` 下仍输出单行 JSON；`emit` 默认紧凑；空结果 `exit 0` → **AC-4、AC-5**
- 断言测试里**不得**出现比对 `error.message` 文本的用例（D39）

## S5 `cli/paths.ts`

- `~`、`$VAR`、`%VAR%`、相对路径；`doctor`/`config get` 回显绝对路径
- 验证：用 `execFile`（不经 shell）传 `--output ~/x.db`，断言落在 `os.homedir()` 下，且**当前目录条目数前后一致** → **AC-6**
- 这条测试是本项目的存在意义之一（"零运行目录污染"），不要用 `shell:true` 糊过去

## S6 `cli/spec.ts` + `describe` + `doctor`

- 元数据结构见 design.md §2；commander 注册与 `describe` 序列化都从它生成
- `describe` 不开库；测试：把库文件追加垃圾字节后 `describe` 仍返回 0 → **AC-7**
- 🔴 **门禁 C**：加一条测试断言 `describe` 输出的 flag 集合 === commander 实际注册的 flag 集合。**这个断言是 D6「同源」唯一的可执行证明**；写不出来说明还是两份定义。

## S7 CI 三平台

- matrix：ubuntu / macos / windows × Node 24
- 必须含 S2–S6 全部测试 + "低版本建库→高版本打开"
- 各平台打印 `env-paths` 的 data/config 实际路径并输出到 job summary，与 PRD 第 8 节表比对；**不符则改 PRD 第 8 节并同步 D27，不许改断言迁就文档** → **AC-8 / 闭合 O13**
- 验证 `npm install -g` 无 node-gyp 调用记录 → AC-8 后半

## S8 收尾

- `npm link` 后跑一次 `worklog describe` / `worklog doctor` 冒烟
- 把 S1–S7 中发现的、值得复用的约束写进 `.trellis/spec/`（目前那里的模板与本项目无关，`00-bootstrap-guidelines` 尚未完成 —— M0 至少应落地"输出契约/错误映射/路径展开"三条本项目特有约束）

## 回滚点

S1–S6 都只新增文件、不改既有行为，出问题直接 revert 对应提交即可。S7 引入 CI 后若三平台不一致，**保留失败状态并回报**，不要用 `continue-on-error` 或跳过用例来换绿灯 —— 那正是 O13/D38 想暴露的差异。

## S8 打包与安装冒烟（2026-09-24 已执行）

`npm pack` → 装进隔离目录（临时 prefix，非全局）→ 从**另一个空工作目录**跑真实 bin。实测：

| 断言 | 结果 |
| :--- | :--- |
| tarball 内容 | 仅 `dist/index.js` + `package.json`，2 文件 / 5.7 kB（`files: ["dist"]` 生效，未泄漏 src/tests/.trellis） |
| `worklog --version` | `0.1.0`，exit 0 |
| `worklog describe` | exit 0；**stderr 0 字节**；stdout **恰好 1 行**且可 `JSON.parse` |
| 契约自描述 | 18 个错误码；exit 分档 0/1/2/3 齐；`limits` 三项 |
| `worklog add`（未实现） | `{"error":"...unknown command 'add'","code":"USAGE_ERROR"}` exit 2 |
| `worklog doctor --bogus` | 同上 exit 2（未知 flag 也归 USAGE_ERROR） |
| 零运行目录污染 | 空目录跑 `describe`+`doctor` 后仅剩下我自己重定向出的 out.json/err.txt；**未生成 `~` 目录、未生成 worklog.db** |
| D43 修复在产物中生效 | `doctor` 的 `problems` 只有 `DB_NOT_INITIALIZED`，**没有**误报 `PATH_NOT_WRITABLE` |

副产物一条：依赖 `ulid` 自带 CLI，安装后 `node_modules/.bin` 里多出 `ulid`/`ulid.cmd`/`ulid.ps1`。非我方缺陷，但发布文档若列"会装出哪些命令"需知道这点。
另已补 `.gitignore` 的 `*.tgz`（`npm pack` 会把 tarball 落在仓库根，先前会被误提交）。

## 验证命令汇总

```bash
npm run build && npm test && npm run lint     # S1 门禁 A
npx vitest run db/migrate                     # AC-2 门禁 B
npx vitest run cli/paths                      # AC-6
npx vitest run cli/spec                       # AC-7 门禁 C
git ls-files --eol | grep -v 'i/lf'           # R10 复查（应仅剩 .trellis/.version）
```
