import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm'],
  // 目标与 engines 下限对齐（22.x）：产物必须能在 Node 22 上解析。
  target: 'node22',
  platform: 'node',
  // 单一 bundle：CLI 交付物是 dist/index.js 一个文件（bin 指向它）。
  splitting: false,
  sourcemap: false,
  clean: true,
  minify: false,
  // node:sqlite 是内置模块，绝不能被打进 bundle 或当外部依赖解析掉。
  external: ['node:sqlite'],
  // 不设 banner：shebang 由 src/index.ts 自己带。这里再加一次会在 dist 里
  // 出现第二个 `#!` 行（第 2 行），Node 按模块加载时直接 SyntaxError。
});
