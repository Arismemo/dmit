import sqlite3
import sys
from datetime import datetime, timezone, timedelta

def main():
    db_path = '/var/lib/marzban/db.sqlite3'
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()

    # 当前基准时间: UTC 2026-09-21 10:00:00 (北京时间 18:00)
    # 24小时前: UTC 2026-09-20 10:00:00
    cutoff_utc = "2026-09-20 10:00:00"

    nodes_meta = {
        None: {"name": "Master (DMIT-LA)", "role": "极速专线/核心主控", "ip": "154.26.180.211", "port": "443 (TCP/UDP)"},
        1: {"name": "Node 1 (RAK-Bulk-1T)", "role": "1000G大流量泄洪", "ip": "137.175.65.78", "port": "3389 (TCP)"},
        2: {"name": "Node 2 (AWS-US-Clean)", "role": "纯净出口/容灾解锁", "ip": "18.188.243.223", "port": "443 (TCP)"}
    }

    print("=" * 80)
    print("【过去 24 小时跨境网络集群流量审计报告】")
    print(f"统计时间窗口 (UTC):  2026-09-20 10:00:00 至 2026-09-21 10:05:00")
    print(f"统计时间窗口 (北京): 2026-09-20 18:00:00 至 2026-09-21 18:05:00")
    print("=" * 80)

    # 1. 各节点总流量统计
    cur.execute("""
        SELECT node_id, SUM(uplink), SUM(downlink), COUNT(*)
        FROM node_usages
        WHERE created_at >= ?
        GROUP BY node_id
    """, (cutoff_utc,))
    node_rows = cur.fetchall()

    total_uplink = sum(r[1] or 0 for r in node_rows)
    total_downlink = sum(r[2] or 0 for r in node_rows)
    grand_total = total_uplink + total_downlink

    print("\n一、各服务器节点流量汇总与占比:")
    print("-" * 80)
    print(f"{'节点标识':<22} | {'上行 (TX)':<12} | {'下行 (RX)':<12} | {'总流量':<12} | {'占比':<8}")
    print("-" * 80)

    # 按照流量大小倒序
    sorted_node_rows = sorted(node_rows, key=lambda x: (x[1] or 0) + (x[2] or 0), reverse=True)
    for nid, up, down, cnt in sorted_node_rows:
        up = up or 0
        down = down or 0
        tot = up + down
        pct = (tot / grand_total * 100) if grand_total > 0 else 0
        meta = nodes_meta.get(nid, {"name": f"Node {nid}", "role": "未知", "ip": "-"})
        
        def fmt_bytes(b):
            if b >= 1024**3:
                return f"{b / (1024**3):.2f} GB"
            elif b >= 1024**2:
                return f"{b / (1024**2):.2f} MB"
            elif b >= 1024:
                return f"{b / 1024:.2f} KB"
            return f"{b} B"

        print(f"{meta['name']:<22} | {fmt_bytes(up):<12} | {fmt_bytes(down):<12} | {fmt_bytes(tot):<12} | {pct:5.1f}%")
        print(f"  └─ 角色: {meta['role']} | 真实IP: {meta['ip']} | 记录活跃小时数: {cnt}/24")

    print("-" * 80)
    def fmt_bytes_all(b):
        return f"{b / (1024**3):.2f} GB ({b / (1024**2):.1f} MB)"
    print(f"【集群过去24小时全量传输】: {fmt_bytes_all(grand_total)}")
    print(f"  ├─ 总上行流量 (Upload):   {fmt_bytes_all(total_uplink)}")
    print(f"  └─ 总下行流量 (Download): {fmt_bytes_all(total_downlink)}")

    # 2. 按用户账号维度细分流量
    print("\n\n二、各用户在不同服务器的流量流向细分:")
    print("-" * 80)
    cur.execute("""
        SELECT u.username, nu.node_id, SUM(nu.used_traffic)
        FROM node_user_usages nu
        JOIN users u ON nu.user_id = u.id
        WHERE nu.created_at >= ?
        GROUP BY u.username, nu.node_id
        ORDER BY SUM(nu.used_traffic) DESC
    """, (cutoff_utc,))
    user_node_rows = cur.fetchall()

    user_summary = {}
    for user, nid, traffic in user_node_rows:
        if user not in user_summary:
            user_summary[user] = {"total": 0, "by_node": {}}
        user_summary[user]["total"] += traffic
        user_summary[user]["by_node"][nid] = traffic

    for user, udata in sorted(user_summary.items(), key=lambda x: x[1]["total"], reverse=True):
        u_tot = udata["total"]
        u_pct = (u_tot / grand_total * 100) if grand_total > 0 else 0
        print(f"用户账号: 【{user}】 | 24小时总消耗: {fmt_bytes_all(u_tot)} | 占集群: {u_pct:.1f}%")
        for nid, val in udata["by_node"].items():
            meta = nodes_meta.get(nid, {"name": f"Node {nid}"})
            n_pct = (val / u_tot * 100) if u_tot > 0 else 0
            print(f"   ├── 走向 {meta['name']:<22}: {fmt_bytes_all(val):<22} (该用户内占比: {n_pct:5.1f}%)")
        print("-" * 60)

    # 3. 每小时流量时间线
    print("\n\n三、过去 24 小时每小时流量分布趋势 (UTC / 北京时间对照):")
    print("-" * 80)
    cur.execute("""
        SELECT strftime('%Y-%m-%d %H:00', created_at) as hr,
               SUM(CASE WHEN node_id IS NULL THEN uplink + downlink ELSE 0 END) as master_bytes,
               SUM(CASE WHEN node_id = 1 THEN uplink + downlink ELSE 0 END) as rak_bytes,
               SUM(CASE WHEN node_id = 2 THEN uplink + downlink ELSE 0 END) as aws_bytes,
               SUM(uplink + downlink) as total_bytes
        FROM node_usages
        WHERE created_at >= ?
        GROUP BY hr
        ORDER BY hr ASC
    """, (cutoff_utc,))
    hourly_rows = cur.fetchall()

    print(f"{'时间 (UTC / 北京)':<22} | {'Master(DMIT)':<14} | {'RAKsmart(泄洪)':<14} | {'AWS(纯净)':<12} | {'小时合计':<12}")
    print("-" * 80)
    for hr, m_b, r_b, a_b, t_b in hourly_rows:
        # 转换为北京时间
        dt_utc = datetime.strptime(hr, "%Y-%m-%d %H:00")
        dt_cst = dt_utc + timedelta(hours=8)
        time_str = f"{dt_utc.strftime('%m-%d %H:00')} / {dt_cst.strftime('%H:00')}CST"
        
        def sfmt(b):
            if not b:
                return "-"
            if b >= 1024**3:
                return f"{b / (1024**3):.2f} GB"
            elif b >= 1024**2:
                return f"{b / (1024**2):.1f} MB"
            return f"{b / 1024:.0f} KB"
            
        print(f"{time_str:<22} | {sfmt(m_b):<14} | {sfmt(r_b):<14} | {sfmt(a_b):<12} | {sfmt(t_b):<12}")

if __name__ == '__main__':
    main()
