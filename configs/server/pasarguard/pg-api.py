# 在 PasarGuard 面板容器内调用管理接口：python pg-api.py METHOD PATH [JSON]
import asyncio, json, sqlite3, ssl, sys, urllib.request, urllib.error
sys.path.insert(0, "/code")
from app.utils.jwt import create_admin_token
row = sqlite3.connect("file:/var/lib/pasarguard/db.sqlite3?mode=ro", uri=True).execute(
    "select id, username, hashed_password from admins where role_id=(select id from admin_roles where is_owner=1) order by id limit 1").fetchone()
token = asyncio.run(create_admin_token(row[0], row[1], row[2]))
method, path = sys.argv[1], sys.argv[2]
body = sys.argv[3].encode() if len(sys.argv) > 3 else None
req = urllib.request.Request("https://127.0.0.1:39721/api" + path, method=method, data=body,
    headers={"Authorization": "Bearer " + token, "content-type": "application/json"})
try:
    print(urllib.request.urlopen(req, context=ssl._create_unverified_context(), timeout=120).read().decode())
except urllib.error.HTTPError as e:
    print("HTTP", e.code, e.read().decode()[:500]); sys.exit(1)
