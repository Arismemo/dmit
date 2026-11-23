# Step 14：Marzban 迁移到 PasarGuard

2026-11-23 起，DMIT 上的管理面板由 Marzban 换成 PasarGuard（v5.6.0）。PasarGuard 是 Marzban 的分支，仍在维护，支持一个主控管理多台服务器上的节点，也能管理 Hysteria2 入站。Marzban 自 2025 年 1 月后没有再发布版本。

迁移后客户端不需要任何改动：6 个用户的订阅地址、节点名称、凭据和 Clash 策略组都与迁移前一致。

## 当前部署

| 项目 | 位置与说明 |
|---|---|
| 面板 | 容器 `pasarguard-panel-1`，`/opt/pasarguard/docker-compose.yml`，HTTPS 39721（与 Marzban 相同的地址和证书），管理页在 `/dashboard/`，管理员账号与口令沿用 Marzban |
| 数据 | `/var/lib/pasarguard`（SQLite），由迁移时的 `/var/lib/marzban` 复制而来 |
| 本机节点 | 容器 `pasarguard-node-1`，gRPC 只监听 `127.0.0.1:62070`，API key 在 `/opt/pasarguard/node.env`，证书在 `/var/lib/pg-node/certs` |
| Xray | 承载 Reality 的节点固定为 v25.12.8（`/var/lib/pg-node/xray-v25.12.8/xray`），原因见下文；只有 Hysteria2 与 WebSocket 的节点用镜像自带的 26.x |
| 入站 | DMIT-LA（VLESS Reality，127.0.0.1:9444，由 nginx 443 按 SNI 转入）和 DMIT-CDN（VLESS WebSocket，127.0.0.1:23771），配置与迁移前相同 |
| 订阅模板 | 存在面板数据库里，改模板用 `configs/server/pasarguard/pg-set-clash-template.sh`，写 `templates` 目录下的文件不再生效 |
| 访问日志 | 仍写到 `/var/lib/marzban/xray-access-observe.log`，采样脚本不用改 |

仓库里的部署文件和脚本在 `configs/server/pasarguard/`，DMIT 上的副本在 `/opt/pasarguard/tools/`。

## 全部线路纳入面板（2026-11-23）

迁移当天随后把 AWS、DMIT-HY2、RAK-HY2、RAK-CDN 也换成 PasarGuard 节点，六条线路都由面板统一管理用户、凭据和流量。

| 节点 | 所在机器与部署 | 面板如何连接 | Xray | 承载的入站 |
|---|---|---|---|---|
| DMIT | DMIT `/opt/pasarguard` 的 `node` 服务 | 127.0.0.1:62070 | 固定 v25.12.8 | DMIT-LA、DMIT-CDN |
| DMIT-HY2 | DMIT `/opt/pasarguard` 的 `node-hy2` 服务，数据在 `/var/lib/pg-node-hy2` | 127.0.0.1:62071 | 镜像自带 v26.10.31 | DMIT-HY2（UDP 443，Let's Encrypt 证书，拒绝不匹配的 SNI） |
| AWS-US-Clean | AWS `/opt/pasarguard-node` | DMIT 的 `marzban-aws-tunnel`：DMIT 62060 转 AWS 127.0.0.1:62050 | 固定 v25.12.8 | AWS-US-Clean（Reality，对外 443，沿用 9 月以来的密钥、short-id 和伪装目标） |
| RAK | RAK `/opt/pasarguard-node` | Tailscale 100.95.87.62:62072 | 镜像自带 v26.10.31 | RAK-HY2（UDP 443，原自签证书，伪装成 bing）、RAK-CDN（127.0.0.1:24207） |

几处安排的原因：

