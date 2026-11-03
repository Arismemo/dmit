# DMIT 承接 BOM 中转站与 Claude Pro 账号

日期：2026-11-01。起因是 RAK（137.175.65.78）云盘反复出现 I/O 错误，容器运行时无法启动，SSH 与网站均不可用；工单 RAK #90180815 记录了故障与数据保全要求。

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

1. **DNS 切换**：Cloudflare 中 `bom.tokenbom.com` 源站 A 记录、`magpie.709970.xyz` 与 `magpie-api.709970.xyz` 需从 137.175.65.78 改到 179.255.119.112。切换前 DMIT 服务已就绪但公网访问仍按旧记录。
2. **客户端 base_url**：客户端配置若写死域名则无需改动；若写死 137.175.65.78 需更新。
3. **RAK 处置**：RAK 仍在救援系统且磁盘故障未修复，等待 RAK 存储侧处理；不要在其上写入数据。
4. **第二账号**：待开通订阅后，在 `ci-dmit-b` 隔离环境中完成 CLI 登录，再作为新的 Remote magpie 上游接入。

## 4. 维护要点

- DMIT 的 UFW 需保留三条放行：`172.17.0.0/16 → 172.17.0.1:13435`、`172.17.0.0/16 → 172.17.0.1:13425`（容器访问 Magpie）、`172.20.0.0/16 → 172.17.0.1:13425`（new-api 容器访问 Magpie）。不要改 `9443/tcp` 的放行。
- Magpie 容器必须使用 `-p 127.0.0.1:13425:3425`；若改为发布到 172.17.0.1，Docker 的 DNAT 会劫持其它网桥的流量并导致 new-api 无法访问。
- 隔离网关的调用链依赖 Unix socket 转发而非 systemd-socket-proxyd：后者会附加 X-Forwarded-For，网关会以"来自代理"为由拒绝请求。
- 仓库中的 `configs/server/claude-runtime/` 仍是 RAK 版本的源码副本；DMIT 的实例脚本尚未回写仓库。
