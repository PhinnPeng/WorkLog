import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // 子进程并发用例（AC-3）与 execFile 冒烟用例会在真实进程里打开同一个库文件，
    // 用 forks 而不是 worker_threads，避免线程池与 Windows 下的 spawn 语义互相干扰。
    pool: 'forks',
    // 文件间也不并行：AC-3 断言"零 DB_LOCKED"，测的是多进程写安全性，
    // 不是本机调度能力。实测 5 个套件同时派生进程时 CPU 争抢会把 busy_timeout=5000
    // 打穿（同一条用例单跑必绿、全量偶挂），串行后消除这类假失败。
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