- **两个 DMIT 节点。** Reality 必须用 Xray 25，Hysteria2 入站又要 Xray 26，一个节点只能跑一个版本，所以 DMIT 分成两个节点。RAK 没有 Reality，直接用 Xray 26。
- **共享凭据用户。** Mac 的 `Script.js` 和统一订阅模板仍下发 DMIT-HY2、RAK-HY2、RAK-CDN 的共享凭据。面板里建了 `shared-dmit`（DMIT-HY2 口令）和 `shared-rak`（RAK-HY2 口令、RAK-CDN 的 UUID）两个用户，凭据就是原来的共享值，所以这些配置不用改，流量也计入面板。6 个原有用户在 `group1` 里，可以用各自的凭据走全部六条线路。
- **手机订阅。** 现在直接下发面板里 liukun 的六条按用户凭据线路。`shared-links.txt` 只补面板没有的线路，同名时以面板为准。
- **RAK 的访问控制。** 原 hysteria-rak 的 ACL 和 xray-rak 的路由规则合并成一条 Xray 路由规则，拒绝本机回环、本机公网 IP、内网、Tailscale 网段和国内地址。2026-11-23 实测，经 RAK-HY2 与 RAK-CDN 访问 RAK 的 SSH、Tailscale 管理端口、Claude 网关、本机公网 IP、内网和国内网站都不可达。
- **规则库。** 四个节点都用 `XRAY_ASSETS_PATH` 指向迁移前的 geoip/geosite：DMIT、AWS 用 Marzban 镜像里的文件，RAK 用原 xray-rak 的文件。节点镜像自带的规则库把 gstatic 等能在国内直连的 Google 域名归入 `geosite:cn`，RAK 的“拦截国内”规则会因此挡掉客户端的健康检查。
- **证书续期。** 续期钩子由 `restart-marzban.sh` 换成 `restart-pasarguard.sh`，续期后重启面板和 `node-hy2`。原钩子在迁移后已经失效，面板不会加载新证书。
- **原服务保留。** DMIT 的 `hysteria-server`、RAK 的 `hysteria-rak` 和 `xray-rak`、AWS 的 `marzban-node` 都已停用，但没有删除，用于回滚。

部署文件和脚本在 `configs/server/pasarguard/`：节点 compose（`node-compose-aws.yml`、`node-compose-rak.yml`），面板设置（`build-lines-spec.py` 生成配置说明，`pg-setup-lines.py` 写入核心配置、主机、分组和共享用户），`pg-node-upsert.py` 登记节点，`cutover-dmit-hy2.sh` 切换 DMIT-HY2。

## 迁移中遇到的问题

1. **核心配置没有导入。** PasarGuard 的迁移脚本 `4e66033a2b9b` 调用 `XRayConfig` 时传的是列表，新版代码需要集合，报错后退回默认的 Shadowsocks 配置，所有从 Marzban 迁来的部署都会这样。`pg-import-core.py` 在迁移后把原来的 `xray_config.json` 写回 1 号核心配置。
2. **Vision 流控丢失。** Marzban 按用户保存 `flow`，PasarGuard 改为读取入站的 `settings.flow`。`pg-import-core.py` 给 Reality 入站补上 `xtls-rprx-vision`，节点会用它覆盖每个用户的流控。
3. **主机地址变了。** DMIT-LA 主机地址原来是占位符 `{SERVER_IP}`，PasarGuard 解析结果不同，已改成固定 IP。
4. **Xray 26 的 Reality 拒绝旧客户端。** 节点镜像自带 Xray 26.10.31，用它时 mihomo 1.19.33 默认配置报 `REALITY authentication failed`，打开 `support-x25519mlkem768` 才能连上；官方 Xray 客户端正常。为了不改任何客户端，节点改用 Xray v25.12.8，mihomo 默认配置恢复正常。面板里的“更新核心”按钮依赖另装的节点服务管理程序，Docker 部署下不可用，换版本要改 compose 里的 `XRAY_EXECUTABLE_PATH`。
5. **旧节点记录不能只改一个字段。** Marzban 时代的节点记录没有 API key，只提交 `status` 等单个字段会被整条校验拒绝。带上地址、证书、API key 等完整字段更新就能通过，AWS 那条记录就是这样复用的。已停用的 RAK-Bulk-1T 记录已删除。
6. **面板会检查证书文件。** 建核心配置时，面板在自己所在的机器上检查 `certificateFile` 路径。RAK 的证书不在 DMIT，所以 RAK 核心配置直接内嵌证书内容。
7. **规则库分类不同。** 见上一节“规则库”，表现为 RAK 两条线路在 gstatic 上超时，google.com 却正常。

