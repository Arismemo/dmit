#!/usr/bin/env bash
# DMIT-HY2 由独立的 hysteria-server 切到 PasarGuard 第二个节点。失败时自动恢复 hysteria-server。
set -euo pipefail
P=pasarguard-panel-1; T=/opt/pasarguard/tools
rollback() {
  echo "!!! 切换失败，恢复 hysteria-server" >&2
  (cd /opt/pasarguard && docker compose rm -sf node-hy2) || true
  systemctl enable --now hysteria-server && echo "hysteria-server 已恢复" >&2
  exit 1
}
trap rollback ERR
systemctl disable --now hysteria-server
cd /opt/pasarguard && docker compose up -d node-hy2
docker cp $T/pg-api-lib.py $P:/tmp/; docker cp $T/pg-node-upsert.py $P:/tmp/
docker cp /var/lib/pg-node-hy2/certs/ssl_cert.pem $P:/tmp/hy2-cert.pem; docker cp /opt/pasarguard/node-hy2.env $P:/tmp/hy2.env
docker exec $P python /tmp/pg-node-upsert.py DMIT-HY2 127.0.0.1 62071 DMIT-HY2 /tmp/hy2-cert.pem /tmp/hy2.env
docker exec $P rm -f /tmp/hy2.env /tmp/hy2-cert.pem
for i in $(seq 1 20); do ss -lnup | grep -qE ':443 .*xray' && break; sleep 3; done
ss -lnup | grep -E ':443 ' | awk '{print $4, $6}'
ss -lnup | grep -qE ':443 .*xray' || false
trap - ERR
echo "DMIT-HY2 切换完成"
