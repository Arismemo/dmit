# Step 5: Clash 订阅模板注入与下发 (Subscription Template & User Management)

> **目标**：将调优好的 Clash 订阅模板持久化至 Marzban，将 Hysteria 2、Auto 选优组及精细分流规则无缝嵌入到客户端订阅中。

---

## 1. 订阅模板架构与防踩坑经验

- **模板位置**：`/var/lib/marzban/templates/clash/custom.yml`。
- **关键设计**：
  - 默认情况下 Marzban 会使用 Jinja2 渲染默认的节点和系统规则。如果直接追加代理，会导致 PyYAML 反序列化异常。
  - 模板中采用 `{{ conf | except(..., "rules") | yaml | trim }}` 剔除原有规则，先追加静态 `DMIT-HY2` 节点，再定义 `Proxy`、`Auto`、`AI` 等策略组，最后追加完整的国内直连与安全分流白名单。

---

## 2. 施工执行

### 2.1 渲染并上传模板
```bash
cat configs/server/custom-clash.yml | \
  sed "s/<SERVER_IP>/${SERVER_IP}/g" | \
  sed "s/<HY2_PASSWORD>/${HY2_PASSWORD}/g" | \
  sed "s/<DOMAIN_NAME>/${DOMAIN_NAME}/g" | \
  sed "s/<PRIVATE_GITLAB_DOMAIN>/${PRIVATE_GITLAB_DOMAIN:-gitlab.example.com}/g" | \
  ssh root@<SERVER_IP> "mkdir -p /var/lib/marzban/templates/clash && cat > /var/lib/marzban/templates/clash/custom.yml"
```

### 2.2 创建分发用户（如用户尚未创建）
```bash
ssh root@<SERVER_IP> bash -s <<'EOF'
set -euo pipefail
# 创建一个名为 "primary_user" 的测试用户（已存在则忽略）
docker exec marzban-marzban-1 marzban-cli user create --username primary_user || true
EOF
```

### 2.3 获取用户订阅 Token 与订阅 URL
```bash
# 提取订阅链接
SUB_URL=$(ssh root@<SERVER_IP> "docker exec marzban-marzban-1 marzban-cli user get primary_user" | grep -i "subscription_url" | awk '{print $2}')
echo "用户订阅地址: $SUB_URL"
```

---

## 3. 门禁验证 (Gate Verification)

在本地或操作机，端到端测试该订阅的 Clash 配置拉取与 YAML 反序列化：

```bash
# 1. 模拟 Clash 客户端 User-Agent 发起订阅请求
SUB_CONTENT=$(curl -sSL -H "User-Agent: ClashVerge/v2.0" "$SUB_URL")

# 2. 检查响应是否包含节点
echo "$SUB_CONTENT" | grep -q "DMIT-HY2" && echo "[+] 包含 HY2 节点"
echo "$SUB_CONTENT" | grep -q "Auto" && echo "[+] 包含 Auto 测速策略组"
echo "$SUB_CONTENT" | grep -q "rules:" && echo "[+] 包含完整路由规则"

# 3. 本地 Python 严格 YAML 语法解析
python3 -c "
import yaml, sys
data = '''$SUB_CONTENT'''
try:
    obj = yaml.safe_load(data)
    print(f'[+] YAML 反序列化成功！代理数量: {len(obj.get(\"proxies\", []))}, 规则数量: {len(obj.get(\"rules\", []))}')
except Exception as e:
    print(f'[-] YAML 解析报错: {e}')
    sys.exit(1)
"
```

**验收标准**：
- curl 返回 HTTP 状态码 200。
- 订阅内容成功解析为合法 YAML，节点池与规则池正常输出。
