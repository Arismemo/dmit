# 其它会话沉淀（2026-11-04）

本文汇总本仓库下另外十二个历史会话的结论，并写明每条结论落在哪个文件里。这些会话已归档，不再作为事实来源；维护时以本文、[HANDOFF.md](HANDOFF.md) 和 [playbook/](playbook/) 为准。

## 1. 会话清单

| 会话 | 时间 | 主题 | 结论去向 |
|---|---|---|---|
| Claude家宽环境-多账号-清理dmit | 2026-10-04 至 11-03 | RAK 上 Claude 家宽隔离环境的加固、Magpie 双网关方案、RAK 云盘故障、DMIT 磁盘清理、CPA 采集关闭 | 本文第 2、4 节；[Step 12](playbook/12-dmit-bom-migration.md)；HANDOFF |
| Claude家宽环境-多账号-救rak（上一会话的分支） | 2026-11-01 至 11-04 | DMIT 承接 BOM 中转站与 Claude Pro 账号、RAK 故障恢复与旧服务停用 | [Step 12](playbook/12-dmit-bom-migration.md)；HANDOFF |
| Telegram 消息加载与 Clash Verge 配置 | 2026-11-03 | Telegram 掉线定位、订阅节点健康检查 | [Step 5](playbook/05-subscription-template.md) 第 4 节 |
| Simple greeting | 2026-11-03 | 无实质内容 | 无 |
| Clash Verge 配置与运行检查 | 2026-11-01 | 本机 Clash 运行状态与分流核对 | 结论已并入 [Step 5](playbook/05-subscription-template.md) 第 4 节 |
| 代理服务器问题排查 | 2026-10-27 | 三台 VPS 的 TCP 被封、RAK 独立部署、CDN 线路、脱离 Marzban、统一订阅 | [Step 10](playbook/10-independent-nodes.md) 第 9 节；[Step 11](playbook/11-unified-subscription.md) |
| 其他用户订阅导入失败 | 2026-10-29 | liuqing 的订阅导入失败与本机修复现场 | [Step 5](playbook/05-subscription-template.md) 第 4.4 节；本文第 3 节 |
| rak上Claude运行状态 | 2026-10-27 | RAK 上的 Claude 环境体检、Magpie 接入评估 | 本地项目记忆与 MemOS；本文第 3 节 |
| dmit机器上面,claude账号状况如何 | 2026-10-27 | DMIT 上的账号与 Magpie 额度核对 | 本地项目记忆与 MemOS |
| Shadowrocket 的 Tailscale 规则放进云端模板 | 2026-10-27 | 手机端配置为什么不能并入云端模板 | [Step 11](playbook/11-unified-subscription.md) |
| clash | 2026-10-11 至 10-27 | 本机 Clash 状态、分流与出口核对 | [Step 5](playbook/05-subscription-template.md) 第 4 节 |
| magpie | 2026-10-13 | Magpie 定位与版本升级 | 本地项目记忆 `magpie-on-dmit`；本文第 2 节 |
| 远端 cliproxy 与 UI 面板访问 | 2026-10-13 | CLIProxy API 与 CPA Manager Plus 面板入口 | [Step 12](playbook/12-dmit-bom-migration.md) 第 5.7 节 |

## 2. 结论与证据

