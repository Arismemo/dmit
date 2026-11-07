# Step 14：经 DMIT 中转的家宽节点

更新日期：2026-11-07。

## 1. 作用

两个 Claude 账号各有一条美国家庭宽带出口：RAK 隔离环境用 `48.46.113.162`，DMIT 的第二个隔离环境（ci-dmit-b）用 `48.45.131.171`，两条都是 Comcast。在自己的电脑上给账号续费或登录网页时，最好和账号平时使用同一个家宽 IP。

直连家宽很慢，所以本机 Clash 的家宽节点不直连家宽，而是先走现有的 DMIT-HY2 到 DMIT，再由 DMIT 本机的 `home-egress` 服务转发到家宽：

| 节点 | 链路 | 出口 IP |
|---|---|---|
| HOME-RAK | 本机 → DMIT-HY2 → DMIT `127.0.0.1:17990` → `48.46.113.162:47940` | 48.46.113.162 |
| HOME-DMIT | 本机 → DMIT-HY2 → DMIT `127.0.0.1:17991` → `48.45.131.171:41212` | 48.45.131.171 |

`home-egress` 是独立的 Xray 进程，不改 Marzban、Hysteria、nginx，也不复用两个隔离环境的网桥，停掉它不影响隔离环境里的 Claude。

## 2. 服务端（DMIT）

| 对象 | 路径 |
|---|---|
| 服务 | `home-egress.service`（快照：`configs/server/home-egress/home-egress.service`） |
| 配置（含凭据，0600） | `/etc/home-egress/config.json`（脱敏结构：`configs/server/home-egress/config.example.json`） |
| 客户端入口凭据（0600） | `/etc/home-egress/client.env` |

两个 SOCKS5 入口只监听回环地址并要求用户名密码。路由规则：私网地址拦截；UDP 443 拦截，让浏览器退回 TCP；其余按入口分别转到对应家宽。没有直连出站，家宽不可用时连接直接失败，不会改用 DMIT 自己的 IP。

家宽上游的凭据在部署时从服务器上已有的 `/etc/claude-bridge/config.json` 和 `/etc/residential-dmit-b/config.json` 读取，不经过本机。

## 3. 客户端

节点定义在 `configs/client/Script.js` 的家宽模块里，由 `secrets.env` 的 `HOME_EGRESS_ENABLE` 打开，凭据键为 `HOME_SOCKS_USER`、`HOME_RAK_SOCKS_PASS`、`HOME_DMIT_SOCKS_PASS`。渲染安装：

```bash
node scripts/render-client-script.js
```

安装后在 Clash Verge 里刷新配置。会出现 HOME-RAK、HOME-DMIT 两个节点和“家宽”选择组。它们不进 AI、Proxy 等自动分流组，也不进 Marzban 共用订阅，其他订阅用户拿不到。使用时把 Clash 切到全局模式，选中对应节点，用完切回规则模式。

## 4. 验收

2026-11-07 实测：

- 在 DMIT 上经 17990、17991 访问 ipinfo，出口分别是 48.46.113.162 和 48.45.131.171；不带认证被拒绝；访问私网地址被拦截。
- 在本机用临时 mihomo 实例按同样的链式配置测试，出口分别是两个家宽 IP，首包约 1.0 到 1.4 秒，下载约 3.1 MB/s。
- 停止 `home-egress` 后节点请求直接失败，恢复后正常。

用命令行请求 claude.ai 返回 403，这是 Cloudflare 对非浏览器客户端的拦截，不能据此判断 IP 被封；要以浏览器实际打开为准。

## 5. 已知问题

`residential-dmit-b.service` 的 SOCKS 入口 `127.0.0.1:17891` 没有认证，而 DMIT-HY2 没有配置访问控制规则。按推断，持有 HY2 凭据的人可以经 HY2 连到这个端口，用 B 账号的家宽出网；没有实测。修复需要给 Hysteria 加访问控制规则或给该入口加认证，前者要重启 UDP 443。

## 6. 回滚

```bash
ssh dmit 'systemctl disable --now home-egress.service'
```

本机把 `secrets.env` 里的 `HOME_EGRESS_ENABLE` 改为 `false` 后重新渲染安装即可。
