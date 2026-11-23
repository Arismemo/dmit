# 在 PasarGuard 面板容器内运行：把 AWS、DMIT-HY2、RAK 三处线路收进面板（幂等，可重复执行）。
# 用法：python pg-setup-lines.py <spec.json>
# spec 由 DMIT 上的 build-lines-spec.py 生成，含共享凭据，用完即删。
#
# 做的事：
#   1. 建核心配置 AWS / DMIT-HY2 / RAK（同名已存在则更新）；
#   2. 建主机（订阅里的节点条目），新建时先停用，节点切换完成后再用 --enable 启用；
#   3. 建共享凭据用户 shared-dmit、shared-rak，凭据等于原来独立服务的共享口令，Mac 脚本与旧订阅不用改；
#   4. 把新入站加进 group1，6 个原有用户可以用自己的凭据走这些线路。
import json, sys
sys.path.insert(0, "/tmp")
import importlib.util
spec_api = importlib.util.spec_from_file_location("pgapi_lib", "/tmp/pg-api-lib.py")
lib = importlib.util.module_from_spec(spec_api); spec_api.loader.exec_module(lib)
api = lib.api

spec = json.load(open(sys.argv[1]))
enable = "--enable" in sys.argv

cores = {c["name"]: c["id"] for c in api("GET", "/cores")["cores"]}
for core in spec["cores"]:
    body = {"name": core["name"], "type": "xray", "config": core["config"], "exclude_inbound_tags": [], "fallbacks_inbound_tags": []}
    if core["name"] in cores:
        api("PUT", f"/core/{cores[core['name']]}?restart_nodes=true", body)
        print("core updated:", core["name"], cores[core["name"]])
    else:
        cores[core["name"]] = api("POST", "/core", body)["id"]
        print("core created:", core["name"], cores[core["name"]])

hosts = {h["remark"]: h for h in api("GET", "/hosts")}
for host in spec["hosts"]:
    if host["remark"] in hosts:
        cur = hosts[host["remark"]]
        if enable and cur.get("is_disabled"):
            cur["is_disabled"] = False
            hid = cur.pop("id"); cur.pop("status", None)
            api("PUT", f"/host/{hid}", cur); print("host enabled:", host["remark"])
        continue
    body = dict(host, is_disabled=not enable)
    print("host created:", api("POST", "/host/", body)["remark"], "disabled" if not enable else "enabled")

groups = {g["name"]: g for g in api("GET", "/groups")["groups"]}
for name, tags in spec["groups"].items():
    if name in groups:
        g = groups[name]
        merged = sorted(set(g["inbound_tags"]) | set(tags))
        if merged != sorted(g["inbound_tags"]):
            api("PUT", f"/group/{g['id']}", {"name": name, "inbound_tags": merged}); print("group updated:", name, merged)
    else:
        groups[name] = api("POST", "/group", {"name": name, "inbound_tags": tags}); print("group created:", name, tags)

users = {u["username"] for u in api("GET", "/users?limit=500")["users"]}
for user in spec["users"]:
    if user["username"] in users:
        continue
    body = {"username": user["username"], "status": "active", "data_limit": 0, "note": user["note"],
            "proxy_settings": user["proxy_settings"], "group_ids": [groups[g]["id"] for g in user["groups"]]}
    print("user created:", api("POST", "/user", body)["username"])
print("cores:", cores)