| 结论 | 证据 | 落到哪 |
|---|---|---|
| Claude 隔离环境、Magpie 主网关和 new-api 已迁至 DMIT，DMIT 是当前唯一承载模型服务的机器 | 迁移后端到端调用返回 `ok`；隔离命名空间出口为 48.46.113.162 / US | [Step 12](playbook/12-dmit-bom-migration.md) 第 1、2 节 |
| RAK 上旧的 Magpie、new-api、Claude 订阅网关和浏览器桌面已停用并关闭自启，容器重启策略改为 `no`，避免与 DMIT 上的同一账号争抢凭据刷新；RAK 的 Hysteria2、Xray、Nginx 保留运行 | 停服后核验：旧账号进程已退出，RAK 的 Hysteria2、Xray、Nginx PID 未变，DMIT 的 Magpie 仍为 `healthy` | HANDOFF 第 2 节；[Step 12](playbook/12-dmit-bom-migration.md) 第 5 节 |
| RAK 云盘 I/O 故障没有根治，故障点在存储侧 | 控制台反复出现 `I/O error, dev vda`、`XFS (vda3): metadata I/O error`、`containerd.service: Failed to spawn executor: Input/output error`；普通重启和两次硬重启都没有恢复，重启后 XFS 日志恢复完成且短期无新错误，但仍无法区分是云盘、宿主机存储还是文件系统本身 | [Step 12](playbook/12-dmit-bom-migration.md) 第 5 节；故障原始记录留在 `out/rak-disk-incident-20261102.md` |
| DMIT 重启后有两处开机缺陷会导致服务不自动恢复 | Nginx 启动时 Tailscale 和 Docker 网桥地址尚未就绪，绑定失败，站点返回 521；隔离网关使用的 `/run/iso-gateway` 目录重启后消失 | [Step 12](playbook/12-dmit-bom-migration.md) 第 5 节 |
| DMIT 根盘占用从 89% 降到 59%，可用空间从约 2.2GB 增加到 7.8GB | 删除 Antigravity Manager 的容器、镜像、数据目录和对应 Nginx 转发，并从 cli-proxy-api 移除该上游；CPA 用量历史库从约 2.5GB 压到 0.74MB | [Step 12](playbook/12-dmit-bom-migration.md) 第 5 节 |
| CPA Manager Plus 的用量采集已关闭，关闭状态随重启保留 | 复查结果为采集器 `stopped`、配置 `enabled=false`；上游连接配置、27 条价格和 11 个别名都保留。为允许关采集，连接配置从容器环境变量迁入 CPA 自己的加密数据库 | [Step 12](playbook/12-dmit-bom-migration.md) 第 5 节 |
| Telegram 掉线不是 Clash 规则写错，而是策略组把全部 Telegram 流量固定在 RAK 一侧 | Telegram 日志在 16:15 至 16:52 连续约 369 条 `Config Error: No 'Date' header received.`；mihomo 实时连接显示 `91.108.56.109:443` 命中 `GeoIP|telegram`，走向 `RAK-HY2 / RAK / Bulk-Traffic` | [Step 5](playbook/05-subscription-template.md) 第 4 节 |
| 订阅里有两个节点已经失效，另有一个第三方订阅更新连续超时 | `SSH-AUTO` 组中 `SSH-10.10.10.2` 和 `SSH-inceptio-100.69.196.30` 健康检查为 0；某订阅当天 12:55 更新连续三次超时 | [Step 5](playbook/05-subscription-template.md) 第 4 节 |
| DMIT 的管理入口此前没有记入仓库 | 本机 `~/.ssh/config` 里有 `dmit` 别名，指向 Tailscale 地址 100.120.162.88、用户 root | [Step 12](playbook/12-dmit-bom-migration.md) 第 5 节 |
| DMIT 上 CLIProxy API 与 CPA Manager Plus 的面板只监听回环，仓库此前没有记入口 | `127.0.0.1:8317/` 与 `127.0.0.1:8317/management.html` 返回 200，`127.0.0.1:18317/` 返回 200；`/v1/models` 未带密钥返回 401 | [Step 12](playbook/12-dmit-bom-migration.md) 第 5.7 节 |
| 订阅地址从国内直连拉不下来，原因同样是 DMIT 公网 TCP 被封 | 在 DMIT 上抓包：国内出口发来的 SYN 到达、服务器回了 SYN-ACK，但客户端收不到；HTTPS 握手在 ClientHello 之后即断 | [Step 5](playbook/05-subscription-template.md) 第 4.4 节 |
| Magpie 从 v0.1.1180 升到 v0.1.1220 后，发往 Anthropic 的请求若不带 `max_tokens`，输出上限改为模型自身上限，不再固定 16384 | 升级对比与官方发布说明；升级后模型目录仍为 27 个 | 本地项目记忆 `magpie-on-dmit` |
| 客户端从 2026-10-11 起就在拨 RAK 的 8443，而服务端模板一直写 3389 | 2026-10-11 的 mihomo 日志显示 `137.175.65.78:8443` 连接被拒后自行恢复 | 本文第 6 节 |

## 3. 尚未处理的待办

