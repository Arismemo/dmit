# Step 14：Marzban 迁移到 PasarGuard

2026-11-23 起，DMIT 上的管理面板由 Marzban 换成 PasarGuard（v5.6.0）。PasarGuard 是 Marzban 的分支，仍在维护，支持一个主控管理多台服务器上的节点，也能管理 Hysteria2 入站。Marzban 自 2025 年 1 月后没有再发布版本。

迁移后客户端不需要任何改动：6 个用户的订阅地址、节点名称、凭据和 Clash 策略组都与迁移前一致。

## 当前部署

| 项目 | 位置与说明 |
|---|---|
| 面板 | 容器 `pasarguard-panel-1`，`/opt/pasarguard/docker-compose.yml`，HTTPS 39721（与 Marzban 相同的地址和证书），管理页在 `/dashboard/`，管理员账号与口令沿用 Marzban |
| 数据 | `/var/lib/pasarguard`（SQLite），由迁移时的 `/var/lib/marzban` 复制而来 |
| 本机节点 | 容器 `pasarguard-node-1`，gRPC 只监听 `127.0.0.1:62070`，API key 在 `/opt/pasarguard/node.env`，证书在 `/var/lib/pg-node/certs` |
| Xray | 固定为 v25.12.8（`/var/lib/pg-node/xray-v25.12.8/xray`），原因见下文 |
| 入站 | DMIT-LA（VLESS Reality，127.0.0.1:9444，由 nginx 443 按 SNI 转入）和 DMIT-CDN（VLESS WebSocket，127.0.0.1:23771），配置与迁移前相同 |
| 订阅模板 | 存在面板数据库里，改模板用 `configs/server/pasarguard/pg-set-clash-template.sh`，写 `templates` 目录下的文件不再生效 |
| 访问日志 | 仍写到 `/var/lib/marzban/xray-access-observe.log`，采样脚本不用改 |

仓库里的部署文件和脚本在 `configs/server/pasarguard/`，DMIT 上的副本在 `/opt/pasarguard/tools/`。

## 没有纳入面板的部分

| 线路 | 现状 | 原因 |
|---|---|---|
| DMIT-HY2、RAK-HY2 | 仍是独立的 hysteria 服务，共享口令 | Xray 25.12.8 不支持 Hysteria2 入站；要纳入面板需要另起一个跑 Xray 26 的节点，同时改 Mac 脚本、统一订阅和手机订阅里共享节点的下发方式 |
| RAK-CDN | 仍由 RAK 独立运行 | RAK 是共享业务节点，节点程序要用宿主网络运行，影响面较大 |
| AWS-US-Clean | AWS 上仍是旧的 marzban-node，按 9 月的配置运行，面板里的旧节点记录处于 error 状态 | 旧节点程序与 PasarGuard 协议不兼容；从境外访问正常（2026-11-23 实测 249ms）。要纳入面板需要在 AWS 上换装 PasarGuard 节点并为它单独建一份核心配置（AWS 需要对外监听 443，不能沿用 DMIT 的回环地址） |

`scripts/analyze_24h.py` 等分析脚本读的是 `/var/lib/marzban/db.sqlite3`，迁移后那里的数据停在 2026-11-23，不再更新。

## 迁移中遇到的问题

1. **核心配置没有导入。** PasarGuard 的迁移脚本 `4e66033a2b9b` 调用 `XRayConfig` 时传的是列表，新版代码需要集合，报错后退回默认的 Shadowsocks 配置，所有从 Marzban 迁来的部署都会这样。`pg-import-core.py` 在迁移后把原来的 `xray_config.json` 写回 1 号核心配置。
2. **Vision 流控丢失。** Marzban 按用户保存 `flow`，PasarGuard 改为读取入站的 `settings.flow`。`pg-import-core.py` 给 Reality 入站补上 `xtls-rprx-vision`，节点会用它覆盖每个用户的流控。
3. **主机地址变了。** DMIT-LA 主机地址原来是占位符 `{SERVER_IP}`，PasarGuard 解析结果不同，已改成固定 IP。
4. **Xray 26 的 Reality 拒绝旧客户端。** 节点镜像自带 Xray 26.10.31，用它时 mihomo 1.19.33 默认配置报 `REALITY authentication failed`，打开 `support-x25519mlkem768` 才能连上；官方 Xray 客户端正常。为了不改任何客户端，节点改用 Xray v25.12.8，mihomo 默认配置恢复正常。面板里的“更新核心”按钮依赖另装的节点服务管理程序，Docker 部署下不可用，换版本要改 compose 里的 `XRAY_EXECUTABLE_PATH`。
5. **旧节点记录改不了。** Marzban 时代的节点记录没有 API key，修改时整条记录会被校验拒绝，所以 AWS 和 RAK-Bulk-1T 两条记录保持原样。

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

## 回滚

`/var/lib/marzban` 和 `/opt/marzban` 迁移时没有改动，迁移前的备份在 `/root/backups/marzban-pre-pasarguard-*` 和 `/root/backups/marzban-final-*.sqlite3`。

回滚前先把本机 Clash 的“线路选择”切到 RAK（见铁律 1），然后在 DMIT 上执行：

```bash
cd /opt/pasarguard && docker compose down
```

```bash
cd /opt/marzban && docker compose up -d
```

迁移后在 PasarGuard 里新增的用户和用量不会带回 Marzban。`/usr/local/bin/marzban` 命令行还在，不要在 PasarGuard 运行时用它启动 Marzban，两者会争用 39721、9444 和 23771 端口。

## 日常操作

| 要做的事 | 做法 |
|---|---|
| 加用户、看流量、停用户 | 管理页 `https://<DOMAIN_NAME>:39721/dashboard/` |
| 改统一订阅模板 | 本机 `node scripts/render-portable-subscription.js <仓库外路径>` 生成模板，传到 DMIT 后运行 `/opt/pasarguard/tools/pg-set-clash-template.sh <模板文件>` |
| 调用管理接口 | `docker cp /opt/pasarguard/tools/pg-api.py pasarguard-panel-1:/tmp/`，再 `docker exec pasarguard-panel-1 python /tmp/pg-api.py GET /nodes` |
| 升级面板或节点 | 改 compose 里的镜像版本，先在本机用数据库副本演练，再 `docker compose up -d`；升级 Xray 前确认新版 Reality 对 mihomo 默认配置和手机客户端仍可用 |
