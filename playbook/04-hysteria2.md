# Step 4: Hysteria 2 极速传输协议部署 (Hysteria 2 UDP 443 Setup)

> **目标**：在服务器部署 Hysteria 2 守护进程，监听 UDP 443 端口，与 Xray TCP 443 形成双栈加速架构。

---

## 1. 协议优势与互补策略

- **协议特性**：Hysteria 2 基于定制的 QUIC 协议，针对恶劣跨境网络环境（存在 5%~20% 丢包）提供主动拥塞控制，在高峰期带宽几乎不受丢包影响。
- **与 TCP 443 共存机制**：
  - Linux 网络栈中，TCP 443 (Xray) 与 UDP 443 (Hysteria 2) 属于不同传输层协议，占用独立套接字，完全无端口冲突。
  - 客户端通过策略组同时包含这两个节点，遇到 TCP 阻断或限速时自动无缝秒级切换。

---

## 2. 施工执行

### 2.1 安装 Hysteria 2 官方二进制
```bash
ssh root@<SERVER_IP> bash -s <<'EOF'
set -euo pipefail
# 使用官方脚本安装/更新二进制
bash <(curl -fsSL https://get.hy2.sh/)
EOF
```

### 2.2 渲染并部署配置文件
```bash
cat configs/server/hysteria2.yaml | \
  sed "s/<DOMAIN_NAME>/${DOMAIN_NAME}/g" | \
  sed "s/<HY2_PASSWORD>/${HY2_PASSWORD}/g" | \
  ssh root@<SERVER_IP> "mkdir -p /etc/hysteria && cat > /etc/hysteria/config.yaml"
```

### 2.3 启动并配置自启
```bash
ssh root@<SERVER_IP> bash -s <<'EOF'
set -euo pipefail
systemctl daemon-reload
systemctl enable --now hysteria-server.service
EOF
```

---

## 3. 门禁验证 (Gate Verification)

```bash
ssh root@<SERVER_IP> "
  systemctl status hysteria-server.service --no-pager && \
  ss -ulpn | grep :443
"
```

**验收标准**：
- `hysteria-server.service` 为 `active (running)`。
- UDP 443 端口正处于监听状态，进程名称为 `hysteria`。
