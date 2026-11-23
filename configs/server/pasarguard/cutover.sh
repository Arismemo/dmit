#!/usr/bin/env bash
# Marzban -> PasarGuard 切换。失败时自动回到 Marzban（/var/lib/marzban 全程不改动）。
set -euo pipefail
SERVER_IP="$1"
ts=$(date -u +%Y%m%dT%H%M%SZ)
rollback() {
  echo "!!! 切换失败，回滚到 Marzban" >&2
  (cd /opt/pasarguard && docker compose down) || true
  (cd /opt/marzban && docker compose up -d) && echo "已回滚，Marzban 已启动" >&2
  exit 1
}
[ -e /var/lib/pasarguard ] && { echo "/var/lib/pasarguard 已存在，停止" >&2; exit 1; }
cd /opt/marzban && docker compose down
trap rollback ERR
install -d -m 700 /var/lib/pasarguard
python3 -c "import sqlite3;s=sqlite3.connect('/var/lib/marzban/db.sqlite3');d=sqlite3.connect('/var/lib/pasarguard/db.sqlite3');s.backup(d);d.close()"
cp /var/lib/pasarguard/db.sqlite3 /root/backups/marzban-final-$ts.sqlite3
cp -a /var/lib/marzban/xray_config.json /var/lib/marzban/node_client_cert.pem /var/lib/marzban/templates /var/lib/pasarguard/
cd /opt/pasarguard && docker compose up -d
for i in $(seq 1 60); do curl -sk -o /dev/null -m 3 https://127.0.0.1:39721/ && break; sleep 3; done
curl -sk -o /dev/null -m 3 https://127.0.0.1:39721/ || false
echo "面板已启动"
docker cp /opt/pasarguard/tools/pg-import-core.py pasarguard-panel-1:/tmp/pg-import-core.py
docker cp /var/lib/pg-node/certs/ssl_cert.pem pasarguard-panel-1:/tmp/node-cert.pem
docker cp /opt/pasarguard/node.env pasarguard-panel-1:/tmp/node.env
docker exec pasarguard-panel-1 python /tmp/pg-import-core.py /var/lib/pasarguard/db.sqlite3 /var/lib/pasarguard/xray_config.json 39721 "$SERVER_IP" DMIT 62070 /tmp/node-cert.pem /tmp/node.env
docker exec pasarguard-panel-1 rm -f /tmp/node.env /tmp/node-cert.pem
for i in $(seq 1 30); do ss -lnt | grep -q '127.0.0.1:9444 ' && ss -lnt | grep -q '127.0.0.1:23771 ' && break; sleep 3; done
ss -lnt | grep -q '127.0.0.1:9444 ' || false
ss -lntp | grep -E ':9444 |:23771 ' | awk '{print $4, $6}'
trap - ERR
echo "切换完成 $ts"
