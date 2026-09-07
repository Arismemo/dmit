# Step 2: 域名证书申请与自动化续期 (SSL Certificate & Domain Setup)

> **目标**：为目标域名申请受信的 TLS 证书，为 Hysteria 2 提供加密凭证，为 Marzban 面板提供 HTTPS 安全管理访问。

---

## 1. 域名解析验证

执行申请前，必须确保域名已在 Cloudflare 或域名提供商处添加 A 记录指向目标 VPS 公网 IP，且 **已关闭代理模式（处于 DNS Only 灰色云朵状态）**。

```bash
# 在操作机核查解析是否已全球生效
RESOLVED_IP=$(dig +short <DOMAIN_NAME> @1.1.1.1 | tail -n1)
echo "域名解析 IP: $RESOLVED_IP | 目标 IP: <SERVER_IP>"

if [ "$RESOLVED_IP" != "<SERVER_IP>" ]; then
  echo "[-] 域名解析不匹配，请等待 DNS 广播或检查 DNS 配置！"
  exit 1
fi
```

---

## 2. 施工执行：安装 Certbot 并签发证书

通过 Certbot Standalone 模式申请 Let's Encrypt 免费证书：

```bash
ssh root@<SERVER_IP> bash -s <<EOF
set -euo pipefail

# 1. 安装 certbot
apt-get update
apt-get install -y certbot

# 2. 临时释放 80 端口（如有进程占用可临时杀掉）
systemctl stop nginx 2>/dev/null || true

# 3. 申请证书 (Standalone 模式)
certbot certonly --standalone \
  --preferred-challenges http \
  --agree-tos \
  --email "${CF_EMAIL}" \
  -d "${DOMAIN_NAME}" \
  --non-interactive

# 4. 确保证书与私钥目录权限正确
chmod -R 755 /etc/letsencrypt/archive
chmod -R 755 /etc/letsencrypt/live
EOF
```

---

## 3. 门禁验证 (Gate Verification)

验证证书文件是否存在且在有效期内：

```bash
ssh root@<SERVER_IP> "
  test -f /etc/letsencrypt/live/<DOMAIN_NAME>/fullchain.pem && \
  test -f /etc/letsencrypt/live/<DOMAIN_NAME>/privkey.pem && \
  openssl x509 -in /etc/letsencrypt/live/<DOMAIN_NAME>/fullchain.pem -noout -dates
"
```

**验收标准**：
- `fullchain.pem` 与 `privkey.pem` 存在。
- `notAfter` 证书过期时间至少在 60 天以上。
