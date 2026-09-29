#!/usr/bin/env node
/**
 * 把本次 job 的结论发布到 `ci-diagnosis` 分支上的一个文件里。
 *
 * 为什么要这条通道：作业日志端点即便对公开仓也要求仓库管理员权限（实测 403），
 * 匿名 REST 又只有 60 次/小时（已实测打爆）。写进仓库后，同一内容可以从
 * `raw.githubusercontent.com` 直接读 —— 不占 API 配额，也不需要什么权限。
 *
 * 这里**不粉饰结论**：成功也写、失败也写，失败时带上定位信息（vitest 的
 * 汇总行、env-paths 的 MEASURED 行、全局安装的关键行）。
 */
import { existsSync, readFileSync } from 'node:fs';

const token = process.env.GITHUB_TOKEN;
const api = process.env.GITHUB_API_URL || 'https://api.github.com';
const repo = process.env.GITHUB_REPOSITORY;
const sha = process.env.GITHUB_SHA;
const runId = process.env.GITHUB_RUN_ID;
const os = process.env.RUNNER_OS ?? 'unknown';
const status = process.env.JOB_STATUS ?? 'unknown';

if (!token || !repo) {
  console.log('缺少 GITHUB_TOKEN / GITHUB_REPOSITORY，跳过发布');
  process.exit(0);
}

const HEADERS = {
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'Content-Type': 'application/json',
  'User-Agent': 'workreport-ci',
};

function tail(file, pattern, count = 8) {
  if (!existsSync(file)) return ['    （文件不存在 ⇒ 该步骤未执行或被跳过）'];
  const lines = readFileSync(file, 'utf8').split('\n').map((l) => l.trimEnd()).filter(Boolean);
  if (lines.length === 0) return ['    （日志为空）'];
  const hits = pattern ? lines.filter((l) => pattern.test(l)) : [];
  // 过滤器没捞到东西时倒原始尾巴：上一轮 mac/linux 的 env-paths 段是空的，
  // 只看筛选行就无法区分"步骤没跑"与"跑了但输出不含关键词"。
  const picked = hits.length > 0 ? hits.slice(-count) : lines.slice(-12);
  return picked.map((l) => `    ${l}`.slice(0, 200));
}

const body = [
  `# CI 结论 · ${os}`,
  '',
  `- job: \`${status}\``,
  `- commit: \`${sha}\``,
  `- run: ${runId}`,
  '',
  '## 测试汇总',
  ...tail('.test.log', /Test Files|Tests |FAIL|AssertionError|✗|×/).map((l) => `    ${l}`.slice(0, 200)),
  '',
  '## env-paths 实测',
  ...tail('.paths.log', /MEASURED|不符|OK |data_dir|config/).map((l) => `    ${l}`.slice(0, 200)),
  '',
  '## 全局安装冒烟',
  ...tail('.global.log', /OK|失败|痕迹|缺失|污染|Error/).map((l) => `    ${l}`.slice(0, 200)),
  '',
].join('\n');

const path = `ci-diagnosis/${os.toLowerCase()}.md`;
const ref = 'ci-diagnosis';
const base = `${api}/repos/${repo}/contents/${path}?ref=${ref}`;

const existing = await fetch(base, { headers: HEADERS });
const current = existing.ok ? await existing.json() : null;

async function put() {
  return fetch(base, {
    method: 'PUT',
    headers: HEADERS,
    body: JSON.stringify({
      message: `ci(${os}): ${status} @ ${String(sha).slice(0, 7)}`,
      content: Buffer.from(body, 'utf8').toString('base64'),
      branch: ref,
      ...(current?.sha ? { sha: current.sha } : {}),
    }),
  });
}

let res = await put();
if (!res.ok) {
  // 分支还不存在时 Contents API 会拒；先从当前提交拉出 ci-diagnosis 分支再试一次。
  const created = await fetch(`${api}/repos/${repo}/git/refs`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ ref: `refs/heads/${ref}`, sha }),
  });
  if (!created.ok && created.status !== 422) {
    console.log('分支创建失败', created.status, (await created.text()).slice(0, 200));
  }
  res = await put();
}
console.log(`${res.status} → ${ref}/${path}（job ${status}）`);
if (!res.ok) console.log((await res.text()).slice(0, 300));
