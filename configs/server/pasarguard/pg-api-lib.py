# pg-api.py 的函数版，供面板容器内的其它脚本导入
import asyncio, json, sqlite3, ssl, sys, urllib.request, urllib.error
sys.path.insert(0, "/code")
from app.utils.jwt import create_admin_token
row = sqlite3.connect("file:/var/lib/pasarguard/db.sqlite3?mode=ro", uri=True).execute(
    "select id, username, hashed_password from admins where role_id=(select id from admin_roles where is_owner=1) order by id limit 1").fetchone()
token = asyncio.run(create_admin_token(row[0], row[1], row[2]))

def api(method, path, body=None):
    req = urllib.request.Request("https://127.0.0.1:39721/api" + path, method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Authorization": "Bearer " + token, "content-type": "application/json"})
    try:
        return json.load(urllib.request.urlopen(req, context=ssl._create_unverified_context(), timeout=120))
    except urllib.error.HTTPError as e:
        raise SystemExit(f"{method} {path} -> HTTP {e.code}: {e.read().decode()[:400]}")
