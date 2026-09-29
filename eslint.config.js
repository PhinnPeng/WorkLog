// ESLint flat config.
//
// 这里的 no-restricted-syntax 规则**是 M0 门禁 A 的快速反馈层**，不是唯一防线。
// 权威防线在 test/gate-a.test.ts（用源码文本扫描，能抓住 AST 选择器漏掉的
// 解构与计算属性写法，并且 `npm test` 单独跑也生效）。两层都要过。
//
// 门禁 A 的两条硬约束（design.md §1 / PRD 5.2.1、5.7.1）：
//   1. src/** 只有 cli/output.ts 能碰 stdout/stderr（console 一律禁）。
//      调用方是 AI Agent，混进 stdout 的任意字节都会让它 JSON.parse 失败。
//   2. src/** 只有 cli/errors.ts 能出现错误码字符串字面量。
//      20 个命令各写一次是靠不住的，码表必须单点定义。
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * 错误码清单**从 src/cli/errors.ts 现读现解**，不在这里维护第二份。
 *
 * 起初这里是一份手抄清单，于是新增 INTERNAL_ERROR 后规则静默失效 ——
 * 恰好是它该防的那类漂移。抽取逻辑与 test/gates.test.ts 共用同一模块。
 */
import { WORKREPORT_ERROR_CODES } from './scripts/extract-codes.mjs';

const CODE_LITERAL_SELECTOR_PATTERNS = [
  // 'DB_LOCKED' / "DB_LOCKED"
  `Literal[value=/^(?:${WORKREPORT_ERROR_CODES.join('|')})$/u]`,
  // `DB_LOCKED` —— 模板字符串的字面片段同样算硬编码
  'TemplateElement[value.raw=/^\\s*(?:' + WORKREPORT_ERROR_CODES.join('|') + ')\\s*$/u]',
];

const STREAM_ONLY_BANS = [
  {
    selector: 'MemberExpression[object.name="process"][property.name="stdout"]',
    reason: 'stdout 只能由 src/cli/output.ts 写（PRD 5.2.1 流分离硬约束）。',
  },
  {
    selector: 'MemberExpression[object.name="process"][property.name="stderr"]',
    reason: 'stderr 只能由 src/cli/output.ts 写（PRD 5.2.1 流分离硬约束）。',
  },
  {
    selector: 'MemberExpression[object.name="process"][property.name="stdout"][property.computed=true]',
    reason: '禁止绕过 output.ts 访问 stdout。',
  },
  {
    selector: 'MemberExpression[object.name="process"][property.name="stderr"][property.computed=true]',
    reason: '禁止绕过 output.ts 访问 stderr。',
  },
];

const CODE_BANS = CODE_LITERAL_SELECTOR_PATTERNS.map((selector) => ({
  selector,
  reason: '错误码字面量只能出现在 src/cli/errors.ts（PRD 5.7.1 单点定义）。',
}));

const toRules = (list) =>
  list.map(({ selector, reason }) => ({
    selector,
    message: `${reason} 见 .trellis/tasks/09-24-m0-foundation/design.md §1。`,
  }));

const PROCESS_MODULE_BANS = {
  paths: ['node:process', 'process'].map((name) => ({
    name,
    message: '进程流只能经 src/cli/output.ts。',
  })),
};

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'dist-test/**',
      '.tmp-demo/**',
      'coverage/**',
      'node_modules/**',
      'spikes/**',
      '.trellis/**',
      '.qoder/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    rules: {
      'no-console': 'error',
      'no-restricted-syntax': ['error', ...toRules([...STREAM_ONLY_BANS, ...CODE_BANS])],
      'no-restricted-imports': ['error', PROCESS_MODULE_BANS],
    },
  },
  {
    // 例外 1：输出层本身可以碰流，但**仍然不许**硬编码错误码。
    files: ['src/cli/output.ts'],
    rules: {
      'no-restricted-syntax': ['error', ...toRules(CODE_BANS)],
      'no-restricted-imports': 'off',
    },
  },
  {
    // 例外 2：码表定义处本身可以出现码字面量，但**仍然不许**碰流。
    // 少了这一块，"单点定义"文件反而无法定义，是 S1 配置初版的缺陷。
    files: ['src/cli/errors.ts'],
    rules: {
      'no-restricted-syntax': ['error', ...toRules(STREAM_ONLY_BANS)],
    },
  },
  {
    // 测试代码要捕获流、要断言错误码字面量，天然需要触碰这些。
    files: ['test/**/*.ts'],
    rules: {
      'no-console': 'off',
      'no-restricted-syntax': 'off',
      'no-restricted-imports': 'off',
    },
  },
  {
    // 构建脚本与 demo 不是 src，不受门禁 A 约束；但它们跑在 Node 里，
    // 需要显式声明全局 —— TS 侧由 types-eslint 关掉 no-undef，.mjs 没这待遇。
    files: ['*.config.ts', '*.config.js', 'scripts/**/*.mjs'],
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly', fetch: 'readonly', Buffer: 'readonly' },
    },
    rules: {
      'no-console': 'off',
      'no-restricted-imports': 'off',
    },
  },
);
