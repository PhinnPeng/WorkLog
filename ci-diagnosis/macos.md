# CI 结论 · macOS

- job: `success`
- commit: `f812142e4ed5c28549d6c1634672b256f79a8454`
- run: 36546798070

## 测试汇总
        [2m Test Files [22m [1m[32m6 passed[39m[22m[90m (6)[39m
        [2m      Tests [22m [1m[32m77 passed[39m[22m[90m (77)[39m

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
        OK 全局命令入口: /var/folders/s6/5hzmn6lx4dz5nxs7k_0slzph0000gn/T/wl-gi-9E0tNk/prefix/bin/workreport
        OK describe：1 行、可 parse、命令数 7
        OK 零运行目录污染
