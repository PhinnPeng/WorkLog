# CI 结论 · Windows / Node 22

- job: `failure`
- commit: `d40cc9b5d2aa2e7c26ed826dfd3618dd68bde734`
- run: 37742492588

## 测试汇总
        [31m     [31m×[31m 4 进程 × 250 个 IMMEDIATE 事务：零 DB_LOCKED、零丢失[39m[32m 71[2mms[22m[39m
        [41m[1m FAIL [22m[49m test/concurrency.test.ts[2m [ test/concurrency.test.ts ][22m
        [31m⎯⎯⎯⎯⎯⎯⎯[39m[1m[41m Failed Tests 1 [49m[22m[31m⎯⎯⎯⎯⎯⎯⎯[39m
        [41m[1m FAIL [22m[49m test/concurrency.test.ts[2m > [22mAC-3 多进程并发写（第 6 节、D10）[2m > [22m4 进程 × 250 个 IMMEDIATE 事务：零 DB_LOCKED、零丢失
        [2m Test Files [22m [1m[31m1 failed[39m[22m[2m | [22m[1m[32m7 passed[39m[22m[90m (8)[39m
        [2m      Tests [22m [1m[31m1 failed[39m[22m[2m | [22m[1m[32m111 passed[39m[22m[90m (112)[39m
        ::error file=D%3A/a/WorkLog/WorkLog/test/concurrency.test.ts,title=test/concurrency.test.ts > AC-3 多进程并发写（第 6 节、D10） > 4 进程 × 250 个 IMMEDIATE 事务：零 DB_LOCKED、零丢失,line=67,column=30::Error: worke

## env-paths 实测
        MEASURED win32 data=~/AppData/Local/workreport/Data cfg=~/AppData/Roaming/workreport/Config
        data_dir（实际）: C:\Users\runneradmin\AppData\Local\workreport\Data
        config_path（实际）: C:\Users\runneradmin\AppData\Roaming\workreport\Config\config.json
        期望 data_dir: C:\Users\runneradmin\AppData\Local\workreport\Data
        期望 config_dir: C:\Users\runneradmin\AppData\Roaming\workreport\Config
        OK data_dir = C:\Users\runneradmin\AppData\Local\workreport\Data
        OK config_dir = C:\Users\runneradmin\AppData\Roaming\workreport\Config

## 全局安装冒烟
        OK 安装输出中无 node-gyp / prebuild 痕迹
        OK 全局命令入口: C:\Users\RUNNER~1\AppData\Local\Temp\wl-gi-qZjJo2\prefix\workreport.cmd
        OK describe：1 行、可 parse、命令数 14
        OK 零运行目录污染
