#!/usr/bin/env bash
# 渲染 Shadowrocket 手机端配置
# 用法: scripts/render-shadowrocket.sh [输出路径]，默认输出到 ~/Downloads/shadowrocket-dmit.conf
# 产物含真实域名，放在仓库外，通过 AirDrop 传到手机后在 Shadowrocket「配置」里导入。
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
template="$root/configs/client/shadowrocket.conf"
secrets="$root/secrets.env"
target="${1:-$HOME/Downloads/shadowrocket-dmit.conf}"

[[ -f "$secrets" ]] || { echo "找不到 $secrets，请先复制 secrets.example.env 并填入真实值" >&2; exit 1; }

gitlab_domain="$(sed -nE 's/^[[:space:]]*GITLAB_DOMAIN[[:space:]]*=[[:space:]]*["'\'']?([^"'\'']*)["'\'']?[[:space:]]*$/\1/p' "$secrets" | tail -n1)"

if [[ -n "$gitlab_domain" ]]; then
  output="$(sed "s|<GITLAB_DOMAIN>|$gitlab_domain|g" "$template")"
else
  # 没配私有 GitLab 时去掉这条规则，避免留下无效占位符
  output="$(grep -v '<GITLAB_DOMAIN>' "$template")"
fi

leftover="$(grep -oE '<[A-Z][A-Z0-9_]{2,}>' <<<"$output" | sort -u || true)"
[[ -z "$leftover" ]] || { echo "渲染后仍有未替换占位符: $leftover" >&2; exit 1; }

for section in General 'Proxy Group' Rule; do
  grep -qxF "[$section]" <<<"$output" || { echo "缺少 [$section] 段" >&2; exit 1; }
done

printf '%s\n' "$output" > "$target"
echo "已生成 $target（$(grep -cE '^[A-Z-]+,' "$target") 条规则）"

# RAK 独立线路不在 Marzban 订阅里，另外生成导入链接（含凭据，权限 0600，放在仓库外）
secret() { sed -nE "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*[\"']?([^\"']*)[\"']?[[:space:]]*\$/\\1/p" "$secrets" | tail -n1; }
rak_ip="$(secret RAK_SERVER_IP)"; hy2_pass="$(secret RAK_HY2_PASSWORD)"; hy2_pin="$(secret RAK_HY2_PIN_SHA256)"; hy2_sni="$(secret RAK_HY2_SNI)"
cdn_domain="$(secret CDN_DOMAIN)"; cdn_path="$(secret CDN_PATH)"; cdn_uuid="$(secret RAK_CDN_UUID)"
if [[ -n "$rak_ip" && -n "$hy2_pass" && -n "$hy2_pin" && -n "$hy2_sni" && -n "$cdn_domain" && -n "$cdn_path" && -n "$cdn_uuid" ]]; then
  nodes="${target%.conf}-rak-nodes.txt"
  enc_path="$(python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1],safe=""))' "$cdn_path")"
  (umask 077; {
    echo "hysteria2://${hy2_pass}@${rak_ip}:443?sni=${hy2_sni}&pinSHA256=${hy2_pin}#RAK-HY2"
    echo "vless://${cdn_uuid}@${cdn_domain}:443?encryption=none&security=tls&sni=${cdn_domain}&fp=chrome&type=ws&host=${cdn_domain}&path=${enc_path}#RAK-CDN"
  } > "$nodes")
  echo "已生成 $nodes（RAK-HY2、RAK-CDN 导入链接，含凭据，导入后请删除）"
else
  echo "secrets.env 缺少 RAK 独立线路参数，跳过生成导入链接" >&2
fi
