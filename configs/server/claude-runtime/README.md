# Claude 隔离运行环境源码

这是 2026-10-04 RAK 已部署实现的维护副本。架构、使用及现场验收见 [Step 9](../../../playbook/09-rak-claude-isolated-runtime.md)，上游接入维护见 [Step 8](../../../playbook/08-rak-claude-residential-proxy.md)。目录不包含供应商凭据、账号 Token 或浏览器资料。

## 源码与安装位置

| 文件 | RAK 安装位置/用途 |
|---|---|
| `claude` | `/usr/local/bin/claude`，兼容副本 `/usr/bin/claude` |
| `claude-shell`、`chrome-open`、`vnc-clip` | `/usr/local/bin/`，进入隔离环境的用户工具 |
| `claude-exec` | `/usr/local/sbin/claude-exec`，进入命名空间并降权 |
| `claude-guard`、`claude-netns-setup`、`claude-proxy-relay`、`claude-desktop`、`claude-wait-ports`、`rak-bulk-port-ensure` | `/usr/local/libexec/` |
| `claude-session-backup`、`claude-session-restore`、`proxy-health-check` | `/usr/local/bin/`；备份/恢复须安装在同一目录 |
| `*.service`、`*.socket` | `/etc/systemd/system/` |
| `claude-runtime.json` | `/etc/claude-runtime.json`，集中非秘密配置 |
| `claude-browser.apparmor` | `/etc/apparmor.d/claude-browser` |
| `launch.sh` | `/root/claude-signup/launch.sh`，兼容原桌面启动命令 |
| `test_ops.py` | 本地临时 fixture 测试，不安装为线上服务 |

可执行脚本安装为 root 所有、0755；配置和 units 为 root 所有、0644。运行用户为 `claude`，主机代理转发用户为独立的 `claude-relay`。浏览器程序在 `/opt/claude-browser/`，由 root 维护；用户资料在 `/home/claude/browser-profile`。现有 `/usr/bin/claude-bin`、主机 `claude-bridge.service`、备份/健康 timer 及系统依赖不包含在本目录中。

本目录不是一键重装器。安装前须核对用户、浏览器程序、AppArmor、原网桥、socket 权限、定时器和会话数据；不要直接覆盖线上凭据或重新创建正在使用的命名空间。

## 维护与验证

在仓库根目录执行无需生产凭据的回归测试：

```bash
python3 configs/server/claude-runtime/test_ops.py
node configs/client/Script.test.js
```

ops 测试使用临时目录及 dummy 数据。它覆盖归档权限/保留、debug 排除、恶意路径和链接拒绝、并发锁、恢复回滚以及探针异常；不能据此声称线上账号已登录或恢复了有效 Token。

部署修改后先验证相关 systemd 单元，再仅重启受影响的 Claude 服务。代理和桌面服务的 `ExecStartPost` 使用 `claude-wait-ports` 等待监听就绪；同步维护该依赖，避免冷启动时守卫过早运行。现有 root CLI 会话不能原地迁入新身份，迁移前必须安排会话结束和数据留存。

现场出口、断线、桌面、数据恢复及共享业务检查按 Step 9 执行。不要为了测试此目录而重启普通大流量 Xray或修改全机默认防火墙策略。测试结束清理临时故障规则和恢复副本，保留正式归档。
