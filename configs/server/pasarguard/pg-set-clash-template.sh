#!/usr/bin/env bash
# 把 Clash 订阅模板写入 PasarGuard（模板存在数据库里，改 /var/lib/*/templates 下的文件不会生效）。
# 在 DMIT 上运行：pg-set-clash-template.sh <模板文件>
# 依赖同目录的 pg-api.py；写入前把当前模板备份到 /root/backups。
set -euo pipefail
tpl="${1:?用法: $0 <模板文件>}"
dir="$(cd "$(dirname "$0")" && pwd)"
panel=pasarguard-panel-1
docker cp "$dir/pg-api.py" "$panel:/tmp/pg-api.py"
api() { docker exec "$panel" python /tmp/pg-api.py "$@"; }

id="$(api GET /client_templates | python3 -c '
import json,sys
d=json.load(sys.stdin); ts=d.get("templates", d)
print([t["id"] for t in ts if t["template_type"]=="clash_subscription" and t.get("is_default")][0])')"
install -d -m 700 /root/backups
api GET "/client_template/$id" > "/root/backups/clash-template-$id-$(date -u +%Y%m%dT%H%M%SZ).json"

body="$(python3 - "$tpl" "$(api GET "/client_template/$id")" <<'PY'
import json,sys
cur=json.loads(sys.argv[2])
print(json.dumps({"name": cur["name"], "content": open(sys.argv[1]).read(), "is_default": True}))
PY
)"
api PUT "/client_template/$id" "$body" | python3 -c 'import json,sys;d=json.load(sys.stdin);print("已写入模板", d["id"], d["name"], len(d["content"]), "字节")'
