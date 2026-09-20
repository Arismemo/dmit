# Step 7: 多节点集群纳管与智能泄洪容灾架构 (Multi-Node Cluster & Traffic Offloading)

> **目标**：将外部独立 VPS（RAKsmart 1000G 泄洪节点、AWS 纯净容灾节点）通过反向安全加密隧道纳管至 DMIT Marzban 控制中心，实现统一鉴权、同屏流量监控、大流量智能泄洪与高风控 AI 专线分流。

---

## 1. 集群拓扑与角色定位

| 节点标识 | 节点角色 | 服务器规格与位置 | 核心协议与端口 | 职责定位与分流策略 |
| :--- | :--- | :--- | :--- | :--- |
| **Master (DMIT-LA)** | 主控 & 极速专线 | 美国洛杉矶 CN2 GIA/CMIN2 | TCP 443 (VLESS Reality)<br>UDP 443 (Hysteria 2) | 核心业务通道，承载 Cursor、Claude、ChatGPT、日常浏览（超低延迟） |
| **Node 1 (RAK-Bulk-1T)** | 1000G 大流量泄洪 | 美国加州普通机房 (137.175.65.78) | TCP 3389 (VLESS Reality) | 承载 Telegram、YouTube、Docker、HF 模型、OS 镜像等 91 条高吞吐白名单 |
| **Node 2 (AWS-US-Clean)** | 纯净出口 & 应急容灾 | AWS 俄亥俄 (18.188.243.223) | TCP 443 (VLESS Reality) | 原生纯净住宅/云端出口，专用于 Grok/xAI 解锁（规避 Cloudflare 403 阻断）与容灾 |

---

## 2. 节点安全纳管核心机制

### 2.1 本地回环安全隧道 (SSH Reverse/Forward Tunnel)
为了避免暴露 Marzban 节点的底层通信端口（62050/62051）到公网，DMIT 主控采用 SSH 本地端口映射隧道连接远端节点：
- **RAKsmart 隧道**：`marzban-node-tunnel.service` 将远端 `62050/62051` 映射到主控 `127.0.0.1:62050 / 62051`。
- **AWS 隧道**：`marzban-aws-tunnel.service` 将远端 `62050/62051` 映射到主控 `127.0.0.1:62060 / 62061`。

### 2.2 证书与配置下发流水线
1. **主控生成节点**：在 Marzban 数据库中登记节点，获取节点证书（TLS Client Cert）。
2. **节点证书部署**：将主控根证书与节点客户端证书同步至远端节点的 `/var/lib/marzban-node/` 目录。
3. **节点服务启动**：远端运行 `gozargah/marzban-node:latest`（`network_mode: host`）。
4. **统一凭证**：所有节点共享主控下发的统一用户 UUID 与 Reality 密钥对，客户端零感知切换。

---

## 3. 施工执行指南

### 3.1 远端节点部署命令 (以 AWS 为例)
```bash
# 1. 宿主机准备目录
sudo mkdir -p /var/lib/marzban-node

# 2. 从主控同步证书至远端
# ssl_client_cert.pem (由主控生成) 放入 /var/lib/marzban-node/

# 3. 启动 Marzban Node 容器
sudo docker run -d \
  --name marzban-node \
  --restart always \
  --network host \
  -v /var/lib/marzban-node:/var/lib/marzban-node \
  gozargah/marzban-node:latest
```

### 3.2 主控隧道配置 (Systemd 服务)
在 DMIT 主控创建 `/etc/systemd/system/marzban-aws-tunnel.service`：
```ini
[Unit]
Description=Marzban AWS Node SSH Tunnel
After=network.target

[Service]
Type=simple
User=root
ExecStart=/usr/bin/ssh -NT -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -o ExitOnForwardFailure=yes -L 127.0.0.1:62060:127.0.0.1:62050 -L 127.0.0.1:62061:127.0.0.1:62051 -i /root/.ssh/id_rsa -o StrictHostKeyChecking=no ubuntu@18.188.243.223
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```
启用并启动：
```bash
systemctl daemon-reload
systemctl enable --now marzban-aws-tunnel
```

### 3.3 主控节点注册与重连
通过 Marzban API 或数据库注册 Node 2 并触发握手：
```bash
curl -k -X POST https://127.0.0.1:39721/api/node/2/reconnect -H "Authorization: Bearer <TOKEN>"
```

---

## 4. 门禁验证与流量审计

1. **节点连接状态核查**：
   调用 `GET /api/nodes`，确认所有节点 `status` 均为 `connected`。
2. **三机同屏流量大屏**：
   调用 `GET /api/nodes/usage`，核查三大节点上行/下行字节数均能实时采集入库：
   ```json
   {
     "usages": [
       {"node_name": "Master", "uplink": 123003304003, "downlink": 236145805418},
       {"node_name": "RAK-Bulk-1T", "uplink": 956991, "downlink": 23773517},
       {"node_name": "AWS-US-Clean", "uplink": 1337, "downlink": 617499}
     ]
   }
   ```
3. **端到端业务分流测试**：
   - 测试 Grok/xAI 访问命中 AWS 出口，返回 HTTP 200（解除 Cloudflare 403 阻断）。
   - 测试 Telegram/YouTube 媒体流命中 RAKsmart 1000G 出口。
   - 测试 Cursor/Claude 稳居 DMIT 极速出口。
