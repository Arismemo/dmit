# DMIT 承接 BOM 中转站与 Claude Pro 账号

日期：2026-11-01。起因是 RAK（137.175.65.78）云盘反复出现 I/O 错误，容器运行时无法启动，SSH 与网站均不可用；工单 RAK #90180815 记录了故障与数据保全要求。

2026-11-03 至 11-04 补充：DMIT 重启后修复了两处开机依赖，RAK 恢复后其旧模型服务已停用，DMIT 根盘做过一次清理。这些记录在第 5 节。

## 1. 当前部署

### DMIT（179.255.119.112，Tailscale 100.120.162.88）

| 组件 | 位置 | 说明 |
|---|---|---|
| new-api | 容器，127.0.0.1:13000 | 镜像 `bom-newapi:v1.0.0-rc.45-bom-20261018t003954z`，由上游 rc.45 镜像加 RAK 自建二进制重建 |
| new-api 数据库 | `/root/services/newapi/data/one-api.db` | 来自 RAK 每日备份 `20261102T033500Z`，恢复后完整性校验通过 |
| Magpie 主网关 | 容器，127.0.0.1:13425 与 172.17.0.1:13425 | 配置来自 RAK `/root/services/magpie/config`，CLI 为 `web --addr 0.0.0.0:3430` |
| Claude 订阅网关 | `claude-rak-gateway.service` | 运行在 `claude-rak` 网络命名空间内，监听 127.0.0.1:3425 |
| 住宅代理桥 | `claude-bridge.service` | Xray 转发至住宅 SOCKS5 上游，出口 48.46.113.162（US） |
| 隔离环境出口 | `iso-claude-rak-netns` + `iso-claude-rak-relay` | 命名空间仅有回环；经私有 socket 访问主机代理桥 |
| 网关桥接 | `iso-claude-rak-gateway-sock` + `iso-claude-rak-gateway-relay` | 命名空间 Unix socket → 主机 127.0.0.1:13437，不附加转发头 |
| 私有入口 | Nginx 172.17.0.1:13425 与 172.17.0.1:13435 | 前者供容器访问 Magpie API，后者供 Magpie 访问隔离网关 |
| 每日备份 | `newapi-backup.timer` | 每日 03:40 使用 SQLite backup API 生成快照并校验完整性 |

Nginx 站点沿用 RAK 配置与证书：`bom.tokenbom.com`（9443）、`magpie.709970.xyz`（9443）、`magpie-api.709970.xyz`（9443）。证书有效期至 2027 年 1 月。

### 恢复的数据

- new-api：35 个用户、7 个渠道、40 个令牌、133 个兑换码。
- Magpie 配置：providers、caller-keys、logins、quotas 等。
- Claude Pro 账号凭据：`/home/claude/.claude/.credentials.json`（订阅类型 pro）。
- new-api 镜像二进制：从 RAK containerd 快照取出，与 RAK 镜像内二进制校验和一致。

### DMIT 上的端口调整（2026-11-03）

marzban 的 Reality 入站 `DMIT-LA` 原监听 `0.0.0.0:443`，与 Cloudflare 回源 443 冲突，导致 bom 返回 526。现改为：

- Reality 入站监听 `127.0.0.1:9444`（`/var/lib/marzban/xray_config.json`，marzban 重启会保留该文件的改动手工修改）。
- nginx 的 stream 模块按 SNI 分流 443：`bom.tokenbom.com` 转到 `127.0.0.1:9443`（nginx 的 bom HTTPS 站点），其余 SNI 转到 `127.0.0.1:9444`（Reality）。配置在 `/etc/nginx/stream-enabled/reality-split.conf`，该 include 必须位于 `include /etc/nginx/modules-enabled/*.conf;` 之后。
- marzban 的 `hosts` 表端口仍为空，客户端订阅继续使用 443，经分流后照常可用；无需更新客户端。
- hysteria2（DMIT-HY2，UDP 443）完全未改动，代理线路不中断。
- Magpie 网页密钥固定在 `/root/services/magpie/.web-key`（容器环境变量 `MAGPIE_WEB_KEY`），避免每次重启变化导致浏览器 cookie 失效。

