import re
from collections import Counter, defaultdict
from datetime import datetime, timezone, timedelta

def main():
    log_path = '/var/lib/marzban/xray-access-observe.log'
    now_utc = datetime.now(timezone.utc)
    # 取过去 24 小时
    cutoff = now_utc - timedelta(hours=24)
    # 日志里的格式一般为: 2026/09/29 02:15:30
    cutoff_dt = datetime(cutoff.year, cutoff.month, cutoff.day, cutoff.hour, cutoff.minute, cutoff.second)

    target_count = Counter()
    user_targets = defaultdict(lambda: Counter())
    target_ports = defaultdict(lambda: Counter())
    total_lines = 0
    matched_lines = 0

    print(f"开始解析 {log_path}，过滤截止时间: {cutoff_dt}")

    with open(log_path, 'r', encoding='utf-8', errors='ignore') as f:
        for line in f:
            total_lines += 1
            parts = line.strip().split()
            if len(parts) < 6:
                continue
            try:
                dt = datetime.strptime(f"{parts[0]} {parts[1]}", "%Y/%m/%d %H:%M:%S")
            except Exception:
                continue
            if dt < cutoff_dt:
                continue

            matched_lines += 1
            target = ''
            port = ''
            email = 'unknown'

            for i, p in enumerate(parts):
                if p.startswith('tcp:') or p.startswith('udp:'):
                    sub = p.split(':')
                    if len(sub) >= 3:
                        target = sub[1]
                        port = sub[2]
                    elif len(sub) == 2:
                        target = sub[1]
                elif p == 'email:' and i + 1 < len(parts):
                    email = parts[i+1]

            if target:
                target_count[target] += 1
                user_targets[email][target] += 1
                if port:
                    target_ports[target][port] += 1

    print(f"日志总行数: {total_lines}, 过去24h行数: {matched_lines}")
    print("\n" + "=" * 90)
    print("【过去 24 小时 DMIT 主控直连访问 Top 40 目标与域名】")
    print("=" * 90)
    header = f"{'目标地址 / 域名':<45} | {'请求次数':<8} | {'端口':<6} | 活跃用户占比"
    print(header)
    print("-" * 90)
    for target, cnt in target_count.most_common(40):
        # 找出哪些用户访问了该目标
        users = []
        for u, u_targets in user_targets.items():
            if target in u_targets:
                users.append(f"{u.split('.')[-1]}:{u_targets[target]}")
        top_port = target_ports[target].most_common(1)
        port_str = top_port[0][0] if top_port else "-"
        print(f"{target:<45} | {cnt:<8} | {port_str:<6} | {', '.join(users[:4])}")

    # 分用户查看 Top 10
    print("\n" + "=" * 90)
    print("【各用户在 DMIT 主控上的 Top 10 高频目标】")
    print("=" * 90)
    for u, u_targets in user_targets.items():
        uname = u.split('.')[-1]
        print(f"\n用户账号: 【{uname}】(共 {sum(u_targets.values())} 次请求)")
        for t, cnt in u_targets.most_common(10):
            print(f"   ├─ {t:<42}: {cnt} 次")

if __name__ == '__main__':
    main()
