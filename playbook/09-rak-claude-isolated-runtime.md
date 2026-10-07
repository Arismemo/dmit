# RAK Claude 隔离运行环境交接

部署日期：2026-10-04。该方案替代 Step 8 的全局 shell 代理与“零泄漏防封”表述。

日常入口见 [当前交接](../HANDOFF.md)，源码安装位置与离线测试见 [运行环境源码说明](../configs/server/claude-runtime/README.md)。住宅上游切换步骤见 [Step 8](08-rak-claude-residential-proxy.md)。

## 已部署架构

普通 Marzban/Xray 继续使用 RAK 机房出口，TCP 3389 经既有 NAT 规则进入 443。`rak-bulk-port.service` 幂等恢复该条规则。SSH、Tailscale及普通 Xray 不进入 Claude 的网络命名空间。

Claude 与浏览器使用 `claude` 用户，主目录 `/home/claude`，工作目录 `/home/claude/workspace`。名为 `claude` 的网络命名空间只有 lo，没有 veth、外部网卡或默认路由。运行进程没有主机 capabilities，开启 NoNewPrivileges。浏览器恢复 sandbox，使用仅允许该浏览器创建用户命名空间的独立 AppArmor 配置。

出站路径：

```text
Claude / 浏览器 / 工具子进程（claude 网络命名空间）
  → 127.0.0.1:7890 HTTP 或 7891 SOCKS5
  → /run/claude-egress/{http,socks}.sock
  → 主机上的 systemd-socket-proxyd（独立 claude-relay 用户）
  → 原 claude-bridge 的回环监听
  → 住宅 SOCKS5 上游
```

应用若忽略或删除代理变量，外部连接失败。工具仍可以在命名空间内使用动态回环端口，例如 OAuth 回调和本地开发服务。命名空间内的 localhost 与主机 localhost 相互独立，因此不能访问主机 62050/62051 管理端口。

桌面由 `claude-desktop.service` 管理 Xvfb、剪贴板同步、x11vnc、noVNC 与 Chrome。X11 使用认证 cookie；Chrome DevTools 9222 仅在隔离环境内监听。主机只通过 systemd socket 在 127.0.0.1:6080/5900 转发至隔离桌面。

## 日常使用

仍可通过现有 SSH 登录并执行：

```bash
claude
claude auth login
claude-shell
```

`claude` 先进入隔离网络、切换专用用户，再验证出口并启动原生 CLI。当前目录若不允许该用户进入（例如 `/root`），自动使用 `/home/claude/workspace`。工程文件应放在专用用户可读写的位置。`claude-shell` 提供同一隔离环境中的 shell，适合 Git、npm 和工具操作。SSH Git 由 `~/.ssh/config` 的 `ProxyCommand nc -X 5 -x 127.0.0.1:7891` 经住宅 SOCKS5 连接，使用 claude 用户独立密钥（不复用 root 密钥）。

桌面访问方式不变：

```bash
ssh -p 28827 -L 6080:127.0.0.1:6080 root@137.175.65.78
# 本机浏览器打开 http://localhost:6080/vnc.html
chrome-open 'https://claude.ai'
vnc-clip '需要复制的文本'
```

`chrome-open` 和 `vnc-clip` 自动进入隔离环境，前者不会把完整授权 URL 回显到日志。旧 `/root/claude-signup/launch.sh` 现在调用 systemd，不再广泛 pkill 其他进程。

root 的全局代理变量已移除，新 SSH 会话默认使用普通主机出口。部署前已经打开的 shell 可能保留旧环境，重新连接即可。住宅代理变量仅在 Claude 环境里设置。

## 配置与服务