### 账号与出口

| 账号 | 出口 | 状态 |
|---|---|---|
| Claude Pro（原 RAK 账号） | 48.46.113.162 | 已恢复，真实模型调用成功 |
| 第二个账号 | 48.45.131.171 | 隔离环境 `ci-dmit-b` 已建好，网页已登录，尚未开通订阅 |

## 2. 验证结果

- new-api → Magpie → 隔离网关 → Claude Pro → Anthropic 端到端调用返回 `ok`。
- 隔离命名空间内出口检测为 48.46.113.162 / US。
- Magpie 主网关列出 4 个 claude-pro 模型；new-api 中 4 个 Claude 渠道（1、6、7、8）的密钥与网关 caller-key 匹配。
- 从 RAK 救援系统访问 DMIT 三个域名：bom 200，magpie 与 magpie-api 401（需要网页密钥）。

## 3. 待办

1. **DNS 切换**：已完成。Cloudflare 中 `bom.tokenbom.com` 源站 A 记录、`magpie.709970.xyz` 与 `magpie-api.709970.xyz` 已指向 179.255.119.112，切换后出现过一次 Cloudflare 回源 526，由 443 端口 SNI 分流修复（见第 1 节）。
2. **客户端 base_url**：客户端配置若写死域名则无需改动；若写死 137.175.65.78 需更新。
3. **RAK 处置**：RAK 已退出救援系统并恢复读写，但云盘故障没有根治，工单 90180815 仍在等 RAK 存储侧处理。在 RAK 答复前不要向该机写数据。其旧的模型服务已停用（见第 5 节）。
4. **第二账号**：待开通订阅后，在 `ci-dmit-b` 隔离环境中完成 CLI 登录，再作为新的 Remote magpie 上游接入。
5. **双网关路由组**：主网关已登记两个上游（`claude-pro` 与 `dmit-b`），路由组尚未创建，也没有做过真实模型调用与故障切换验收。DMIT 账号可用后再建，先用 `routing=order` 保留 RAK 优先，`stays=session` 尽量保持同一会话落在同一上游。路由组要建在主网关本地，不要只依赖 DMIT 远端内部的路由组，否则 DMIT 整机不可达时无法自行切回 RAK。

## 4. 维护要点

- DMIT 的 UFW 需保留三条放行：`172.17.0.0/16 → 172.17.0.1:13435`、`172.17.0.0/16 → 172.17.0.1:13425`（容器访问 Magpie）、`172.20.0.0/16 → 172.17.0.1:13425`（new-api 容器访问 Magpie）。不要改 `9443/tcp` 的放行。
- Magpie 容器必须使用 `-p 127.0.0.1:13425:3425`；若改为发布到 172.17.0.1，Docker 的 DNAT 会劫持其它网桥的流量并导致 new-api 无法访问。
- 隔离网关的调用链依赖 Unix socket 转发而非 systemd-socket-proxyd：后者会附加 X-Forwarded-For，网关会以"来自代理"为由拒绝请求。
- 仓库中的 `configs/server/claude-runtime/` 仍是 RAK 版本的源码副本；DMIT 的实例脚本尚未回写仓库。

## 5. 迁移后的运维记录（2026-11-03 至 11-04）

### 5.1 DMIT 重启后的两处开机缺陷

DMIT 整机重启后，主要服务没有自动恢复，原因有两处，都已修复并写入开机配置：

- **Nginx 启动过早**：启动时 Tailscale 地址和 Docker 网桥地址尚未就绪，Nginx 绑定失败，BOM 因此返回 521。现在 Nginx 会等待这两个地址就绪再启动。
- **隔离网关的运行目录丢失**：隔离网关使用 `/run/iso-gateway`，该目录随重启消失。现在由 systemd 自动创建并设置权限。

这两处只做了配置加载和语法检查，**没有再次重启 DMIT 验证完整开机流程**。

### 5.2 RAK 恢复后的旧服务停用

