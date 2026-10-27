# Step 10：DMIT 与 RAK 独立部署

更新日期：2026-10-27。状态：5.1、5.2、5.4、5.5 已施工并验收，手机端配置已生成但未在手机上验证；5.3 等待 DMIT 换 IP 审核；5.5 第 3 步（删除 marzban-node 容器）待观察 24 小时后执行。施工结果见第 9 节。

## 1. 背景与目标

2026-10-26 北京时间 16:00 左右，DMIT、RAK、AWS 三台服务器的 IP 在国内同时被封锁 TCP：客户端发出的连接请求能到达服务器，服务器的应答在回程被丢弃。ICMP 和 UDP 不受影响，DMIT 上走 UDP 的 Hysteria2 仍然可用。三台服务器分属三家服务商，却在同一小时被封，而它们的共同点是同一套 VLESS Reality 用户 ID 与密钥、同一个客户端和相同的使用方式。因此推断封锁针对的是 Reality 流量特征，而不是某个机房。

目标是让 DMIT 和 RAK 成为两条互不牵连的线路：一条被封时，另一条仍然可用，客户端可以自动或手动切换。约束条件是 DMIT 可以更换 IP，RAK 只能继续使用已被封锁 TCP 的原 IP。据此分工如下：

1. DMIT 更换 IP 后以 Reality（TCP）为主、Hysteria2（UDP）为备用，并更换全部 Reality 密钥。
2. RAK 以 Hysteria2（UDP）为主，经 Cloudflare CDN 转发的线路为备用。CDN 线路中，Cloudflare 到 RAK 这一段在海外，不受 RAK 的 IP 在国内被封锁的影响。
3. 两台服务器使用各自独立的用户 ID、密钥、伪装目标和客户端配置，RAK 不再共用 Marzban 下发的入站配置。

两条线路的主协议错开，一条走 TCP，一条走 UDP。这样只能降低同时被封的概率，不能保证不被封。两条线路的流量都来自同一台电脑，如果封锁依据的是客户端行为，风险仍然存在。

## 2. 现状

| 项目 | DMIT | RAK |
|---|---|---|
| 套餐 | 洛杉矶 Pro TINY，每月 1TB 双向流量，2027-03-25 到期，自动续费 | 圣何塞共享 VPS，2027-09-19 到期，未开自动续费 |
| 入站 | Marzban 主控，Reality 监听 TCP 443，伪装目标 www.apple.com | marzban-node 容器（镜像 `marzban-node:rak-8443`），Reality 监听 TCP 8443，与 DMIT 共用入站配置和密钥 |
| Hysteria2 | `hysteria-server`，UDP 443，密码认证，使用域名的 Let's Encrypt 证书 | 未部署，UDP 443 空闲 |
| TCP 443 / 80 | Xray | nginx（承载网站，不可占用） |
| 其他业务 | cpa-manager-plus、cli-proxy-api、antigravity-manager | Claude 隔离运行环境、magpie、new-api、nginx 网站 |
| 管理 | 面板端口 39721 | 经 DMIT 上的 `marzban-node-tunnel` SSH 隧道接入 Marzban |
| 换 IP | 后台“网络”页有自助“Change IP”，2026-09-25 已换过一次 | 不换 |
| 异常 | 无 | 8 个 xray 进程同时监听 8443，疑似 marzban-node 多次重连后的残留 |

域名 `DOMAIN_NAME` 的 DNS 托管在 Namecheap，A 记录指向 DMIT 当前 IP。

## 3. 目标架构

| 线路 | DMIT（新 IP） | RAK（原 IP） |
|---|---|---|
| 主协议 | Reality，TCP 443，新密钥、新伪装目标 | Hysteria2，UDP 443，自签证书并在客户端固定证书指纹 |
| 备用协议 | Hysteria2，UDP 443（保持现状） | CDN 线路：VLESS + WebSocket，经 Cloudflare 转发，由现有 nginx 按子域名 `<CDN_DOMAIN>` 反代到本机回环端口 |
| 管理方式 | 保留 Marzban | 独立的 systemd 服务，脱离 Marzban |
| 客户端配置来源 | Marzban 订阅 | 本机渲染脚本从 `secrets.env` 注入，不经网络下发 |

RAK 原来的 Reality 入站随 marzban-node 一起停用，不再部署。RAK 的客户端配置不放进任何在线订阅，避免一份订阅同时暴露两台服务器。

客户端策略组：

