# 在 DMIT 宿主机上运行：生成 pg-setup-lines.py 用的 spec（含共享凭据，权限 600，用完删除）。
# 用法：build-lines-spec.py <AWS 旧 xray 配置> <RAK 的 xray-rak 配置> <输出路径> <RAK HY2 证书> <私钥>  < secrets.json
# secrets.json 由本机从 secrets.env 取值后经 stdin 传入，不落盘到仓库。
import copy, json, os, sys

aws_src, rak_src, out, rak_cert, rak_key = sys.argv[1:6]
s = json.load(sys.stdin)
dmit_core = json.load(open("/var/lib/pasarguard/xray_config.json"))

# AWS：沿用 9 月同步到 AWS 的旧 Reality 身份（Mac 脚本里写死了公钥与 short-id），对外监听 443
old = json.load(open(aws_src))
aws_in = copy.deepcopy([i for i in old["inbounds"] if i["streamSettings"].get("security") == "reality"][0])
aws_in.update(tag="AWS-US-Clean", listen="0.0.0.0", port=443)
aws_in["settings"] = {"clients": [], "decryption": "none", "flow": "xtls-rprx-vision"}
aws = {"log": {"loglevel": "warning"}, "inbounds": [aws_in], "outbounds": old["outbounds"], "routing": old["routing"]}

# DMIT-HY2：接替独立的 hysteria-server，证书与 SNI 不变；需要 Xray 26，单独一个节点承载
hy2_tls = {"alpn": ["h3"], "rejectUnknownSni": True, "certificates": [{
    "certificateFile": f"/etc/letsencrypt/live/{s['DOMAIN_NAME']}/fullchain.pem",
    "keyFile": f"/etc/letsencrypt/live/{s['DOMAIN_NAME']}/privkey.pem"}]}
dmit_hy2 = {"log": {"loglevel": "warning"},
    "inbounds": [{"tag": "DMIT-HY2", "listen": "0.0.0.0", "port": 443, "protocol": "hysteria",
        "settings": {"version": 2, "users": []},
        "streamSettings": {"network": "hysteria", "security": "tls", "tlsSettings": hy2_tls, "hysteriaSettings": {"version": 2}}}],
    "outbounds": [{"protocol": "freedom", "tag": "DIRECT", "streamSettings": {"sockopt": {"domainStrategy": "UseIPv4"}}},
                  {"protocol": "blackhole", "tag": "BLOCK"}],
    "routing": dmit_core["routing"]}

# RAK：接替 hysteria-rak 与 xray-rak。证书沿用原文件，指纹不变；伪装与访问控制按原配置复刻
rak_old = json.load(open(rak_src))
cdn_in = copy.deepcopy([i for i in rak_old["inbounds"] if i["streamSettings"]["network"] == "ws"][0])
cdn_in["tag"] = "RAK-CDN"; cdn_in["settings"] = {"clients": [], "decryption": "none"}
rak_hy2_in = {"tag": "RAK-HY2", "listen": "0.0.0.0", "port": 443, "protocol": "hysteria",
    "settings": {"version": 2, "users": []},
    "streamSettings": {"network": "hysteria", "security": "tls",
        # 面板建核心配置时会在面板所在机器上检查证书文件，RAK 的证书不在 DMIT，所以直接内嵌证书内容
        "tlsSettings": {"alpn": ["h3"], "certificates": [{"certificate": open(rak_cert).read().strip().splitlines(), "key": open(rak_key).read().strip().splitlines()}]},
        "hysteriaSettings": {"version": 2, "masquerade": {"type": "proxy", "url": "https://www.bing.com", "rewriteHost": True}}}}
rak_routing = copy.deepcopy(rak_old["routing"])
first = rak_routing["rules"][0]
assert first["outboundTag"] == "block" and "100.64.0.0/10" in first["ip"], "RAK 原路由规则结构变了，先人工核对"
# 原 hysteria 访问控制里单独拒绝了回环地址，这里显式补上
first["ip"] = list(dict.fromkeys(first["ip"] + ["127.0.0.0/8", "::1/128"]))
rak = {"log": {"loglevel": "warning"}, "inbounds": [rak_hy2_in, cdn_in], "outbounds": rak_old["outbounds"], "routing": rak_routing}

spec = {
  "cores": [{"name": "AWS", "config": aws}, {"name": "DMIT-HY2", "config": dmit_hy2}, {"name": "RAK", "config": rak}],
  "hosts": [
    {"remark": "DMIT-HY2", "address": [s["SERVER_IP"]], "port": 443, "inbound_tag": "DMIT-HY2", "sni": [s["DOMAIN_NAME"]],
     "security": "tls", "alpn": ["h3"], "priority": 6},
    {"remark": "RAK-CDN", "address": [s["CDN_DOMAIN"]], "port": 443, "inbound_tag": "RAK-CDN", "sni": [s["CDN_DOMAIN"]],
     "host": [s["CDN_DOMAIN"]], "path": s["CDN_PATH"], "security": "tls", "fingerprint": "chrome", "priority": 7},
    {"remark": "RAK-HY2", "address": [s["RAK_SERVER_IP"]], "port": 443, "inbound_tag": "RAK-HY2", "sni": [s["RAK_HY2_SNI"]],
     "security": "tls", "alpn": ["h3"], "pinned_peer_cert_sha256": s["RAK_HY2_PIN_SHA256"], "priority": 8},
    {"remark": "AWS-US-Clean", "address": [s["AWS_SERVER_IP"]], "port": 443, "inbound_tag": "AWS-US-Clean", "sni": ["apple.com"],
     "security": "inbound_default", "fingerprint": "chrome", "priority": 9}],
  "groups": {"group1": ["DMIT-HY2", "RAK-CDN", "RAK-HY2", "AWS-US-Clean"],
             "shared-dmit": ["DMIT-HY2"], "shared-rak": ["RAK-HY2", "RAK-CDN"]},
  "users": [
    {"username": "shared-dmit", "groups": ["shared-dmit"], "note": "DMIT-HY2 共享口令，供 Mac 脚本与统一订阅里的共享节点使用",
     "proxy_settings": {"hysteria": {"auth": s["HY2_PASSWORD"]}}},
    {"username": "shared-rak", "groups": ["shared-rak"], "note": "RAK-HY2 与 RAK-CDN 共享凭据，供 Mac 脚本与统一订阅里的共享节点使用",
     "proxy_settings": {"hysteria": {"auth": s["RAK_HY2_PASSWORD"]}, "vless": {"id": s["RAK_CDN_UUID"]}}}],
}
fd = os.open(out, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
with os.fdopen(fd, "w") as f: json.dump(spec, f)
print("spec 已生成：核心", [c["name"] for c in spec["cores"]], "主机", [h["remark"] for h in spec["hosts"]],
      "RAK 入站", [i["tag"] for i in rak["inbounds"]], "AWS sni", aws_in["streamSettings"]["realitySettings"]["serverNames"])
