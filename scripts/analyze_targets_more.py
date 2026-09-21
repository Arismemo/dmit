import sys
from collections import Counter, defaultdict
from datetime import datetime

log_path = '/var/lib/marzban/xray-access-observe.log'
cutoff = datetime(2026, 9, 20, 10, 0, 0)

target_users = defaultdict(lambda: Counter())
target_count = Counter()
target_ports = defaultdict(lambda: Counter())

with open(log_path, 'r', encoding='utf-8', errors='ignore') as f:
    for line in f:
        parts = line.strip().split()
        if len(parts) < 6:
            continue
        try:
            dt = datetime.strptime(f'{parts[0]} {parts[1]}', '%Y/%m/%d %H:%M:%S')
        except Exception:
            continue
        if dt < cutoff:
            continue
        
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
            target_users[target][email] += 1
            if port:
                target_ports[target][port] += 1

print("=== 过去24小时 DMIT 主控访问目标全景 (排名 46 ~ 90) ===")
header = f"{'Target Address / Domain':<48} | {'Requests':<8} | {'Port':<8} | Users"
print(header)
print("-" * 105)
for target, cnt in target_count.most_common(90)[45:]:
    u_list = [f"{u.split('.')[-1]}:{c}" for u, c in target_users[target].most_common(2)]
    user_str = ", ".join(u_list)
    top_port = target_ports[target].most_common(1)
    port_str = top_port[0][0] if top_port else "-"
    print(f"{target:<48} | {cnt:<8} | {port_str:<8} | {user_str}")
