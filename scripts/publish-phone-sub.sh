#!/usr/bin/env bash
# 发布手机 Shadowrocket 的订阅链接与远程配置链接（经 Cloudflare 的 static 站点访问）。
# 用法: scripts/publish-phone-sub.sh
#
# 发布两样东西到 DMIT 的 /var/www/phone-sub/：
#   sub                 节点订阅：DMIT 上的定时器每 10 分钟从 Marzban 拉 DMIT-LA、DMIT-CDN，
#                       再拼上本脚本上传的共享节点（DMIT-HY2、RAK-HY2、RAK-CDN）
#   shadowrocket.conf   远程配置：DNS、策略组与分流规则，由 render-shadowrocket.sh 渲染
# 共享节点的凭据或规则有变化时重新运行本脚本；Marzban 节点（换密钥等）无需重跑。
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
secrets="$root/secrets.env"
host="${DMIT_SSH_HOST:-dmit}"
[[ -f "$secrets" ]] || { echo "找不到 $secrets" >&2; exit 1; }
secret() { sed -nE "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*[\"']?([^\"']*)[\"']?[[:space:]]*\$/\\1/p" "$secrets" | tail -n1; }

server_ip="$(secret SERVER_IP)"; hy2_pass="$(secret HY2_PASSWORD)"; domain="$(secret DOMAIN_NAME)"
rak_ip="$(secret RAK_SERVER_IP)"; rak_pass="$(secret RAK_HY2_PASSWORD)"; rak_pin="$(secret RAK_HY2_PIN_SHA256)"; rak_sni="$(secret RAK_HY2_SNI)"
cdn_domain="$(secret CDN_DOMAIN)"; cdn_path="$(secret CDN_PATH)"; cdn_uuid="$(secret RAK_CDN_UUID)"
pub_path="$(secret PHONE_SUB_PATH)"; marzban_user="${PHONE_SUB_USER:-liukun}"
for v in server_ip hy2_pass domain rak_ip rak_pass rak_pin rak_sni cdn_domain cdn_path cdn_uuid pub_path; do
  [[ -n "${!v}" ]] || { echo "secrets.env 缺少 $v 对应的配置项" >&2; exit 1; }
done
[[ "$pub_path" =~ ^[0-9a-f]{32}$ ]] || { echo "PHONE_SUB_PATH 应为 32 位十六进制" >&2; exit 1; }

work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
chmod 700 "$work"
enc_path="$(python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1],safe=""))' "$cdn_path")"
(umask 077; {
  echo "# 共享凭据节点，由 scripts/publish-phone-sub.sh 生成"
  # 顺序即手机端 fallback 组内的优先级：RAK-CDN（TCP 经 Cloudflare）必须排在 RAK-HY2（UDP）之前，
  # 国内链路常丢弃境外 UDP 回程，UDP 在前会让整组卡在不可用节点上。
  echo "hysteria2://${hy2_pass}@${server_ip}:443?sni=${domain}#DMIT-HY2"
  echo "vless://${cdn_uuid}@${cdn_domain}:443?encryption=none&security=tls&sni=${cdn_domain}&fp=chrome&type=ws&host=${cdn_domain}&path=${enc_path}#RAK-CDN"
  echo "hysteria2://${rak_pass}@${rak_ip}:443?sni=${rak_sni}&pinSHA256=${rak_pin}#RAK-HY2"
} > "$work/shared-links.txt")

bash "$root/scripts/render-shadowrocket.sh" "$work/shadowrocket.conf" >/dev/null
rm -f "$work/shadowrocket-rak-nodes.txt"

scp -q "$work/shared-links.txt" "$work/shadowrocket.conf" \
  "$root/configs/server/phone-sub/dmit-phone-sub-render" \
  "$root/configs/server/phone-sub/dmit-phone-sub.service" \
  "$root/configs/server/phone-sub/dmit-phone-sub.timer" \
  "$host:/tmp/"

ssh "$host" PUB_PATH="$pub_path" MARZBAN_USER="$marzban_user" 'bash -s' <<'REMOTE'
set -euo pipefail
install -d -m 700 /etc/dmit-phone-sub
install -d -m 755 /var/www/phone-sub
install -m 600 /tmp/shared-links.txt /etc/dmit-phone-sub/shared-links.txt
install -m 644 /tmp/shadowrocket.conf /var/www/phone-sub/shadowrocket.conf
install -m 755 /tmp/dmit-phone-sub-render /usr/local/bin/dmit-phone-sub-render
install -m 644 /tmp/dmit-phone-sub.service /tmp/dmit-phone-sub.timer /etc/systemd/system/
rm -f /tmp/shared-links.txt /tmp/shadowrocket.conf /tmp/dmit-phone-sub-render /tmp/dmit-phone-sub.service /tmp/dmit-phone-sub.timer

# Marzban 用户的订阅地址改走本机回环，不依赖公网
sub_path="$(docker exec marzban-marzban-1 python3 -c "
import json,ssl,urllib.request,sqlite3,sys
from app.utils.jwt import create_admin_token
c=sqlite3.connect('/var/lib/marzban/db.sqlite3')
admin=c.execute('select username from admins where is_sudo=1 limit 1').fetchone()[0]
r=urllib.request.Request('https://127.0.0.1:39721/api/user/'+sys.argv[1],headers={'Authorization':'Bearer '+create_admin_token(admin,is_sudo=True)})
u=json.load(urllib.request.urlopen(r,context=ssl._create_unverified_context(),timeout=20))
print('/sub/'+u['subscription_url'].split('/sub/')[-1])
" "$MARZBAN_USER")"
umask 077
printf 'MARZBAN_SUB_URL=%s\nPUBLISH_DIR=/var/www/phone-sub\n' "https://127.0.0.1:39721${sub_path}" > /etc/dmit-phone-sub/env

# nginx：在 static.230254.xyz 站点里加发布路径（幂等）
site=/etc/nginx/sites-available/dmit-edge
if ! grep -q "location /${PUB_PATH}/" "$site"; then
  cp -p "$site" "$site.bak-$(date -u +%Y%m%dT%H%M%SZ)-pre-phone-sub"
  python3 - "$site" "$PUB_PATH" <<'PY'
import sys
site, pub = sys.argv[1], sys.argv[2]
t = open(site).read()
anchor = "    server_name static.230254.xyz;\n"
assert t.count(anchor) == 1, "static 站点定位失败"
block = (f"    location /{pub}/ {{\n"
         "        alias /var/www/phone-sub/;\n"
         "        default_type text/plain;\n"
         "        charset utf-8;\n"
         "        add_header Cache-Control \"no-store\" always;\n"
         "        location ~ /\\. { return 404; }\n"
         "    }\n")
i = t.index(anchor)
j = t.index("    location", i)
t = t[:j] + block + t[j:]
open(site, "w").write(t)
PY
  nginx -t -q && systemctl reload nginx
fi

systemctl daemon-reload
systemctl enable --now dmit-phone-sub.timer >/dev/null
systemctl start dmit-phone-sub.service
journalctl -u dmit-phone-sub.service -n 1 --no-pager -o cat
REMOTE

echo "订阅链接：https://static.230254.xyz/${pub_path}/sub"
echo "远程配置：https://static.230254.xyz/${pub_path}/shadowrocket.conf"
