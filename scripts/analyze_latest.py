import sqlite3
from datetime import datetime, timezone, timedelta

def main():
    conn = sqlite3.connect('/var/lib/marzban/db.sqlite3')
    cur = conn.cursor()

    now_utc = datetime.now(timezone.utc)
    c24h = (now_utc - timedelta(hours=24)).strftime('%Y-%m-%d %H:%M:%S')
    c48h = (now_utc - timedelta(hours=48)).strftime('%Y-%m-%d %H:%M:%S')
    c7d = (now_utc - timedelta(days=7)).strftime('%Y-%m-%d %H:%M:%S')

    nodes_meta = {
        None: {"name": "Master (DMIT-LA)", "role": "极速专线/核心主控", "ip": "179.255.119.112"},
        1: {"name": "Node 1 (RAK-Bulk-1T)", "role": "1000G大流量泄洪", "ip": "137.175.65.78"},
        2: {"name": "Node 2 (AWS-US-Clean)", "role": "纯净出口/容灾解锁", "ip": "18.188.243.223"}
    }

    def fmt_bytes(b):
        if not b:
            return "0 B"
        if b >= 1024**3:
            return f"{b / (1024**3):.2f} GB"
        if b >= 1024**2:
            return f"{b / (1024**2):.2f} MB"
        if b >= 1024:
            return f"{b / 1024:.2f} KB"
        return f"{b} B"

    print("=" * 80)
    print(f"【Marzban 流量审计报告 - {now_utc.strftime('%Y-%m-%d %H:%M:%S')} UTC】")
    print("=" * 80)

    # 1. 最新记录时间
    cur.execute("SELECT MAX(created_at) FROM node_usages")
    latest_usage = cur.fetchone()[0]
    cur.execute("SELECT MAX(created_at) FROM node_user_usages")
    latest_user_usage = cur.fetchone()[0]
    print(f"最新 node_usages 写入时间:      {latest_usage}")
    print(f"最新 node_user_usages 写入时间: {latest_user_usage}")

    # 2. 过去 24 小时
    print("\n" + "-" * 80)
    print(f"一、过去 24 小时各节点流量统计 ({c24h} 至 当前)")
    print("-" * 80)
    cur.execute("""
        SELECT node_id, SUM(uplink), SUM(downlink), COUNT(*)
        FROM node_usages
        WHERE created_at >= ?
        GROUP BY node_id
    """, (c24h,))
    rows24 = cur.fetchall()
    t_tot24 = sum((r[1] or 0) + (r[2] or 0) for r in rows24)

    for nid, up, down, cnt in sorted(rows24, key=lambda x: (x[1] or 0) + (x[2] or 0), reverse=True):
        up, down = (up or 0), (down or 0)
        tot = up + down
        pct = (tot / t_tot24 * 100) if t_tot24 > 0 else 0
        meta = nodes_meta.get(nid, {"name": f"Node {nid}", "role": "未知"})
        print(f"{meta['name']:<22} | 上行: {fmt_bytes(up):<9} | 下行: {fmt_bytes(down):<9} | 合计: {fmt_bytes(tot):<9} | 占比: {pct:5.1f}% | 记录周期: {cnt}")
    print(f"--> 24小时集群总吞吐: {fmt_bytes(t_tot24)}")

    # 3. 过去 7 天
    print("\n" + "-" * 80)
    print(f"二、过去 7 天各节点流量统计 ({c7d} 至 当前)")
    print("-" * 80)
    cur.execute("""
        SELECT node_id, SUM(uplink), SUM(downlink), COUNT(*)
        FROM node_usages
        WHERE created_at >= ?
        GROUP BY node_id
    """, (c7d,))
    rows7d = cur.fetchall()
    t_tot7d = sum((r[1] or 0) + (r[2] or 0) for r in rows7d)

    for nid, up, down, cnt in sorted(rows7d, key=lambda x: (x[1] or 0) + (x[2] or 0), reverse=True):
        up, down = (up or 0), (down or 0)
        tot = up + down
        pct = (tot / t_tot7d * 100) if t_tot7d > 0 else 0
        meta = nodes_meta.get(nid, {"name": f"Node {nid}", "role": "未知"})
        print(f"{meta['name']:<22} | 上行: {fmt_bytes(up):<9} | 下行: {fmt_bytes(down):<9} | 合计: {fmt_bytes(tot):<9} | 占比: {pct:5.1f}% | 记录周期: {cnt}")
    print(f"--> 7天集群总吞吐: {fmt_bytes(t_tot7d)}")

    # 4. 过去 24 小时各用户在各节点的流量分配
    print("\n" + "-" * 80)
    print("三、过去 24 小时各用户在各节点的消耗及流向分布")
    print("-" * 80)
    cur.execute("""
        SELECT u.username, nu.node_id, SUM(nu.used_traffic)
        FROM node_user_usages nu
        JOIN users u ON nu.user_id = u.id
        WHERE nu.created_at >= ?
        GROUP BY u.username, nu.node_id
        ORDER BY SUM(nu.used_traffic) DESC
    """, (c24h,))
    u_rows = cur.fetchall()
    u_map = {}
    for u, nid, tf in u_rows:
        if u not in u_map:
            u_map[u] = {"tot": 0, "nodes": {}}
        u_map[u]["tot"] += tf
        u_map[u]["nodes"][nid] = tf

    for u, data in sorted(u_map.items(), key=lambda x: x[1]["tot"], reverse=True):
        pct_cluster = (data["tot"] / t_tot24 * 100) if t_tot24 > 0 else 0
        print(f"【用户: {u:<10}】 24h 消耗: {fmt_bytes(data['tot']):<10} (占集群: {pct_cluster:5.1f}%)")
        for nid, tf in sorted(data["nodes"].items(), key=lambda x: x[1], reverse=True):
            meta = nodes_meta.get(nid, {"name": f"Node {nid}"})
            pct_user = (tf / data["tot"] * 100) if data["tot"] > 0 else 0
            print(f"   ├─ {meta['name']:<22}: {fmt_bytes(tf):<10} (占该用户: {pct_user:5.1f}%)")

    # 5. 过去 7 天各用户在各节点的总消耗
    print("\n" + "-" * 80)
    print("四、过去 7 天各用户流量与节点流向分布")
    print("-" * 80)
    cur.execute("""
        SELECT u.username, nu.node_id, SUM(nu.used_traffic)
        FROM node_user_usages nu
        JOIN users u ON nu.user_id = u.id
        WHERE nu.created_at >= ?
        GROUP BY u.username, nu.node_id
        ORDER BY SUM(nu.used_traffic) DESC
    """, (c7d,))
    u7_rows = cur.fetchall()
    u7_map = {}
    for u, nid, tf in u7_rows:
        if u not in u7_map:
            u7_map[u] = {"tot": 0, "nodes": {}}
        u7_map[u]["tot"] += tf
        u7_map[u]["nodes"][nid] = tf

    for u, data in sorted(u7_map.items(), key=lambda x: x[1]["tot"], reverse=True):
        pct_cluster = (data["tot"] / t_tot7d * 100) if t_tot7d > 0 else 0
        print(f"【用户: {u:<10}】 7天 消耗: {fmt_bytes(data['tot']):<10} (占集群: {pct_cluster:5.1f}%)")
        for nid, tf in sorted(data["nodes"].items(), key=lambda x: x[1], reverse=True):
            meta = nodes_meta.get(nid, {"name": f"Node {nid}"})
            pct_user = (tf / data["tot"] * 100) if data["tot"] > 0 else 0
            print(f"   ├─ {meta['name']:<22}: {fmt_bytes(tf):<10} (占该用户: {pct_user:5.1f}%)")

if __name__ == "__main__":
    main()
