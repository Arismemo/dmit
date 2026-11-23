# 在 PasarGuard 面板容器内运行：把 Marzban 原来的 xray_config.json 写入 1 号核心配置。
# PasarGuard 的迁移脚本因参数类型错误会退回默认配置，这里补上这一步。
import asyncio, json, sqlite3, ssl, sys, urllib.request
sys.path.insert(0, "/code")
from app.utils.jwt import create_admin_token

DB, XRAY, PORT, SERVER_IP = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
row = sqlite3.connect(f"file:{DB}?mode=ro", uri=True).execute(
    "select id, username, hashed_password from admins where role_id=(select id from admin_roles where is_owner=1) order by id limit 1").fetchone()
token = asyncio.run(create_admin_token(row[0], row[1], row[2]))
ctx = ssl._create_unverified_context()
def api(method, path, body=None):
    req = urllib.request.Request(f"https://127.0.0.1:{PORT}/api{path}", method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Authorization": "Bearer " + token, "content-type": "application/json"})
    return json.load(urllib.request.urlopen(req, context=ctx, timeout=30))
core = api("GET", "/core/1")
core["config"] = json.load(open(XRAY))
# Marzban 按用户存 flow，PasarGuard 改为在入站上统一设置；Reality 入站补上 Vision
for inbound in core["config"]["inbounds"]:
    stream = inbound.get("streamSettings", {})
    if inbound["protocol"] == "vless" and stream.get("security") == "reality" and stream.get("network", "tcp") in ("tcp", "raw"):
        inbound["settings"]["flow"] = "xtls-rprx-vision"
body = {k: core[k] for k in ("name", "config", "type", "exclude_inbound_tags", "fallbacks_inbound_tags") if k in core}
out = api("PUT", "/core/1?restart_nodes=true", body)
print("core 1 inbounds:", [i["tag"] for i in out["config"]["inbounds"]])
print("panel inbounds:", api("GET", "/inbounds"))

# Marzban 的 {SERVER_IP} 占位符在 PasarGuard 里解析结果不同，改成固定地址
for host in api("GET", "/hosts"):
    if any("{SERVER_IP}" in a for a in host.get("address") or []):
        host["address"] = [a.replace("{SERVER_IP}", SERVER_IP) for a in host["address"]]
        hid = host.pop("id"); host.pop("status", None)
        print("host", api("PUT", f"/host/{hid}", host)["remark"], "address fixed")

# 可选：登记本机节点
if len(sys.argv) > 5:
    node_name, node_port, cert_file, key_env = sys.argv[5], int(sys.argv[6]), sys.argv[7], sys.argv[8]
    api_key = [l.split("=", 1)[1].strip() for l in open(key_env) if l.startswith("API_KEY=")][0]
    nodes = api("GET", "/nodes")["nodes"]
    # Marzban 时代的旧节点记录没有 API key，修改会被校验拒绝，这里不动它们
    print("existing nodes:", [(n["name"], n["status"]) for n in nodes])
    if not any(n["name"] == node_name for n in nodes):
        created = api("POST", "/node", {"name": node_name, "address": "127.0.0.1", "port": node_port,
            "connection_type": "grpc", "server_ca": open(cert_file).read(), "keep_alive": 60,
            "core_config_id": 1, "api_key": api_key})
        print("node", created["name"], "created:", created["status"])