- `/etc/claude-runtime.json`：非秘密运行配置，集中保存预期出口 IP/组织、代理地址及用户路径。守卫和健康探针共用。
- `/etc/claude-bridge/config.json`：现有上游协议与凭据；仅管理员维护，凭据不进入仓库或报告。
- `/usr/local/bin/claude`：首选启动入口，避免 npm 更新 `/usr/bin/claude` 时直接移除首选守卫；兼容入口 `/usr/bin/claude` 也已更新。
- `/usr/local/sbin/claude-exec`：进入命名空间并降权的管理员启动器。
- `claude-netns.service`、`claude-proxy-relay.service`、`claude-http-egress.socket`、`claude-socks-egress.socket`：隔离网络与代理连接。
- `claude-desktop.service`、`claude-novnc.socket`、`claude-vnc.socket`：桌面与 SSH 回环入口。
- `claude-backup.timer`、`proxy-health-check.timer`：保留原有每日备份及 15 分钟检查。
- `rak-bulk-port.service`：启动时幂等保证 TCP3389→443，既有普通代理进程不需要重启。

代理和桌面服务均有端口就绪检查，systemd 启动成功返回后相应监听已建立。源码副本位于 `configs/server/claude-runtime/`；它是当前部署的源文件集合，不是可直接覆盖所有配置的无人值守重装器。所有可执行脚本安装权限为 0755，配置/units 0644；凭据目录使用更严格权限。

更换供应商时，分别修改网桥的接入地址/凭据和集中配置中的实际预期出口。供应商接入 IP 不一定等于最终出口 IP。更新后验证网桥、守卫及探针，不能仅修改 Xray 后假设完成。

## 2026-10-07 维护记录

- 出口校验改用 `https://claude.ai/cdn-cgi/trace`（Anthropic 边缘实际看到的 IP/国家），不再依赖会对家宽 IP 限流的 ipinfo。守卫要求 IP=`expected_ip` 且 `loc=expected_country`；健康探针另按 ipinfo → ipwho.is 取 ISP，全部限流时只告知、不判失败，IP 不符仍判失败。
- 起因：ipinfo 对该住宅 IP 返回 429 后，旧守卫拒绝启动；10-06 22:26–22:37 的 1000 余次 ipinfo 请求来自反复启动/重试，而该 IP 背后所有用户共享 ipinfo 免费额度。
- 原 `/usr/bin/claude-bin` 在用户执行 `claude update`（root npm 全局安装 2.1.292）时被 npm 覆盖删除，守卫失去目标。现已卸载 npm 全局包，改为 `claude` 用户原生安装，`/usr/bin/claude` 与 `/usr/local/bin/claude` 都是守卫包装。root 下 `claude update` 也会经守卫在隔离环境内执行。
- Claude/桌面/Chrome 语言统一为 `en_US.UTF-8`、`--lang=en-US`；`claude` 用户 fontconfig 屏蔽文泉驿 CJK 字体，减少中文环境特征。
- 健康探针每 5 分钟运行。确认出口 IP/国家不符时，立即结束 `claude` 用户的原生 CLI 进程并停止 `claude-desktop`（`enforced: true`）；探针网络错误只报告不处置。ISP 查询按相同 IP 缓存 1 小时，避免触发限流。恢复后需手动 `systemctl start claude-desktop`。
- `claude-host-block.service` 用 nft 表 `inet claude_host_block` 拒绝 user.slice 内进程（root SSH shell、VS Code Remote 服务端、npx 等）直连 Anthropic 地址段，快速失败而不是以机房 IP 访问。system.slice（Xray、Marzban、claude-bridge）与隔离命名空间不受影响。该规则不覆盖经 Cloudflare 的其他域名，也不防 root 主动绕过；`systemctl stop claude-host-block` 可撤销。
- 修改前副本：`/var/backups/claude-hardening/20261007T025324Z`。

## 备份和恢复

```bash
claude-session-backup
claude-session-restore --check-only
claude-session-restore --destination /var/tmp/claude-restore-check
proxy-health-check
```

每日备份保存 `.claude` 与 `.claude.json`，排除 `.claude/debug` 诊断缓存。归档位于 `/var/backups/claude-session`，目录 0700、文件 0600；保留最近 10 个真实归档，latest 原子更新。其他链接或特殊文件会明确报错，而不是跟随到目录外。

