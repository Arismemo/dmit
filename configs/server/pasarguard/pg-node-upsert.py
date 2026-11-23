# 在 PasarGuard 面板容器内运行：按名称登记或更新一个节点。
# 用法：python pg-node-upsert.py <名称> <地址> <端口> <核心配置名> <节点证书> <node.env>
# Marzban 迁移来的旧节点记录没有 API key，修改会被校验拒绝，这种情况下删掉旧记录重建。
import importlib.util, json, sys, urllib.error, urllib.request, ssl
spec = importlib.util.spec_from_file_location("pgapi_lib", "/tmp/pg-api-lib.py")
lib = importlib.util.module_from_spec(spec); spec.loader.exec_module(lib)

name, address, port, core_name, cert_file, env_file = sys.argv[1:7]
api_key = [l.split("=", 1)[1].strip() for l in open(env_file) if l.startswith("API_KEY=")][0]
core_id = [c["id"] for c in lib.api("GET", "/cores")["cores"] if c["name"] == core_name][0]
body = {"name": name, "address": address, "port": int(port), "connection_type": "grpc",
        "server_ca": open(cert_file).read(), "keep_alive": 60, "core_config_id": core_id, "api_key": api_key}

def raw(method, path, data=None):
    req = urllib.request.Request("https://127.0.0.1:39721/api" + path, method=method,
        data=json.dumps(data).encode() if data is not None else None,
        headers={"Authorization": "Bearer " + lib.token, "content-type": "application/json"})
    try:
        return json.load(urllib.request.urlopen(req, context=ssl._create_unverified_context(), timeout=120)), None
    except urllib.error.HTTPError as e:
        return None, f"HTTP {e.code}: {e.read().decode()[:300]}"

existing = [n for n in lib.api("GET", "/nodes")["nodes"] if n["name"] == name]
if existing:
    out, err = raw("PUT", f"/node/{existing[0]['id']}", body)
    if err:
        print("update rejected, recreating:", err)
        lib.api("DELETE", f"/node/{existing[0]['id']}")
        out = lib.api("POST", "/node", body)
else:
    out = lib.api("POST", "/node", body)
print("node", out["name"], "id", out["id"], "core", core_name, "status", out["status"])
