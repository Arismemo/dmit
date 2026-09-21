import re
from collections import Counter
from datetime import datetime

log_path = '/var/lib/marzban/xray-access-observe.log'
cutoff = datetime(2026, 9, 20, 10, 0, 0)

suspicious_domains = Counter()
keywords = ['download', 'cdn', 'static', 'storage', 'update', 'pkg', 'repo', 'cache', 'artifact', 'release']

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
        for p in parts:
            if p.startswith('tcp:') or p.startswith('udp:'):
                sub = p.split(':')
                if len(sub) >= 2:
                    target = sub[1]
                break

        if target and any(k in target.lower() for k in keywords):
            suspicious_domains[target] += 1

print("=== 命中下载/静态/更新特征的域名 (Top 30) ===")
for d, c in suspicious_domains.most_common(30):
    print(f"{d:<45}: {c:5d} 次")