RAK 在硬重启后恢复了原 Ubuntu 系统，公网和 Tailscale SSH 都可连接，根分区以读写方式挂载，本次启动的约 5 小时内核日志里没有新的磁盘 I/O 错误。但旧 new-api 数据库已损坏，反复重启并报 `database disk image is malformed`，备份服务 `bom-backup`、`bom-healthcheck`、`claude-backup` 均为失败状态。

按当前决定，RAK 不再承载模型服务，已停用：

| 已停用 | 说明 |
|---|---|
| Magpie 容器 | 容器重启策略改为 `no` |
| new-api | 数据、配置和备份全部保留，只是不再运行 |
| Claude 订阅网关 | 关闭自启，避免与 DMIT 上的同一账号争抢凭据刷新 |
| 旧浏览器桌面 | 相关保活定时任务一并关闭 |

RAK 的 Hysteria2、Xray 节点和 Nginx 保持运行，PID 未变。DMIT 上的 Magpie 保持 `healthy`，new-api 状态接口返回 200。

### 5.3 DMIT 根盘清理

根盘一度用到 89%（剩余约 2.2GB），清理后可用空间 7.8GB，占用率 59%。

| 处理对象 | 结果 |
|---|---|
| Antigravity Manager | 删除容器、1.62GB 镜像、数据目录和 `ag.142314.xyz:8443` 的 Nginx 转发块，并从 cli-proxy-api 移除对应上游 |
| CPA 用量历史库 | 保留配置表、模型价格和密钥别名，删除历史调用记录，数据库从约 2.5GB 压到 0.74MB |
| CPA 备份 | 删除升级备份、旧库和回滚镜像；混合归档中只移除 CPA 部分，CLIProxyAPI 部分逐项校验后保留 |

`ag.142314.xyz` 域名下的浏览器面板不属于 Antigravity，已保留。

### 5.4 CPA Manager Plus 的用量采集已关闭

采集器由容器环境变量强制开启，无法在网页里直接关闭。做法的顺序是：先把上游连接配置从容器环境变量迁入 CPA 自己的加密数据库，再关闭采集。复查结果为采集器 `stopped`、配置 `enabled=false`，关闭状态随重启保留；管理配置、27 条模型价格和 11 个密钥别名都还在。

关闭的是 CPA Manager 的采集器。CLIProxyAPI 自身的上游用量统计没有关闭，也没有通过真实模型请求验证后续的记录行为。

### 5.5 DMIT 管理入口

此前仓库没有记录 DMIT 的登录方式。本机 `~/.ssh/config` 里有 `dmit` 别名：

```bash
ssh dmit    # Tailscale 100.120.162.88，用户 root
```

### 5.6 磁盘看护

用量库已清空且采集已关闭，不再持续增长。仍需留意 `/root/j/browsers/profiles`（约 587MB，4 个浏览器账号资料）。`/root/service-upgrade-backups` 的历史备份（约 984MB）已在 2026-11-06 经用户授权清空，仅保留 reality-split 一项与当轮新回滚点；旧回滚容器与 rc.45/rc.47 镜像同批删除。

### 5.7 DMIT 上的其它本地服务入口

除了模型服务，DMIT 上还有两个只监听回环的管理入口，需要 SSH 转发到本机才能访问，不要改成对外监听：

| 服务 | 服务器上的地址 | 检查结果 |
|---|---|---|
| CLIProxy API | `http://127.0.0.1:8317/` | HTTP 200 |
| CLIProxy API 内置管理面板 | `http://127.0.0.1:8317/management.html` | HTTP 200，页面标题为 CLI Proxy API Management Center |
| CPA Manager Plus 面板 | `http://127.0.0.1:18317/management.html` | 根路径 `/` 返回 307 跳到这个地址，跟随后 HTTP 200，页面标题为 CPA Manager Plus |

两个端口都只监听 `127.0.0.1`。`/v1/models` 在未带密钥时返回 401，说明鉴权正常。面板本身没有接入隔离网络，从主机网络直接访问即可。