| 策略组 | 类型 | 成员 |
|---|---|---|
| DMIT | 故障转移 | DMIT-Reality、DMIT-HY2 |
| RAK | 故障转移 | RAK-HY2、RAK-CDN |
| 线路选择 | 手动选择 | DMIT、RAK |
| Bulk-Traffic | 手动选择 | RAK（默认）、DMIT |

大流量默认走 RAK，避免占用 DMIT 每月 1TB 的额度。

## 4. 施工前需要准备的事项

| 事项 | 负责人 | 说明 |
|---|---|---|
| DMIT 更换 IP | 本人在 DMIT 后台点击，时间与我约定 | 在第 5.3 步执行。换 IP 会断开所有连接，包括其他使用 DMIT 订阅的用户 |
| CDN 用的域名 | 已确定 | 使用 Cloudflare 账号中已有的一个闲置域名 `<CDN_ZONE>`，新建子域名 `<CDN_DOMAIN>`。不用承载正式业务的域名，代理线路出问题会连累业务。DNS 记录和源站证书在 Cloudflare 后台操作，不需要 API Token |
| Namecheap 修改 A 记录 | 本人，或提供 API 权限 | DMIT 换 IP 后，把 `DOMAIN_NAME` 的 A 记录改到新 IP |
| 是否让 RAK 脱离 Marzban | 本人确认 | 脱离后，面板里看不到 RAK 的用户流量 |

## 5. 施工步骤

施工期间经 DMIT-HY2 登录各服务器，因为三台服务器的原 IP 都无法直连 TCP。

### 5.1 RAK 部署 Hysteria2（约 1 小时）

先做这一步，不需要换 IP，也不需要域名，做完就多一条可用线路。

1. 备份 `/var/lib/marzban-node/`、`/opt/marzban-node-custom/` 和 marzban-node 的容器定义。
2. 停止 marzban-node 容器，但不删除，回滚时可以直接启动；清理 8 个残留的 xray 进程。
3. 安装 Hysteria2，写 `/etc/hysteria-rak/config.yaml`，监听 UDP 443，生成自签证书并记录 SHA-256 指纹，出站保留服务端屏蔽规则（BT、国内 IP、挖矿），由 `hysteria-rak.service` 运行。
4. 新密码和证书指纹写入本机 `secrets.env`，不写入仓库。

验收：服务 active，UDP 443 在监听；从本机物理网卡直连，经临时客户端访问 `https://www.gstatic.com/generate_204` 返回 204，出口 IP 为 RAK；国内 IP 测试目标被屏蔽；Claude 隔离环境的四个服务仍然 active。

### 5.2 本机客户端配置（约 1 小时）

1. 修改 `configs/client/Script.js`：新增 RAK-HY2，去掉旧的 RAK Reality 节点，按第 3 节建立 DMIT、RAK、线路选择三个策略组，Bulk-Traffic 默认指向 RAK 组。RAK-CDN 在第 5.4 步完成后再加入。
2. 同步修改 `configs/client/Script.test.js`，增加以下断言：RAK 组不引用 DMIT 节点、DMIT 组不引用 RAK 节点、新增节点的字段完整。
3. 修改 `configs/client/shadowrocket.conf` 及其渲染脚本，手机端同样分成两组。
4. 用 `node scripts/render-client-script.js` 渲染并安装，在 Clash Verge 中重载配置。

验收：测试通过；RAK-HY2 和 DMIT-HY2 的延迟测试成功；手动切换线路选择后，出口 IP 随之变化。

### 5.3 DMIT 更换 IP 与更换 Reality 密钥（约 1.5 小时）

换 IP 会切断当前所有 SSH 和代理连接，必须提前约定时间。DMIT 后台有 VNC 控制台，网络配置出问题时从控制台恢复。

