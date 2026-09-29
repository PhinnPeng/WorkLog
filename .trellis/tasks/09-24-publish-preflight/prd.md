# 发布前置 — 需求与验收标准

> 需求源头 `docs/PRD.md` 第 1 节与 10.2。本任务收拢**只有发布时才会暴露、但必须有人认领**的两件事，避免它们只活在评审记录里。
> 归属里程碑 M5（`docs/PRD.md:第 9 节`）。M0–M4 期间不阻塞任何开发。

## 背景

包名已定为 `@phinnpeng/worklog`（D37），但下结论时用到的实测有边界：包名 404 只证明"没人发过这个包"，**不证明 `phinnpeng` 这个 scope 归本项目所有**。另外发现一个当时没预料的事实 —— 抢占 `worklog` 这个命令名的不是包名，而是两个已存在包的 `bin` 字段。

## 范围内

| # | 事项 | 现状 |
| :--- | :--- | :--- |
| R1 | 确认 npm 账号/scope `phinnpeng` 的归属并可发布 | **未证实**。`www.npmjs.com/~phinnpeng` 与 `/org/phinnpeng` 均返回 403（反爬拦截，不构成"不存在"的证据），`registry.npmjs.org/-/user/...` 返回 401（端点本身要鉴权） |
| R2 | 确认本机可发布 | **未就绪**。`npm whoami` → `need auth`，需 `npm adduser` 与 `npm access` 设置 |
| R3 | 明确全局 bin `worklog` 与两个已占包冲突时的处理方式，并写进 README | 未开始。实测 `worklog` → `bin {"worklog":"cli.js"}`、`worklog-cli` → `bin {"worklog":"index.js"}`，两者都抢同一个命令名 |

## 范围外

- 换包名（D37 已定，除非 R1 证明 scope 不可得才重开）。
- CI 与打包脚本本身 —— 属 M0 的 R8 与后续发布流水线任务。

## 验收标准

- **AC-1（R1）** 在 npm 网站上以 `phinnpeng` 身份登录后，能列出该 scope 并可 `npm publish --dry-run` 出 `@phinnpeng/worklog`；结果回填 `docs/PRD.md:10.2`，把"两点尚未证实"改为实测结论。
- **AC-2（R3）** README 有一段明确的冲突处置说明，且是**可执行的命令**而非提示语：给出 `--force` 覆盖安装、或改用备用 bin 名（例如 `bin {"wl": ...}`）的切换方式，并说明两种做法各自的后果。
- **AC-3（R3）** 该说明同时反映到 `docs/PRD.md` 第 1 节的"已知残留风险"段，避免 README 与 PRD 各写一份。

## 约束与风险

- **不要靠命令行推断 scope 归属**：403/401 都来自反爬与鉴权要求，不是结论。此前我一度把 404 读成"scope 可用"，那是错的 —— 必须在能登录的浏览器会话里确认。
- 若 R1 失败（scope 不可得），会连锁影响 D37、PRD 第 1 节、README 安装命令与本仓库文档中的包名引用 —— 属于**改一处要扫全文**的变更，发现得越早越便宜，建议先做 AC-1。