另有一条与 BOM 计费相关的行为变化：Magpie 从 v0.1.1180 升到 v0.1.1220 之后，发往 Anthropic 接口的请求如果不指定 `max_tokens`，输出上限改为模型自身的上限，不再固定为 16384。付费 Claude 渠道的请求若不带这个参数，单次回复可能更长，费用也会更高。

Magpie 容器 2026-11-04 晚经 relay-stack-upgrade 升级到 v0.1.2976（此前 v0.1.2753 固定摘要的做法已被滚动升级取代），CLIProxyAPI、CPA Manager Plus 与 new-api 同轮升级，见 5.8。

CPA 的用量库在 2026-11-04 复核过：清空后只留下 1 条 2026-11-02 的记录，之后没有新增用量事件，库文件稳定在约 756KB。

### 5.8 2026-11-04 四项中转服务升级

relay-stack-upgrade 技能的三日周期在 2026-11-04 到期，四项服务当轮全部处理，端点表已随迁移修正（magpie 与 new-api 从 RAK 改指 DMIT 的 `dmit` 别名，SSH 走 Tailscale）：

| 服务 | 旧版本 | 新版本 | 验证 |
|---|---|---|---|
| magpie | v0.1.2753 | v0.1.2976 | healthy、未鉴权 401、4 个模型；真实推理因 claude-pro 账号登出暂不可验（见下） |
| CLIProxyAPI | v8.0.47 | v8.0.54 | healthz 200、14 个模型、gpt-6-luna 真实推理 200 |
| CPA Manager Plus | v1.14.10 | 无更新 | cleanup-derived 完成，覆盖索引就绪 |
| new-api | rc.45 | rc.48 | /api/status 版本一致、303 项价格/钱包测试、三项定制功能实页确认 |

每项都有停写备份与回滚脚本，在 `/root/service-upgrade-backups/<组件>-20261104T15*/`。new-api 的 compose 已固定到 rc.48 镜像标签。

升级过程中发现四个与版本无关的问题，其中第一个已随升级顺带修复：