## 验收记录（2026-11-23）

| 检查 | 结果 |
|---|---|
| 6 个用户 × 3 种客户端格式的订阅 | 全部 HTTP 200；与迁移前相比，只多了 `encryption=none`、少了空的 path/host 参数和 `ip-version: dual`，节点、凭据、策略组不变 |
| DMIT-LA（mihomo，默认配置） | 204，0.53s |
| DMIT-CDN、DMIT-HY2、RAK-CDN | 均 204，下载 4 到 5 MB/s |
| 手机订阅定时器 | 发布 2 个面板节点和 3 个共享节点 |
| 管理员登录、管理页 | 200 |
| 本机 Claude 请求 | 经线路选择 → DMIT → DMIT-LA，出口洛杉矶 |
| 内存 | 面板约 285MB，节点约 46MB，整机可用约 690MB |
| 六条线路（Mac 现有配置，共享凭据与 liukun 的 UUID） | 延迟 111 到 177ms；DMIT-HY2 下载 4.0MB/s，RAK-HY2 6.3MB/s，RAK-CDN 5.5MB/s；AWS 出口 18.188.x.x，grok.com 200 |
| 六条线路（手机订阅里 liukun 的按用户凭据） | 全部通过健康检查 |
| 错误口令、错误 SNI、错误证书指纹 | DMIT-HY2 与 RAK-HY2 均拒绝 |
| 其他用户的 Clash 订阅 | 节点和分组与迁移前相同 |
| 流量统计 | 四个节点与 shared-dmit、shared-rak 均有计数 |

## 回滚

`/var/lib/marzban` 和 `/opt/marzban` 迁移时没有改动，迁移前的备份在 `/root/backups/marzban-pre-pasarguard-*` 和 `/root/backups/marzban-final-*.sqlite3`。

回滚前先把本机 Clash 的“线路选择”切到 RAK（见铁律 1），然后在 DMIT 上执行：

```bash
cd /opt/pasarguard && docker compose down
```

```bash
cd /opt/marzban && docker compose up -d
```

单条线路回滚：

| 线路 | 回滚 |
|---|---|
| DMIT-HY2 | DMIT 上 `cd /opt/pasarguard && docker compose rm -sf node-hy2`，再 `systemctl enable --now hysteria-server` |
| RAK | RAK 上 `cd /opt/pasarguard-node && docker compose down`，再 `systemctl enable --now hysteria-rak xray-rak` |
| AWS | AWS 上 `cd /opt/pasarguard-node && sudo docker compose down`，再 `sudo docker update --restart=always marzban-node && sudo docker start marzban-node` |

迁移后在 PasarGuard 里新增的用户和用量不会带回 Marzban。`/usr/local/bin/marzban` 命令行还在，不要在 PasarGuard 运行时用它启动 Marzban，两者会争用 39721、9444 和 23771 端口。

## 日常操作

| 要做的事 | 做法 |
|---|---|
| 加用户、看流量、停用户 | 管理页 `https://<DOMAIN_NAME>:39721/dashboard/` |
| 改统一订阅模板 | 本机 `node scripts/render-portable-subscription.js <仓库外路径>` 生成模板，传到 DMIT 后运行 `/opt/pasarguard/tools/pg-set-clash-template.sh <模板文件>` |
| 调用管理接口 | `docker cp /opt/pasarguard/tools/pg-api.py pasarguard-panel-1:/tmp/`，再 `docker exec pasarguard-panel-1 python /tmp/pg-api.py GET /nodes` |
| 升级面板或节点 | 改 compose 里的镜像版本，先在本机用数据库副本演练，再 `docker compose up -d`；升级 Xray 前确认新版 Reality 对 mihomo 默认配置和手机客户端仍可用 |