1. 换 IP 前记录现状：`/etc/netplan/50-cloud-init.yaml`、Marzban 入站配置、`hysteria-server` 配置和各容器状态。
2. 本人在 DMIT 后台“网络”页点击“Change IP”。
3. 经 VNC 控制台或新 IP 登录，确认网卡已拿到新 IP。netplan 文件中写死了旧 IP，如果后台没有自动更新，就手动改成新 IP 并执行 `netplan apply`。
4. 修改 Namecheap 上 `DOMAIN_NAME` 的 A 记录，指向新 IP；确认面板和订阅地址可以访问，Let's Encrypt 证书与 IP 无关，不需要重签。
5. 更新 Marzban 的 Clash 订阅模板 `/var/lib/marzban/templates/clash/custom.yml` 中写死的旧 IP。Marzban 主机地址使用 `{SERVER_IP}` 变量，会自动变成新 IP。
6. 生成新的 x25519 密钥对和 shortId，伪装目标换成 www.apple.com 以外、支持 TLS 1.3 和 HTTP/2 的海外大站，部署前用 `xray tls ping` 验证；在 Marzban 中更新入站配置并重启 Xray 核心。AWS 的 marzban-node 共用这份入站配置，会一并换成新密钥；AWS 目前同样被封，不受实际影响。
7. 更新本机：`secrets.env` 的 `SERVER_IP` 和 Reality 参数、`~/.ssh/config` 中 `dmit` 的地址，重新渲染并安装客户端脚本，刷新 DMIT 订阅。
8. 通知其他使用 DMIT 订阅的用户刷新订阅。本机 Clash 里至少还缓存着另一位用户的 DMIT 订阅。

验收：从本机物理网卡直连新 IP 的 TCP 443 能完成握手；DMIT-Reality 和 DMIT-HY2 延迟测试成功，出口为新 IP；DMIT 上的 cpa-manager-plus、cli-proxy-api、antigravity-manager 正常。

已核实不受影响的地方：RAK 上 new-api 数据库中出现的 DMIT 旧 IP 都是访问日志里的来源地址，不是配置；AWS 上没有写死 DMIT 的 IP。

### 5.4 RAK 部署 CDN 线路（约 1 小时）

1. 在 Cloudflare 为 `<CDN_ZONE>` 添加子域名 `<CDN_DOMAIN>` 的 A 记录，指向 RAK 的 IP，开启代理（橙色云朵）。该域名的 SSL 模式当前为“完全”，与源站证书兼容，保持不变；它是整个域名的设置，改动会影响同域名下的 harbor、jd 等现有子域名。
2. 在 RAK 上生成 `<CDN_DOMAIN>` 的自签证书，放到 `/etc/nginx/ssl/<CDN_DOMAIN>/`，权限 0600。SSL 模式“完全”不校验源站证书的签发者，自签证书即可使用，不需要在 Cloudflare 后台签发源站证书。
3. 用官方 Xray 二进制写独立配置 `/etc/xray-rak/config.json`，由新的 systemd 服务 `xray-rak.service` 运行：VLESS + WebSocket 入站只监听 `127.0.0.1` 的一个高位端口，路径使用随机字符串，使用新的用户 ID，出站保留服务端屏蔽规则。
4. 新增 nginx server 块：仅匹配 `<CDN_DOMAIN>`，指定路径反代到上述回环端口，其他路径返回普通网页；`nginx -t` 通过后用 `systemctl reload nginx` 平滑加载，不重启，不影响现有网站。
5. 在客户端脚本中加入 RAK-CDN，重新渲染并安装。

验收：经 CDN 线路访问 generate_204 返回 204；现有网站的首页和证书不变；nginx 主进程 PID 不变。

### 5.5 RAK 脱离 Marzban（约 20 分钟，需单独确认）

1. 在 Marzban 中禁用 RAK 节点。
2. 停用 DMIT 上的 `marzban-node-tunnel.service`。
3. 观察 24 小时没有问题后，再删除 RAK 上的 marzban-node 容器和镜像。

验收：Marzban 面板正常，DMIT 和 AWS 节点不受影响。

### 5.6 文档更新（约 30 分钟）

更新 `playbook/07-multi-node-cluster.md`、`HANDOFF.md` 和 `secrets.example.env`，记录新的拓扑、服务名、验收命令和回滚方法。本文件状态改为已施工。

## 6. 新增配置项

在 `secrets.env` 中新增或修改，值只保存在本机：

| 变量 | 含义 |
|---|---|
| `SERVER_IP` | DMIT 新 IP（修改） |
| `REALITY_PUBLIC_KEY`、`REALITY_SHORT_ID`、`REALITY_SNI`、`REALITY_DEST` | DMIT 新 Reality 参数（修改） |
| `RAK_HY2_PASSWORD`、`RAK_HY2_PIN_SHA256` | RAK Hysteria2 密码和证书指纹 |
| `RAK_UUID`、`CDN_DOMAIN`、`CDN_PATH` | RAK CDN 线路的用户 ID、域名和路径 |

`secrets.example.env` 只增加对应的占位符。

## 7. 回滚