1. **容器 DNS 快照指向 Tailscale MagicDNS**。11-03 重启后创建的容器把宿主机当时的 resolv.conf（100.100.100.100）快照进了 Docker 内嵌 DNS，而 MagicDNS 对公网域名返回 SERVFAIL，导致 CLIProxyAPI 访问 chatgpt.com 当日 684 次全部 500。容器重建后快照恢复为 1.1.1.1，故障消失；new-api 与 UI 容器同样中招并同轮修复。MagicDNS 本身解析不了公网域名的问题仍在，宿主机 resolv.conf 再被 tailscaled 覆盖期间创建的容器会复现。
2. **claude-pro 上游账号登出**。隔离订阅网关直连秒回 "Claude Code is no longer signed in"，说明账号会话已失效；主 magpie 对这种上游的请求无限排队（客户端只收到 SSE keepalive，不会快速报错）。重新登录前 claude-pro 的 4 个模型不可用，BOM 渠道 8（claude pro 订阅）同样受影响。**2026-11-06 已恢复**：在隔离环境用 `claude auth login --claudeai` 触发授权码流程重新登录，三层验证全部通过（CLI 订阅类型 pro、隔离网关推理 200、主 magpie claude-pro 推理 200），见 5.10。
3. **BOM 渠道 6 的 factory/* 映射失效**。渠道 6（claude-4）三个模型的渠道测试均 404：magpie 已无 factory 前缀模型名。属 11-01 迁移遗留，按升级纪律未改映射，待决策后单独修。
4. **iso-gateway-relay.py 清理路径缺陷**。连接结束的清理代码对 StreamReader 调 close，每次连接收尾都抛 AttributeError（12 小时 876 次）。当前进程 fd 数 8，暂无泄漏迹象；源码在 DMIT `/usr/local/libexec/iso-gateway-relay.py`，不在本仓库，待修。

另注：magpie 的 GHCR `:latest` 是滚动标签，发布日一天多次前进（本轮 2975→2976 后复核又见新镜像），"最新"以部署时刻为准，剩余差距由三日周期跟进。

2026-11-06 追加一轮（用户指示）：清空旧备份后按同流程升级 magpie v0.1.2976→v0.1.3123、CLIProxyAPI v8.0.54→v8.0.57（模型数 15→18，升级前后真实推理均 200，11-04 的 DNS 修复持续有效）；UI 与 new-api 无更新（v1.14.10 / rc.48 仍为最新，UI 照常完成 cleanup-derived）。claude-pro 账号登出、渠道 6 factory/* 映射、MagicDNS 三个遗留问题当日仍未处理。

### 5.9 Claude Pro 按需登录桌面

2026-11-06 在 DMIT 的原账号环境 `claude-rak` 中启动临时桌面，供用户自行登录。与第二个账号 `ci-dmit-b` 的桌面相互独立。

| 组件 | 位置与用途 |
|---|---|
| 桌面单元 | `iso-claude-rak-desktop.service`，以 `claude` 用户运行，使用原 `claude-rak` 网络命名空间 |
| 浏览器资料 | `/home/claude/browser-profile`，持久保留；浏览器配置和缓存另放临时运行目录，避免改动既有 Magpie 配置权限 |
| VNC 与 noVNC | 命名空间内回环 `5900` / `6080`，桌面为 1366×768，Chrome 保留 sandbox |
| 主机转发 | `iso-claude-rak-novnc.socket` / `.service`，只监听 DMIT `127.0.0.1:16080`，转入命名空间的 `6080` |
| 本机入口 | SSH 隧道监听 `127.0.0.1:6080`，访问 `http://127.0.0.1:6080/vnc.html?autoconnect=1&resize=scale` |
| 浏览器出口 | 命名空间回环 HTTP 代理 `7890`；本轮核实住宅出口 `48.46.113.162` / US |

在本机保持以下隧道运行：

```bash
ssh -N -o BatchMode=yes -o ConnectTimeout=15 -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -o ExitOnForwardFailure=yes -L 127.0.0.1:6080:127.0.0.1:16080 dmit
```

桌面和转发使用临时 systemd 单元，不随服务器重启恢复。本轮已验证 noVNC HTTP 200、VNC 完整握手及分辨率，并核实 Chrome 的运行用户、网络命名空间和代理参数；账号登录和真实模型调用须在用户完成授权后另验。仅登录 Claude 网页不能视为订阅网关的 Claude Code 授权已恢复。

结束使用时先关闭本机 SSH 隧道，再在 DMIT 停止这组临时单元：

```bash
systemctl stop iso-claude-rak-novnc.socket iso-claude-rak-novnc.service iso-claude-rak-desktop.service
```

### 5.10 2026-11-06 Claude Code 重新登录与整机重启

按 5.9 启动桌面后，1 核 2GB 的 DMIT 两次被桌面交互压满（Chrome 14 个进程约 832MB，负载峰值 19.6），SSH 握手超时、BOM 源站无响应，第二次用户从 DMIT 控制面板触发强重启。这是 11-03 两处开机修复（nginx 等待 Tailscale/Docker 就绪、/run/iso-gateway 自动创建）之后的首次真实重启，两项均验证通过；全部容器按重启策略自动恢复，bom 经 nginx 返回 200。

重启后按用户指示先停 marzban 容器释放资源，再重启桌面并重新触发登录。登录流程：在 claude-rak 命名空间内以 claude 用户运行 `claude auth login --claudeai`，CLI 输出授权链接并等待粘贴授权码；进程用 FIFO 做标准输入、detached 运行，链接在隔离桌面浏览器打开，授权码回传后写入 FIFO 完成。凭据更新于 11-06 11:06 UTC。

恢复验证（三层）：CLI `auth status` 显示订阅类型 pro；经 13437 直连隔离网关推理返回 200 "OK"；主 magpie `claude-pro/claude/claude-sonnet-5-5` 返回 200 "OK"（3.3 秒），用量记录 err 为空。

当日遗留状态：marzban 容器处于手动停止（DMIT-LA 节点临时下线，等用户决定恢复时机）；临时桌面单元在登录完成后停止，浏览器资料与 claude.ai 会话保留在 /home/claude/browser-profile。
