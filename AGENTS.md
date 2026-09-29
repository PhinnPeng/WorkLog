<!-- TRELLIS:START -->
# Trellis Instructions

These instructions are for AI assistants working in this project.

This project is managed by Trellis. The working knowledge you need lives under `.trellis/`:

- `.trellis/workflow.md` — development phases, when to create tasks, skill routing
- `.trellis/spec/` — package- and layer-scoped coding guidelines (read before writing code in a given layer)
- `.trellis/workspace/` — per-developer journals and session traces
- `.trellis/tasks/` — active and archived tasks (PRDs, research, jsonl context)

If a Trellis command is available on your platform (e.g. `/trellis:finish-work`, `/trellis:continue`), prefer it over manual steps. Not every platform exposes every command.

If you're using Codex or another agent-capable tool, additional project-scoped helpers may live in:
- `.agents/skills/` — reusable Trellis skills
- `.codex/agents/` — optional custom subagents

Managed by Trellis. Edits outside this block are preserved; edits inside may be overwritten by a future `trellis update`.

<!-- TRELLIS:END -->

# 工作规范

## 回执：每轮完成任务都要交

每轮回复的正文之后按下面两段收尾（采用 Markdown 形式，若存在show-me技能，则使用该技能进行回复），只有「简要」必填，其余一段确有内容时才出现（整段省略，不留空标题）：

1. **简要** —— 一行结论：这轮做完了什么。改动落点（`文件:行`）、门禁命令与实测数字随正文给出，不另起一节复述。
2. **待决策**（可选）—— 需用户拍板才能继续的事，每条自带推荐项、理由与被拒替代。

判据：待决策的每一条都能被一句话拍成「做/不做」；未完成的后续事项不写进回执，一律登记到 `.trellis/tasks/` 下（任务目录或 `task.json` 的 `notes`），回执只报结论与待拍板。
