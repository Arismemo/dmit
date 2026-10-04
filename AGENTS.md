# AGENTS.md - 海外极速网络节点自动化施工指南

> 本文件是专为 AI Coding Agent（如 Claude Code, Antigravity, OpenClaw, Cursor 等）编写的高权限施工规范。
> 当用户向你提供一台全新的海外 VPS（IP 与 SSH 凭证）并发出指令时，你必须严格遵循本文档及 `playbook/` 系列剧本执行施工。

---

## 1. 核心目标与交付物

在目标 Ubuntu 22.04/24.04 VPS 上，以无人值守或半自动化方式完成整套高性能、低延迟、抗封锁的网络代理中继平台部署：
1. **系统内核层**：启用 BBR 拥塞控制 + FQ 队列调度 + TCP Fast Open (TFO) + 16MB 高速网络套接字缓冲区。
2. **协议传输层**：
   - **主协议**：Xray VLESS + XTLS-Reality (TCP 443)，具备最低握手开销与极高防封锁伪装。
   - **加速协议**：Hysteria 2 (UDP 443)，基于 QUIC 协议，针对弱网与丢包链路进行暴力拥塞控制补齐。
3. **节点管控层**：Marzban 容器化控制面板，统一管理用户、流量额度与 Reality 密钥。
4. **安全防线层**：服务端黑洞路由（Block 规则），严禁 BT/PT 种子下载、国内流量回环倒流与恶意挖矿，保障 VPS IP 声誉。
5. **客户端订阅**：动态 Jinja2 订阅模板，下发 Fake-IP、国内直连 DNS、双协议 Auto 自动测速选优与 AI 专用分流组。

---

## 2. AI 施工最高准则 (Supreme Directives)

### 铁律 1：防自断通信 (Self-Preservation Rule)
- **背景**：如果在执行后期修改配置时，你当前对话使用的正是这台 VPS 上的代理，若执行了 `systemctl restart`、关闭了 443 端口或重启了容器，**你的当前 Session 会瞬间断开并丢失会话**！
- **执行标准**：
  - 在修改监听 443 端口的服务时，优先使用平滑重载（Reload / HUP 信号）或非破坏性更新。
  - 如必须重启，务必向用户预警，或通过后台脚本延迟 2 秒执行，确保命令已返回。

### 铁律 2：幂等性 (Idempotency)
- 脚本与命令必须能够重复执行而不破坏现有状态。
- 在写入配置前，先检查目标文件是否存在、配置项是否已包含，避免向同一文件多次追加相同内容。

### 铁律 3：凭证绝不外泄 (Zero-Leakage)
- 真实私钥、UUID、密码、域名严禁 commit 到 Git 仓库。
- 施工前必须引导用户复制 `secrets.example.env` 为 `secrets.env` 并填入真实值，所有脚本必须从 `secrets.env` 读取环境变量。

### 铁律 4：验证驱动交付 (Verification-Driven)
- 每一阶段必须具备客观验收测试（例如 `sysctl -n` 读出 `bbr`、`curl` 返回 `200`、UDP 端口监听生效等）。
- 禁止“假设成功”，未见成功返回不得进入下一步。

---

## 3. 标准施工流水线 (Execution Pipeline)

AI 必须按序执行 `playbook/` 下的各阶段剧本：

| 阶段编号 | 剧本文件 | 施工内容 | 门禁检验指标 |
| :--- | :--- | :--- | :--- |
| **Step 0** | [`playbook/00-precheck.md`](file:///Users/liukun/j/dmit/playbook/00-precheck.md) | 环境探测、端口排查、装填 `secrets.env` | SSH 连通，443/80 端口空闲，变量就绪 |
| **Step 1** | [`playbook/01-system-tune.md`](file:///Users/liukun/j/dmit/playbook/01-system-tune.md) | 部署 `sysctl` 网络调优参数 | `bbr` 与 `tcp_fastopen=3` 生效 |
| **Step 2** | [`playbook/02-cert-and-domain.md`](file:///Users/liukun/j/dmit/playbook/02-cert-and-domain.md) | 域名解析验证与 Let's Encrypt 证书签发 | 生成有效的 `fullchain.pem` 与 `privkey.pem` |
| **Step 3** | [`playbook/03-xray-marzban.md`](file:///Users/liukun/j/dmit/playbook/03-xray-marzban.md) | 安装 Docker、部署 Marzban、写入黑洞路由与 Reality | 容器 Healthy，TCP 443 端口监听中 |
| **Step 4** | [`playbook/04-hysteria2.md`](file:///Users/liukun/j/dmit/playbook/04-hysteria2.md) | 部署 Hysteria 2 服务端 (UDP 443) | `systemctl is-active hysteria-server` 为 active |
| **Step 5** | [`playbook/05-subscription-template.md`](file:///Users/liukun/j/dmit/playbook/05-subscription-template.md) | 写入 Clash 订阅模板，生成管理用户与订阅链接 | 端到端拉取订阅 HTTP 200，且 YAML 解析合法 |
| **Step 6** | [`playbook/06-client-and-verify.md`](file:///Users/liukun/j/dmit/playbook/06-client-and-verify.md) | 客户端 TUN Mixed 检查、首包延迟压测、黑洞防护验证 | Google/Claude 连通延迟 < 500ms，国内 IP 被黑洞拦截 |
| **Step 7** | [`playbook/07-multi-node-cluster.md`](file:///Users/liukun/j/dmit/playbook/07-multi-node-cluster.md) | 多节点集群纳管、安全隧道映射与智能泄洪容灾 | 所有 Node 状态 connected，三机同屏流量实时入库 |
| **Step 8** | [`playbook/08-rak-claude-residential-proxy.md`](file:///Users/liukun/j/dmit/playbook/08-rak-claude-residential-proxy.md) | RAK 节点 Claude Code 家宽代理网桥与零泄漏防封防护体系 | 本地网桥 active，出口锁定 Comcast 纽约家宽，Anthropic 握手 200/404 |

---

## 4. 故障自愈与异常处理 (Troubleshooting Runbook)

### 1. Marzban 订阅解析抛出 `yaml: line xx: did not find expected key`
- **根本原因**：官方 Jinja2 模板 `{{ conf | yaml }}` 默认输出了 `rules:`，若在其后直接追加 proxy 节点会导致语法缩进崩溃。
- **自愈方案**：严格使用 `configs/server/custom-clash.yml` 提供的过滤器：`{{ conf | except("proxy-groups", ..., "rules") | yaml | trim }}`。

### 2. Xray 与 Hysteria 端口冲突
- **机制理解**：Xray VLESS 监听 **TCP 443**，Hysteria 2 监听 **UDP 443**。二者传输层协议不同，完全可以共存。
- **排查**：若报错 `address already in use`，检查是否有 Nginx/Caddy 同时占用了 UDP 443（QUIC/HTTP3）或重复启动。

### 3. Vision 协议无法握手
- **排查**：严禁在 `xtls-rprx-vision` 上启用 `mux`（多路复用）。确保客户端配置中没有 `mux: true`。

---

## 5. 一句话指令调用示例

向 AI 发送以下指令即可全自动开工：
> “请按照 `AGENTS.md` 和 `playbook/` 剧本，使用当前环境中的 `secrets.env` 配置，将目标服务器 `root@<IP>` 完整施工交付，并在完成每个 Step 后汇报验证输出。”
