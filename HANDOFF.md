# 工程交接：RAK 多业务节点与 Claude 隔离运行环境

更新日期：2026-10-04。当前基础设施已部署并通过验收。用户选择暂时不登录，真实模型请求与 OAuth Token 恢复留待登录后验证；没有执行整机重启。

## 1. 从这里开始

- [当前架构、命令、测试记录与恢复边界](playbook/09-rak-claude-isolated-runtime.md)：维护 RAK Claude 的主要依据。
- [住宅代理网桥](playbook/08-rak-claude-residential-proxy.md)：维护上游接入、集中出口配置和健康探针。
- [多节点集群](playbook/07-multi-node-cluster.md)：DMIT、RAK、AWS 的职责与管理隧道背景。
- [运行环境源码及安装位置](configs/server/claude-runtime/README.md)：已部署脚本、systemd 单元与离线测试。

旧方案中的 root 全局代理、全部网卡桌面监听、root 浏览器及 `--no-sandbox` 已替换。当前隔离由网络命名空间实现，不能把出口 IP、时区或 HTTP 404 当作账号不会被封的保证。

## 2. 业务边界

| 对象 | 当前职责与路径 |
|---|---|
| DMIT | 主控与本机日常/AI 出口；本机 AI 分组验收时选择 DMIT-LA |
| RAK 普通 Xray | 大流量公网出口；客户端 TCP3389 经 NAT 转入 TCP443，保留机房直接出站 |
| RAK Claude 与浏览器 | `claude` 用户、独立 `claude` 网络命名空间，仅经住宅代理访问公网 |
| AWS | 本机 Grok 与备用节点；本次保持其分组策略 |
| 管理链路 | 现有 SSH28827、SSH 本地转发、Marzban62050/62051 与 Tailscale |

RAK 是共享业务节点。不要为 Claude 修改全机默认 DROP、限制整个 root 用户出站、移除普通 Xray 的正常出站或全局禁用 UDP。

## 3. 使用与数据位置

仍通过原 SSH 登录：

```bash
ssh -p 28827 root@137.175.65.78
claude
# 首次授权时使用
claude auth login
# 需要在同一隔离环境运行工具时使用
claude-shell
```

首选入口是 `/usr/local/bin/claude`，兼容入口 `/usr/bin/claude` 也已更新。启动器进入网络命名空间、切换为 `claude` 用户、校验出口，再运行原生 CLI。当前目录不能由该用户进入时，自动切换到 `/home/claude/workspace`。

| 数据 | 当前路径 |
|---|---|
| 用户主目录/默认工作目录 | `/home/claude` / `/home/claude/workspace` |
| CLI 配置及未来登录凭据 | `/home/claude/.claude`、`/home/claude/.claude.json` |
| 浏览器资料 | `/home/claude/browser-profile` |
| 非秘密运行配置 | `/etc/claude-runtime.json` |
| 上游网桥配置 | `/etc/claude-bridge/config.json`，凭据仅在受限服务器文件中维护 |
| 日常会话归档 | `/var/backups/claude-session`，目录0700、归档0600，保留10份 |
| 迁移回滚副本 | `/var/backups/claude-hardening/20261004T043008Z`，包含旧配置及旧root会话 |

桌面依赖 SSH 隧道访问：

```bash
# 在本机执行，保持 SSH 连接
ssh -p 28827 -L 6080:127.0.0.1:6080 root@137.175.65.78
# 本机浏览器访问 http://localhost:6080/vnc.html
```

在 RAK 终端使用 `chrome-open '<URL>'`、`vnc-clip '<文本>'`。工具会自动进入隔离环境。主机5900/6080只监听回环；DevTools9222仅在隔离环境内监听。

## 4. 日常检查

以下命令在 RAK 管理 SSH 会话执行：

```bash
systemctl is-active claude-netns claude-proxy-relay claude-desktop claude-bridge
proxy-health-check
/usr/local/sbin/claude-exec curl -fsS --max-time 15 https://ipinfo.io/ip
claude-session-backup
claude-session-restore --check-only
systemctl list-timers claude-backup.timer proxy-health-check.timer
```

健康探针读取集中配置、检查桥及出口并写状态，失败不重启桥。住宅出口检查应在隔离环境或显式代理下执行；普通 root shell 的 curl 现在使用机房出口，这是预期行为。部署前已打开的 shell 可能保留旧代理变量，重新连接后生效。

更换上游时同时维护网桥的接入地址/凭据与 `/etc/claude-runtime.json` 的预期出口。接入地址和实际出口地址可能不同。具体步骤见 [Step 8](playbook/08-rak-claude-residential-proxy.md)。

## 5. 已验证与待验证

已验证：HTTP/SOCKS/浏览器住宅出口；删除代理变量后的IPv4/IPv6/UDP直连阻断；子进程无法访问主机管理端口；上游故障时拒绝运行及故障恢复；浏览器sandbox；SSH/noVNC；备份归档、独立目录恢复和内容比对；冷启动就绪及网络环境重建；3389重定向幂等恢复。普通Xray未重启，管理连接仍在。

本机AI组已移除通向普通Proxy组的间接路径，并完成热加载。验收时AI已成功挂载纽约家宽（Comcast 48.46.113.162），其他分组选择保持。DMIT远程订阅模板与本机持久扩展脚本已全部发布，并放行受信任家宽节点进入AI策略组。

已完成 cleanip.io/claude 端到端全维度检测验证：环境评分从 53 分（机房IP+出口漂移）提升至 90 分（低风险安全绿灯）；出口网络确认为 Comcast Cable 住宅宽带，WebRTC 与 Claude 核心端点出口完全统一（真实 IP 未暴露）。

待验证：登录后的真实模型请求、真实OAuth凭据恢复、整机重启后的端到端恢复。住宅供应商仍使用原有SOCKS5协议，供应商加密接入与主机整体升级不是本次已完成的项目。
