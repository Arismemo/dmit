# Step 3: Marzban 与 Xray 黑洞路由部署 (Marzban & Xray Production Setup)

> **目标**：以 Docker 容器化方式部署 Marzban 节点管理面板，深度配置 Xray Core，实现 VLESS-Reality 极速伪装协议、TCP Fast Open 以及服务端安全黑洞路由兜底。

---

## 1. 架构与安全黑洞原理

- **Marzban**：采用 `network_mode: host` 部署，避免 Docker 网桥 NAT 带来的额外 1~2ms 转发延迟与 CPU 消耗。
- **Xray Reality**：将 TLS 握手特征伪装为目标合规站点（如 Apple, Microsoft），消除独立证书特征；在 `sockopt` 中开启 `tcpFastOpen: true`。
- **两层安全黑洞 (Blackhole Routing)**：
  - 第一层由客户端订阅规则将国内流量直连或丢弃；
  - 第二层在 VPS 服务端部署最终防御：拦截所有 BT/PT 协议（防版权警告 DMCA）、恶意广告域名、以及国内 IP/域名倒流回环（防止穿透服务器再次请求国内服务器）。

---

## 2. 施工执行

### 2.1 安装 Docker 环境
```bash
ssh root@<SERVER_IP> bash -s <<'EOF'
set -euo pipefail
if ! command -v docker &> /dev/null; then
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker
fi
EOF
```

### 2.2 部署 Marzban 容器与配置
```bash
ssh root@<SERVER_IP> "mkdir -p /opt/marzban /var/lib/marzban/templates/clash"

# 上传 docker-compose.yml
scp configs/server/docker-compose.yml root@<SERVER_IP>:/opt/marzban/docker-compose.yml

# 根据 secrets.env 生成并上传 .env
cat configs/server/marzban.env | \
  sed "s/<DOMAIN_NAME>/${DOMAIN_NAME}/g" | \
  ssh root@<SERVER_IP> "cat > /opt/marzban/.env"

# 启动 Marzban 容器
ssh root@<SERVER_IP> "cd /opt/marzban && docker compose up -d"
```

### 2.3 生成 Reality 密钥对并写入 `xray_config.json`
```bash
ssh root@<SERVER_IP> bash -s <<'EOF'
set -euo pipefail
# 生成 Reality 密钥对
REALITY_OUTPUT=$(docker exec marzban-marzban-1 xray x25519 || xray x25519)
REALITY_PRIV=$(echo "$REALITY_OUTPUT" | grep -i "Private key:" | awk '{print $3}')
REALITY_PUB=$(echo "$REALITY_OUTPUT" | grep -i "Public key:" | awk '{print $3}')
REALITY_SHORT_ID=$(openssl rand -hex 8)

echo "Reality Public Key: $REALITY_PUB"
echo "Reality Short ID:   $REALITY_SHORT_ID"

# 保存密钥记录到本地环境备份
echo "REALITY_PRIV=$REALITY_PRIV" >> /opt/marzban/reality_credentials.txt
echo "REALITY_PUB=$REALITY_PUB" >> /opt/marzban/reality_credentials.txt
echo "REALITY_SHORT_ID=$REALITY_SHORT_ID" >> /opt/marzban/reality_credentials.txt
EOF
```

### 2.4 上传生产级 `xray_config.json`（含黑洞路由）
将 `configs/server/xray_config.json` 渲染真实参数后推送至 `/var/lib/marzban/xray_config.json`，并热重载：

```bash
# 替换目标私钥、伪装域名与白名单
REALITY_PRIV=$(ssh root@<SERVER_IP> "grep REALITY_PRIV /opt/marzban/reality_credentials.txt | cut -d= -f2")
REALITY_SHORT_ID=$(ssh root@<SERVER_IP> "grep REALITY_SHORT_ID /opt/marzban/reality_credentials.txt | cut -d= -f2")

cat configs/server/xray_config.json | \
  sed "s/<REALITY_PRIVATE_KEY>/${REALITY_PRIV}/g" | \
  sed "s/<REALITY_SHORT_ID>/${REALITY_SHORT_ID}/g" | \
  sed "s/<REALITY_DEST>/${REALITY_DEST}/g" | \
  sed "s/<REALITY_SNI>/${REALITY_SNI}/g" | \
  sed "s/<PRIVATE_GITLAB_DOMAIN>/${PRIVATE_GITLAB_DOMAIN:-gitlab.example.com}/g" | \
  ssh root@<SERVER_IP> "cat > /var/lib/marzban/xray_config.json"

# 平滑重启生效（Marzban 支持通过 CLI 或重启容器载入配置）
ssh root@<SERVER_IP> "cd /opt/marzban && docker compose restart"
```

### 2.5 创建管理员账号
```bash
ssh root@<SERVER_IP> "docker exec -it marzban-marzban-1 marzban-cli admin create --username ${MARZBAN_USER} --password ${MARZBAN_PASS} --sudo || true"
```

---

## 3. 门禁验证 (Gate Verification)

```bash
ssh root@<SERVER_IP> "
  echo '--- 容器状态 ---' && docker ps | grep marzban && \
  echo '--- 端口监听 ---' && ss -tulpn | grep -E ':(443|8000)\b'
"
```

**验收标准**：
- `marzban-marzban-1` 容器状态为 `Up`。
- TCP 8000 (管理后台) 与 TCP 443 (Xray Inbound) 正处于 `LISTEN` 状态。
