#!/bin/sh
# 放在 DMIT 的 /etc/letsencrypt/renewal-hooks/deploy/。证书续期后重启面板（39721 的 HTTPS）和 DMIT-HY2 节点，
# 让它们加载新证书。Reality 节点不用证书，不重启。替代迁移前的 restart-marzban.sh。
cd /opt/pasarguard && docker compose restart panel node-hy2
