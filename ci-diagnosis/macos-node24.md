# CI 结论 · macOS / Node 24

- job: `success`
- commit: `d40cc9b5d2aa2e7c26ed826dfd3618dd68bde734`
- run: 37742492588

## 测试汇总
             [33m[2m✓[22m[39m 4 进程 × 250 个 IMMEDIATE 事务：零 DB_LOCKED、零丢失 [33m 394[2mms[22m[39m
        [2m Test Files [22m [1m[32m8 passed[39m[22m[90m (8)[39m
        [2m      Tests [22m [1m[32m112 passed[39m[22m[90m (112)[39m

## env-paths 实测
        MEASURED darwin data=~/Library/Application Support/workreport cfg=~/Library/Preferences/workreport
        data_dir（实际）: /Users/runner/Library/Application Support/workreport
        config_path（实际）: /Users/runner/Library/Preferences/workreport/config.json
        期望 data_dir: /Users/runner/Library/Application Support/workreport
        期望 config_dir: /Users/runner/Library/Preferences/workreport
        OK data_dir = /Users/runner/Library/Application Support/workreport
        OK config_dir = /Users/runner/Library/Preferences/workreport

## 全局安装冒烟
        OK 安装输出中无 node-gyp / prebuild 痕迹
        OK 全局命令入口: /var/folders/s6/5hzmn6lx4dz5nxs7k_0slzph0000gn/T/wl-gi-Mpsk2C/prefix/bin/workreport
        OK describe：1 行、可 parse、命令数 14
        OK 零运行目录污染