| 事项 | 现状 | 建议动作 | 归属 |
|---|---|---|---|
| RAK 云盘 | 工单 90180815 已提交并追加说明，等待 RAK 存储侧处理；面板的救援系统只有 Windows 镜像，不适用于修复 Ubuntu | 在 RAK 答复前不要向该机写数据，不要执行文件系统修复或重装 | [Step 12](playbook/12-dmit-bom-migration.md) 第 3 节 |
| RAK 的 SSH 策略 | 仍是 `PermitRootLogin yes` 与 `PasswordAuthentication yes`，root 可用密码登录 | 改为仅密钥登录；改动会影响登录方式，需要单独确认 | 本文 |
| Marzban 管理端口 | 62050 监听在 `0.0.0.0`，公网可达，属于原有业务 | 确认前面是否已有鉴权或防火墙规则 | 本文 |
| DMIT 第二个 Claude 账号 | 网页已在隔离浏览器登录，但网关账号数仍为 0，订阅未开通 | 开通订阅后在 `ci-dmit-b` 环境完成 CLI 登录，再作为新的 Remote magpie 上游接入 | [Step 12](playbook/12-dmit-bom-migration.md) 第 3 节 |
| Magpie 双网关路由组 | 两个子网关都已在主网关登记（`claude-pro` 与 `dmit-b`），路由组未创建，也没有真实模型调用验收 | DMIT 账号可用后再建组，先用 `routing=order` 保留 RAK 优先 | [Step 12](playbook/12-dmit-bom-migration.md) 第 3 节 |
| `Bulk-Traffic` 策略组 | 仍是指向 RAK 的 select 组，检测间隔 300 秒 | 改成 fallback 或加自动测速组，让它在 DMIT-HY2 与 RAK-HY2 之间自动选健康节点 | [Step 5](playbook/05-subscription-template.md) 第 4 节 |
| DMIT 磁盘看护 | 用量库已清空且采集已关闭，不会再快速增长；`/root/j/browsers/profiles` 约 587MB，`/root/service-upgrade-backups` 约 984MB | 定期检查根盘占用，备份目录按保留策略清理 | [Step 12](playbook/12-dmit-bom-migration.md) 第 5 节 |
| RAK 上 Claude 用户的全局规则 | 资源约束提示写在 `/home/claude/.claude/CLAUDE.md`，仓库没有备份 | 需要长期保留时补一份副本进仓库 | 本文 |
| RAK 的主机资源约束 | 机器只有 2 核 4GB 内存并与其他业务共用，2026-10-06 出现过内存不足被系统杀进程；已加 4GB swap，`/etc/sysctl.d/60-swap.conf` 写入 `vm.swappiness=10` 与 `vm.vfs_cache_pressure=50` | 补记进 [Step 9](playbook/09-rak-claude-isolated-runtime.md) 的主机约束一节 | 本文 |
| 手机端 Shadowrocket | 2026-10-27 停在空的"添加节点"页面：手机拉不到订阅（新节点不在订阅里），需要先手工导入一个可用节点建立连接，再刷新订阅。导入链接与配置在 Mac 的"下载"文件夹，用完应删除 | 在真机上完成节点导入、连接和联网验证 | [Step 11](playbook/11-unified-subscription.md) |
| RAK-CDN 线路 | 2026-10-27 部署完成时延迟 196/222 ms，之后多轮测速超时，一直没有复测 | 复测该线路；不通时检查 Cloudflare 回源和 RAK 上的 `xray-rak` | [Step 10](playbook/10-independent-nodes.md) |
| 分流归属 | `modelscope.cn` 被归到 `Bulk-Traffic` 走美国出口；`api.factory.ai`、`cloudcode-pa.googleapis.com`、`antigravity-*` 等 AI 工具域名走兜底 Proxy 而非 AI 组 | 确认这两处是否有意为之，需要的话改 [configs/server/custom-clash.yml](configs/server/custom-clash.yml) | [Step 5](playbook/05-subscription-template.md) 第 4 节 |
| 其他设备的配置 | seed-ser 跑的是本机 `~/.config/mihomo/config.yaml`，不会随 Marzban 订阅更新；这台 Mac 曾在 Clash Verge 退出时把内存里的旧空配置写回磁盘，导入的订阅被覆盖 | 每次手动更新后核对配置内容，必要时在程序完全退出后再写文件 | [Step 5](playbook/05-subscription-template.md) 第 4 节 |

## 4. 可复用的核验方法：中转上游到底是不是它声称的模型

排查第三方中转时，返回体里的 `model` 字段不能作为证据，中转方可以随意改写。判断依据要来自响应结构和响应头。

