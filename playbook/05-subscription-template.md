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
  sed "s/<RAK_SERVER_IP>/${RAK_SERVER_IP:-198.51.100.2}/g" | \
  sed "s/<AWS_SERVER_IP>/${AWS_SERVER_IP:-198.51.100.3}/g" | \
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

---

## 4. 已知问题（2026-11-03 排查）

### 4.1 Telegram 单独掉线，其它网站正常

现象：Telegram 消息加载不出来，其它网站访问正常。Telegram 自己的日志在 16:15 至 16:52 连续刷约 369 条 `Config Error: No 'Date' header received.`，说明它拉配置的 HTTPS 请求拿不到有效响应，出站链路当时是不通的。规则从 13:39 起就没有变动过，不是规则写错。

原因在策略组的编排上，见 `configs/client/Script.js` 的模块 5：

- `RAK` 组是 fallback，成员只有 `RAK-HY2` 和 `RAK-CDN`，健康检查间隔 300 秒。
- `Bulk-Traffic` 是 select，首项是 `RAK` 组。
- Telegram 的全部规则（`GEOIP,telegram`、`telegram.org`、`t.me`、`tdesktop.com`、`telegra.ph`、`telesco.pe`、`91.108.4.0/22`、`91.108.8.0/22`、`91.108.56.0/22`、`149.154.160.0/20`）都指向 `Bulk-Traffic`。
- 其余流量走 `MATCH → Proxy → 线路选择`，而 `线路选择` 是 select，首项是 `DMIT` 组。

所以 RAK 一旦抖动，300 秒检测周期内 fallback 仍可能指向失效成员，全网只有 Telegram 掉线。mihomo 那段时间的日志已被轮转掉，缺少直接证据，这一条属于推断。

改法有两条，都落在 `configs/client/Script.js` 与 `configs/server/custom-clash.yml`：

1. 把 `Bulk-Traffic` 从 select 改成 fallback，或给它加一个自动测速组，让它在 DMIT-HY2 和 RAK-HY2 之间自动选健康节点。
2. 把 Telegram 那几条规则的策略组改成 `线路选择`，与其余流量走同一条自动链路。

订阅文件本身会被订阅更新覆盖，所以要改的是仓库里的模板。

### 4.2 订阅里的失效节点

- `SSH-AUTO` 组中 `SSH-10.10.10.2` 和 `SSH-inceptio-100.69.196.30` 两个节点健康检查为 0，即已失效。它们是内网 SSH 隧道的目标，失效通常是对端机器离线或地址变更，不是代理线路本身的问题。
- 有一个第三方订阅（订阅标识 `RtQvGvCeIvIV`）在 2026-11-03 12:55 更新时连续三次超时失败。若持续失败，需要检查该订阅源是否可用，以及本机到它的链路。

### 4.3 本机代理接管方式

本机 Clash Verge 开启的是 TUN 模式（`utun` 网卡并劫持 DNS），系统代理是关闭的，所以应用流量由 TUN 接管，判断一条连接走哪条线路要看 mihomo 的实时连接表，而不是系统代理设置。
