#!/usr/bin/env bash
# DMIT 节点巡检与健康采样脚本
set -euo pipefail

echo "============================================="
echo "       DMIT Proxy Server Diagnostics         "
echo "============================================="
echo "时间: $(date '+%Y-%m-%d %H:%M:%S %Z')"
echo "系统运行时间: $(uptime -p)"
echo ""

echo "--- 1. 网络内核参数检查 ---"
echo -n "TCP 拥塞控制算法: "
sysctl -n net.ipv4.tcp_congestion_control
echo -n "TCP 队列调度算法: "
sysctl -n net.core.default_qdisc
echo -n "TCP Fast Open (TFO): "
sysctl -n net.ipv4.tcp_fastopen
echo ""

echo "--- 2. 端口监听与服务状态 ---"
ss -tulpn | grep -E '(:443|:8000|:80|marzban|hysteria)' || true
echo ""

echo "--- 3. 容器运行状态 ---"
if command -v docker &> /dev/null; then
  docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
fi
echo ""

echo "--- 4. Hysteria 2 服务状态 ---"
if systemctl is-active --quiet hysteria-server; then
  echo "Hysteria 2: [ACTIVE 运行中]"
else
  echo "Hysteria 2: [INACTIVE 未运行]"
fi
echo ""

echo "--- 5. Xray 访问日志与黑洞命中抽样 (最近 15 条) ---"
if [ -f /var/lib/marzban/xray-access-observe.log ]; then
  tail -n 15 /var/lib/marzban/xray-access-observe.log | sed 's/\([0-9]\{1,3\}\.\)\{2\}[0-9]\{1,3\}\./*.*.*./g'
elif [ -f /var/log/xray/access.log ]; then
  tail -n 15 /var/log/xray/access.log | sed 's/\([0-9]\{1,3\}\.\)\{2\}[0-9]\{1,3\}\./*.*.*./g'
elif docker logs --tail 15 marzban-marzban-1 2>&1 | grep -q "xray"; then
  docker logs --tail 15 marzban-marzban-1 2>&1
else
  echo "无独立访问日志或已内嵌于容器标准输出"
fi
echo ""

echo "--- 6. 基础网络延迟测试 (针对 Cloudflare / Google / 国内回国) ---"
ping -c 3 1.1.1.1 | tail -n 2 || true
echo "巡检完成。"
