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