恢复默认拒绝覆盖正在运行的 Claude，会先备份现有配置，并在替换失败时回滚。`--destination` 用于新的空目录，不触碰线上会话。恢复前备份要求当前配置可以归档；在全新空机上先用独立目标目录提取验证，再按专用用户权限部署。两条配置路径的替换不是跨文件断电事务，不能承诺突然断电时同时提交。

健康探针只报告观测到的服务/出口状态，失败不自动重启网桥。状态文件为 `/var/run/claude-proxy-status` 与同名 `.json`。隔离由网络结构实施，探针不会声称自己完成了封锁。

## 本机客户端同步修复

AI 组仅保留明确允许的 DMIT/AWS 具体节点，移除对通用 Proxy 组的引用，并排除动态 provider、include-all 和级联节点带来的旁路。持久客户端脚本与已生成配置都已更新并热加载。

实测 AI 仍选择 DMIT-LA，模式仍为 rule；Bulk、Proxy、GitLab、SSH、Grok 的成员和当前选择保持原样。原路径 `AI → Proxy → RAK-Bulk-1T` 已从本机运行配置移除。DMIT 服务端远程模板尚未发布；本机持久脚本会在订阅更新时继续筛选 AI。

这仍不表示本机 Claude 和 RAK Claude 使用同一个出口：前者当前走 DMIT，后者走住宅代理。

## 已完成的验收

| 检查 | 结果 |
|---|---|
| 隔离环境 HTTP 与 socks5h 出口 | 均为 48.46.113.162 |
| 实际浏览器页面查询出口 | 48.46.113.162 |
| Claude 启动守卫与原生 CLI | 2026-10-07 升级为 2.1.292 原生安装，`claude -p` 真实模型请求成功 |
| 代理下 Anthropic 根路径 | HTTP/2 404，仅作为网络可达性检查 |
| 删除代理变量后直接连接 IPv4/IPv6 | 拒绝/无路由 |
| 子进程直连 TCP、UDP DNS、主机 API | 拒绝/无路由 |
| 临时阻断住宅上游 | 代理请求失败、守卫拒绝、探针失败；普通机房出口正常 |
| 上游恢复 | 守卫与探针恢复；探针没有重启网桥 |
| 主机桌面监听 | 仅回环 5900/6080；DevTools 留在隔离环境 |
| SSH 转发 noVNC | HTTP 200 |
| 浏览器 sandbox | 非 root，renderer Seccomp=2、NoNewPrivs=1、有效 capabilities 为 0 |
| 备份与独立目录恢复 | 归档验证、权限检查、恢复内容哈希一致 |
| 脚本失败分支 | 14 项 ops 测试通过，包括坏包、路径穿越、锁、失败回滚及探针异常 |
| 网络环境重建 | 删除并重建 Claude 命名空间后服务恢复；开机依赖已 enabled |
| TCP3389 重复恢复 | 只保留一条重定向规则 |
| 普通大流量服务 | 普通 Xray PID 50723 未变，管理隧道连接仍在 |
| 本机 Clash 热加载 | HTTP204，进程 PID 未变，AI 筛选生效且其他分组保持 |

用户选择暂时不登录，真实模型请求与 OAuth Token 恢复未验收。整机没有重启；验证了 Claude 环境重建与启动依赖，不能将其描述为完整服务器重启验收。基础设施正常不代表账号资格或账号状态已验证，也不能保证不封号。

## 留存与恢复边界

变更前配置和旧 root 会话数据位于 `/var/backups/claude-hardening/20261004T043008Z`，父目录 0700。现有 runtime 的日常备份与这份迁移回滚副本独立。

维护时先使用日常备份保存最新会话，再处理 Claude 相关服务。不要把旧的全部网卡桌面监听和 root/no-sandbox 当作安全的默认恢复目标。不能修改全机默认 DROP、停止普通 Xray、移除其正常公网出站或全局禁用 UDP 来修复 Claude。

住宅供应商仍提供原有 SOCKS5 协议，本机无法单方面为供应商不支持的链路增加端到端加密。SSH 登录策略、管理面证书和主机全局软件升级需结合其他业务单独维护；本次没有将这些列为已完成的全机加固。