| 步骤 | 回滚方法 |
|---|---|
| 5.1 | 停止 `hysteria-rak`，启动原 marzban-node 容器 |
| 5.2、5.4 客户端部分 | 恢复渲染脚本自动生成的 `Script.js.bak-*` 备份并重载 |
| 5.3 | IP 无法换回；网络配置出错时从 VNC 控制台恢复备份的 netplan 文件；Reality 密钥可恢复为备份的入站配置 |
| 5.4 服务端部分 | 停止 `xray-rak`，删除新增的 nginx server 块并 reload，删除 Cloudflare DNS 记录 |
| 5.5 | 重新启用 `marzban-node-tunnel.service` 和 Marzban 中的 RAK 节点 |

## 8. 风险与边界

1. 不修改 RAK 的 Claude 隔离运行环境、magpie、new-api 和现有 nginx 网站；nginx 只做 reload。
2. 不修改全机防火墙的默认策略，不全局禁用 UDP。
3. 本方案不包括 AWS。AWS 的 IP 同样被封锁，Grok 分流暂时不可用，是否更换 IP 另行决定。
4. DMIT 换到新 IP 后，如果继续沿用相同的使用方式，新 IP 也可能再次被封；届时仍可依靠 RAK 线路。
5. RAK 两条线路都不走 TCP 直连：Hysteria2 在运营商对 UDP 限速时会变慢，CDN 线路的速度受 Cloudflare 回源影响。RAK 线路更适合作为备用和承载大流量下载，日常主力放在 DMIT。

## 9. 施工记录

### 2026-10-27：5.1 与 5.2

RAK 侧：

1. 备份位于 RAK 的 `/var/backups/independent-nodes/20261027T031804Z/`，包括 marzban-node 数据目录、容器定义和当时的 xray 进程列表。
2. marzban-node 容器已停止并把重启策略改为 `no`，容器保留未删除。停止后残留的 xray 进程全部退出，TCP 8443 不再监听。
3. Hysteria2 v2.13.0 安装在 `/usr/local/bin/hysteria`，安装前核对了官方发布的 SHA-256。配置在 `/etc/hysteria-rak/`（目录 0700，文件 0600），自签证书的名称为 www.bing.com，有效期 10 年。服务 `hysteria-rak.service` 以 systemd 动态用户运行，只授予绑定低端口的能力，配置和证书通过 `LoadCredential` 传入。
4. 访问控制拒绝以下目标：本机回环、本机公网 IP、私有网段、Tailscale 网段（100.64.0.0/10）、链路本地地址、`geoip:cn` 和 `geosite:cn`。拒绝本机公网 IP 是为了防止经代理绕过安全组访问 RAK 上只对本机开放的端口。只按 IP 判断拦不住百度，因为从美国解析出的百度地址不在中国 IP 库里，所以另加了 `geosite:cn`。
5. 原方案遗漏了一点：RAKsmart 安全组是入站白名单，原本只放行若干 TCP 端口、ICMP 和 UDP 68，海外和国内发往 RAK 的 UDP 都在平台入口被丢弃。已在 RAKsmart 后台为默认安全组新增“入站 UDP 443，来源 0.0.0.0/0”，其他规则未改动。

本机侧：

1. `configs/client/Script.js` 改为注入 RAK-HY2，清除订阅中残留的 RAK-Bulk-1T 节点及所有分组对它的引用，新增“线路选择”“DMIT”“RAK”三个分组；Bulk-Traffic 默认走 RAK 组，Proxy 组首项为“线路选择”。
2. `scripts/render-client-script.js` 把 `RAK_HY2_PASSWORD`、`RAK_HY2_PIN_SHA256`、`RAK_HY2_SNI` 列为必填项；`secrets.example.env` 增加对应占位符。
3. Clash Verge 当前订阅从 YKKCLOUD 切回 liukun（DMIT 订阅），Proxy 组选择“线路选择”，AI 组从被封的 DMIT-LA 改为 DMIT-HY2。

验收结果：

| 检查项 | 结果 |
|---|---|
| 从本机物理网卡直连 RAK-HY2 | generate_204 返回 204，出口 IP 为 RAK，下载约 2.3 MB/s |
| RAK-HY2 访问控制 | 回环、Docker 网段、Tailscale 地址、RAK 公网 IP、百度、淘宝均被拒绝；Google、YouTube 正常 |
| RAK 原有业务 | Claude 隔离环境四个服务、nginx、magpie、new-api 正常 |
| Clash 默认流量 | 经“线路选择 → DMIT → DMIT-HY2”，出口为 DMIT；Google、GitHub 正常，下载约 2.5 MB/s |
| 线路切换 | “线路选择”切到 RAK 后出口变为 RAK，切回 DMIT 后恢复 |
| 大流量分流 | YouTube 经“Bulk-Traffic → RAK → RAK-HY2” |
| 国内网站 | 百度直连 |