| 判据 | 说明 | 可靠性 |
|---|---|---|
| 消息 id 前缀 | Anthropic 官方接口返回 `msg_` 开头的字符串；网关框架通常返回纯十六进制或带 `base_resp` 这类自有字段 | 高 |
| 响应头 | 官方直连会带 `anthropic-ratelimit-*`、`request-id`、`anthropic-version` 等特征头；中间层通常没有 | 高 |
| 模型列表是否需要密钥 | 未带密钥就能取到完整模型列表，说明列表是静态配置，不是按账号授权 | 中 |
| token 计数对照 | 同一段文本在真品与中转上的 `input_tokens` 是否一致 | 中 |
| 能力探针 | 用 1M 上下文、长程推理等特性区分，会随模型版本变化而失效 | 中 |
| 回答风格 | 只能参考 | 低 |
| `model` 字段 | 中转方可随意改写 | 很低 |

已经用过的一个实例：某个第三方中转的 TLS 证书 CN 为 `capi.aerolink.lat`，只支持 Anthropic Messages 协议，`/v1/chat/completions` 返回 404；请求不存在的模型名时返回 400 并列出全部已配置模型，这属于网关自身的校验逻辑。它返回的消息 id 是 32 位十六进制，并多出 `base_resp` 字段，因此不能据此认为它背后是官方接口。判断上游归属还需要独立可达性证明。

## 5. 边界与未验证项

- 上述结论来自只读检查和服务端日志，不等于每一次模型调用都已验证。下列环节在归档前没有发真实模型请求：DMIT 清理后的 CPA 链路、DMIT 第二个环境、主网关的双上游路由组。
- 出口 IP 是住宅代理供应商给的，供应商可能随时更换出口，仓库中的 IP 只在核对当时有效。
- 住宅代理上游是明文 SOCKS5，供应商和中间节点能看到访问的域名。
- RAK 磁盘故障后恢复的只是系统和磁盘访问，不等于原数据库可用：RAK 上的旧 new-api 数据库报 `database disk image is malformed`，取回的副本也没有通过完整性检查，DMIT 上跑的是通过校验的每日备份副本。

## 6. 工作区里尚未提交的改动

归档会话时工作区还有以下改动没有提交，它们的意图在会话记录里没有交代清楚，因此原样保留、没有替它们下结论：

| 文件 | 改动内容 |
|---|---|
| `configs/server/custom-clash.yml`、`configs/server/claude-runtime/rak-bulk-port-ensure`、`configs/server/claude-runtime/rak-bulk-port.service`、`playbook/09-rak-claude-isolated-runtime.md`、`scripts/analyze_24h.py` | 把 RAK 大流量节点 `RAK-Bulk-1T` 的端口从 3389 改成 8443，并在 RAK 上补一条 8443 到 443 的重定向规则，3389 保留兼容 |
| `configs/client/Script.js`、`scripts/render-client-script.js`、`secrets.example.env` | 新增 `INTERNAL_SUBNET_3` 这个内网分流网段 |

需要注意：客户端脚本 `configs/client/Script.js` 已经把 `RAK-Bulk-1T` 列为停用节点并从订阅里清除，服务端模板里的这条节点名只是残留。改端口前应先确认 RAK 上 8443 端口现在由谁提供服务，避免与隔离网关或其它服务冲突。

关于端口改动的来由，2026-10-11 的会话给出了线索：当时 mihomo 日志里拨的已经是 `137.175.65.78:8443`，只是服务端模板和 `rak-bulk-port` 脚本仍写着 3389。也就是说客户端早就按 8443 在用，这个改动是把服务端模板和 NAT 规则对齐到客户端。仍然需要确认的是 RAK 上 8443 现在由谁提供服务——RAK 的 Reality 已经停用，8443 是否还指向一个可用的入口，仓库里没有记录。

## 7. 一并补录的先前交付文件

下面这几个文件也是先前会话做出但一直没提交的内容，本次一并入库，状态如实标注：

| 文件 | 内容 | 状态 |
|---|---|---|
| [Step 11 统一订阅](playbook/11-unified-subscription.md)、`scripts/render-portable-subscription.js`、`configs/server/portable-clash.json` | 从本机 `secrets.env` 和客户端脚本生成统一订阅配置，下发 DMIT-HY2、RAK-HY2、RAK-CDN 三个节点 | 可用。快照已脱敏，真实凭据只在生成时从 `secrets.env` 读取 |
| [住宅代理接入手册](playbook/residential-proxy-guide.md) | 服务器接入住宅 SOCKS5 代理、验证出口和排障 | 可用。地址和凭据均为占位符 |
| `configs/server/isolated-instances/` | 第二套隔离实例的实验性运行时和说明 | **未完成**，不能直接用于生产：一键创建器、独立服务、登录方式和隔离测试都还没有做，只通过了 Python 语法检查 |