未完成和注意事项：

1. 手机端 Shadowrocket 配置未改。它的节点全部来自 Marzban 订阅，RAK-HY2 需要单独导入，证书指纹参数未在手机上验证。
2. 服务端重启 `hysteria-rak` 后，客户端约需 10 秒重新建立连接，期间请求会超时。
3. Hysteria2 没有按协议识别 BT 流量的能力，RAK-HY2 无法像 Xray 那样屏蔽 BT。
4. 后续修正：`geosite:cn` 所用的域名库把国内可访问的谷歌、苹果等域名也算作中国域名，导致健康检查地址 www.gstatic.com 被拒绝、RAK 组误切到 CDN 节点。已从 RAK-HY2 的访问控制中删除 `geosite:cn`，只保留 `geoip:cn`。

### 2026-10-27：5.4、5.5 与手机端

5.4 RAK CDN 线路：

1. Xray v26.10.21 安装在 `/usr/local/lib/xray-rak/`（含 geoip、geosite 数据），安装前核对了官方发布的 SHA-256。配置在 `/etc/xray-rak/config.json`，服务 `xray-rak.service` 以 systemd 动态用户运行，不授予任何特权能力，入站只监听 `127.0.0.1` 的高位端口（端口号记在本机 `secrets.env` 的 `RAK_CDN_LOCAL_PORT`）。
2. 路由规则拒绝私有网段、Tailscale 网段、RAK 公网 IP、`geoip:cn`、`geosite:cn` 和 BT 协议。这里的 `geosite:cn` 来自 Xray 自带的数据文件，实测不影响苹果、微软、iCloud、GitHub 和 gstatic。
3. nginx 新增 `/etc/nginx/sites-available/rak-cdn` 并链接到 `sites-enabled`：只匹配 `<CDN_DOMAIN>`，指定路径上的 WebSocket 请求反代到 Xray，其余请求返回 404；证书为自签证书。只做了 `systemctl reload nginx`，主进程 PID 未变，现有网站返回正常。改动前的 nginx 目录备份在 RAK 的 `/var/backups/independent-nodes/cdn-20261027T034908Z/`。
4. Cloudflare 中为 `<CDN_ZONE>` 新增了 `<CDN_DOMAIN>` 的 A 记录，指向 RAK，已开启代理。
5. 方案原定使用 XHTTP 传输。服务端链路验证通过（请求经 Cloudflare 和 nginx 到达 Xray），但当前 Clash Verge 内置的 mihomo v1.19.21 用 XHTTP 连接时在 TLS 阶段报 `protocol version` 错误，因此改为 WebSocket，Shadowrocket 也支持。
6. 验收：从本机物理网卡经 Cloudflare 连接，generate_204 返回 204，出口 IP 为 RAK，YouTube 正常，下载约 2.2 MB/s；百度、RAK 本机回环、Tailscale 地址、RAK 公网 IP 均被拒绝。Clash 中 RAK 组为“RAK-HY2 优先、RAK-CDN 备用”，两者延迟测试约 196 ms 和 222 ms。

5.5 RAK 脱离 Marzban：

1. 修改前备份了 DMIT 上的 `/var/lib/marzban/db.sqlite3`（同目录下 `db.sqlite3.pre-rak-detach-*.bak`）。
2. 经 Marzban 接口把 RAK-Bulk-1T 节点设为 disabled；DMIT 上的 `marzban-node-tunnel.service` 已停止并取消开机自启。
3. 面板返回 200，DMIT 的 `hysteria-server`、`marzban-aws-tunnel` 和 AWS 节点不受影响。
4. RAK 上的 marzban-node 容器仍保留，观察 24 小时后再删除容器和镜像。

手机端：

1. `configs/client/shadowrocket.conf` 改为“线路选择”“DMIT”“RAK”三个分组，Bulk-Traffic 默认走 RAK。
2. `scripts/render-shadowrocket.sh` 在生成配置的同时，从 `secrets.env` 生成 RAK-HY2 与 RAK-CDN 的导入链接，写到配置文件旁的 `*-rak-nodes.txt`，权限 0600，导入后应删除。
3. 未在手机上验证，尤其是 Shadowrocket 对 Hysteria2 链接中 `pinSHA256` 参数的支持。

