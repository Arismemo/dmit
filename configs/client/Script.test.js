// Run: node configs/client/Script.test.js [optional installed Script.js path]
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function transform(source, config, profileName = "test") {
  const context = vm.createContext({});
  vm.runInContext(source, context);
  return JSON.parse(JSON.stringify(context.main(structuredClone(config), profileName)));
}

const sources = [__dirname + "/Script.js", ...process.argv.slice(2)];
for (const path of sources) {
  const source = fs.readFileSync(path, "utf8");
  const fixture = {
    proxies: [
      { name: "DMIT-LA", type: "vless" },
      { name: "AWS-US-Clean", type: "vless" },
      { name: "DMIT-Chained", type: "vless", "dialer-proxy": "Proxy" },
      { name: "DMIT-Direct", type: "direct" },
      { name: "DMIT-Shadow", type: "vless" },
      { name: "RAK-Bulk-1T", type: "vless" }
    ],
    "proxy-groups": [
      { name: "Auto", type: "url-test", proxies: ["DMIT-LA"] },
      { name: "Proxy", type: "select", proxies: ["Auto", "RAK-Bulk-1T", "DIRECT"] },
      { name: "DMIT-Shadow", type: "select", proxies: ["Proxy"] },
      { name: "Grok-xAI", type: "select", proxies: ["AWS-US-Clean", "Proxy"] },
      { name: "AI", type: "select", proxies: ["DMIT-LA", "AWS-US-Clean", "Proxy", "Auto", "DIRECT", "RAK-Bulk-1T", "DMIT-Chained", "DMIT-Direct", "DMIT-Shadow", "missing"], use: ["provider"], "include-all": true, "include-all-proxies": true, "include-all-providers": true }
    ],
    rules: ["DOMAIN,example.test,DIRECT", "MATCH,Proxy"]
  };
  const output = transform(source, fixture);
  // 家宽链式节点的拨号链路必须走 DMIT-LA（TCP）：UDP 线路在国内链路常被丢弃，改用 DMIT-HY2 会让家宽整条失效
  const homeSource = source.includes("const enableHomeEgress = false;")
    ? source.replace("const enableHomeEgress = false;", "const enableHomeEgress = true;")
    : source;
  const homeOut = transform(homeSource, fixture);
  for (const proxy of homeOut.proxies.filter(proxy => proxy.name.startsWith("家宽-"))) {
    assert.equal(proxy["dialer-proxy"], "DMIT-LA", "家宽节点必须经 DMIT-LA 拨号");
  }
  const ai = output["proxy-groups"].find(group => group.name === "AI");
  assert.deepEqual(ai.proxies, ["DMIT-LA", "AWS-US-Clean", "DMIT-HY2"]);
  for (const key of ["use", "include-all", "include-all-proxies", "include-all-providers"]) assert.equal(key in ai, false);
  assert.deepEqual(transform(source, output), output, "transform must be idempotent");

  // Compare against the same existing script without the new AI restriction.
  const original = source.replace(/  \/\/ AI groups use explicit DMIT\/AWS nodes only;[\s\S]*?(?=  const mergedGroups =|  config\["proxy-groups"\] = \[fallbackGroup)/, "");
  assert.notEqual(original, source);
  const baseline = transform(original, fixture);
  const withoutAI = config => ({ ...config, "proxy-groups": config["proxy-groups"].filter(group => group.name !== "AI") });
  assert.deepEqual(withoutAI(output), withoutAI(baseline), "all non-AI behavior must remain unchanged");

  const emptyFixture = structuredClone(fixture);
  emptyFixture["proxy-groups"].find(group => group.name === "AI").proxies = undefined;
  const emptyAI = transform(source, emptyFixture)["proxy-groups"].find(group => group.name === "AI");
  assert.deepEqual(emptyAI.proxies, ["REJECT"], "missing safe nodes must fail closed");

  // 订阅既无 AI 组也无 Proxy 组（如 YKKCLOUD）时，注入的规则与组不得引用不存在的策略名
  const bareFixture = {
    proxies: [{ name: "HK-01", type: "vless" }],
    "proxy-groups": [{ name: "YKKCLOUD", type: "select", proxies: ["HK-01", "DIRECT"] }],
    rules: ["MATCH,YKKCLOUD"]
  };
  const bare = transform(source, bareFixture);
  assert.ok(!bare["proxy-groups"].some(group => group.name === "AI"), "no AI group synthesized");
  assert.ok(
    bare.rules.includes("DOMAIN-SUFFIX,grok.com," + bare.proxies.find(p => p.name === "AWS-US-Clean").name),
    "Grok rules must fall back to the injected AWS node when the profile has no Grok-xAI group"
  );
  assert.ok(
    !output.rules.concat(bare.rules).some(rule => /claude|anthropic/i.test(rule)),
    "no Claude/Anthropic rules are injected"
  );

  // DMIT 与 RAK 是互不牵连的两条线路：组内只含本线路节点，停用的 RAK Reality 节点不得残留
  for (const result of [output, bare]) {
    const groups = Object.fromEntries(result["proxy-groups"].map(group => [group.name, group]));
    assert.deepEqual(groups["线路选择"].proxies, ["DMIT", "RAK", "AWS-US-Clean"]);
    assert.deepEqual(groups.RAK.proxies, ["RAK-CDN", "RAK-HY2"], "RAK line must not reference DMIT nodes");
    assert.ok(groups.DMIT.proxies.length && groups.DMIT.proxies.every(name => /^DMIT-/.test(name)), "DMIT line must not reference RAK nodes");
    assert.equal(groups["Bulk-Traffic"].proxies[0], "RAK", "bulk traffic defaults to the RAK line");
    assert.ok(!result.proxies.some(proxy => proxy.name === "RAK-Bulk-1T"), "retired RAK Reality node removed");
    assert.ok(!result["proxy-groups"].some(group => (group.proxies || []).includes("RAK-Bulk-1T")), "no group references the retired node");
    const rak = result.proxies.find(proxy => proxy.name === "RAK-HY2");
    assert.equal(rak.type, "hysteria2");
    for (const key of ["server", "password", "sni", "fingerprint"]) assert.ok(rak[key], `RAK-HY2 must define ${key}`);
    const cdn = result.proxies.find(proxy => proxy.name === "RAK-CDN");
    assert.equal(cdn.network, "ws");
    assert.ok(cdn.tls && cdn.uuid && cdn.servername && cdn["ws-opts"].path && cdn["ws-opts"].headers.Host, "RAK-CDN must define TLS, uuid, SNI, path and Host");
  }
  assert.deepEqual(
    Object.fromEntries(output["proxy-groups"].map(group => [group.name, group])).DMIT.proxies,
    ["DMIT-LA", "DMIT-HY2"],
    "DMIT line prefers Reality and falls back to Hysteria2"
  );
  // 订阅带 DMIT-CDN 时，它排在两个直连节点之后，作为 IP 被封时的兜底
  const cdnFixture = structuredClone(fixture);
  cdnFixture.proxies.push({ name: "DMIT-CDN", type: "vless", network: "ws" });
  const cdnGroups = Object.fromEntries(transform(source, cdnFixture)["proxy-groups"].map(group => [group.name, group]));
  assert.deepEqual(cdnGroups.DMIT.proxies, ["DMIT-LA", "DMIT-HY2", "DMIT-CDN"], "DMIT-CDN is the last resort of the DMIT line");
  for (const name of ["DMIT", "RAK"]) {
    assert.equal(cdnGroups[name].interval, 60, `${name} health check runs every 60 seconds`);
    assert.equal(cdnGroups[name]["max-failed-times"], 2, `${name} rechecks after 2 failed connections`);
  }
  assert.equal(output["proxy-groups"].find(group => group.name === "Proxy").proxies[0], "线路选择", "Proxy defaults to the line selector");
  const known = new Set([
    "DIRECT", "REJECT",
    ...bare.proxies.map(proxy => proxy.name),
    ...bare["proxy-groups"].map(group => group.name)
  ]);
  for (const group of bare["proxy-groups"]) {
    for (const name of group.proxies || []) {
      assert.ok(known.has(name), `group ${group.name} must reference existing target: ${name}`);
    }
  }
  for (const rule of bare.rules) {
    const parts = rule.replace(/,no-resolve$/, "").split(",");
    const isLogic = /^(AND|OR|NOT),/.test(rule);
    const target = isLogic ? parts[parts.length - 1] : parts[0] === "MATCH" ? parts[1] : parts[2];
    assert.ok(known.has(target), `rule must reference existing target: ${rule}`);
  }
  // 已启用的私有模块必须真实产出策略组与规则（防止开关被误关或渲染丢失）
  if (/const enableSshTunnel = true;/.test(source)) {
    assert.ok(output["proxy-groups"].some(group => group.name === "SSH-AUTO"), "SSH-AUTO group must exist");
    assert.ok(output.proxies.some(p => p.type === "ssh"), "ssh proxies must exist");
  }
  if (/const enableGitlabAuto = true;/.test(source)) {
    const gitlab = output["proxy-groups"].find(group => group.name === "GitLab-Auto");
    assert.ok(gitlab, "GitLab-Auto group must exist");
    assert.deepEqual(gitlab.proxies, ["DIRECT", "Proxy"], "GitLab-Auto keeps Proxy fallback when Proxy group exists");
    assert.ok(output.rules.some(r => r.startsWith("AND,((DOMAIN,")), "GitLab SSH direct rule must exist");
  }
  // 海外模式：订阅名称含“海外”时，其余网站与大流量改走默认直连的海外出口组，AI 仍走线路选择，DNS 不经代理
  const overseasFixture = structuredClone(fixture);
  overseasFixture.rules = ["DOMAIN-SUFFIX,youtube.com,Bulk-Traffic", "GEOIP,telegram,Bulk-Traffic,no-resolve", "GEOSITE,CN,DIRECT", "MATCH,线路选择"];
  overseasFixture.dns = { enable: true, "respect-rules": true, nameserver: ["https://1.1.1.1/dns-query"], "default-nameserver": ["223.5.5.5"] };
  const overseas = transform(source, overseasFixture, "liukun-海外");
  const overseasGroups = Object.fromEntries(overseas["proxy-groups"].map(group => [group.name, group]));
  assert.deepEqual(overseasGroups["海外出口"].proxies, ["DIRECT", "线路选择"], "overseas exit defaults to DIRECT");
  assert.equal(overseas.rules[overseas.rules.length - 1], "MATCH,海外出口", "fallback goes to the overseas exit");
  assert.equal(overseas.rules.filter(rule => rule.startsWith("MATCH,")).length, 1, "exactly one MATCH rule");
  assert.ok(!overseas.rules.some(rule => /,Bulk-Traffic(,no-resolve)?$/.test(rule)), "no rule targets the domestic bulk group");
  assert.ok(overseas.rules.includes("GEOIP,telegram,海外出口,no-resolve"), "no-resolve suffix kept when retargeting");
  assert.ok(overseas.rules.includes("DOMAIN-SUFFIX,youtube.com,海外出口"));
  for (const domain of ["anthropic.com", "claude.ai", "openai.com", "chatgpt.com"]) {
    assert.ok(overseas.rules.includes(`DOMAIN-SUFFIX,${domain},线路选择`), `${domain} stays on the proxy line overseas`);
  }
  assert.ok(overseas.rules.includes("DOMAIN-SUFFIX,grok.com,Grok-xAI"), "Grok keeps its dedicated group");
  assert.equal(overseas.dns["respect-rules"], false, "overseas DNS does not go through the proxy");
  assert.deepEqual(overseas.dns["default-nameserver"], ["1.1.1.1", "8.8.8.8"]);
  assert.deepEqual(transform(source, overseas, "liukun-海外"), overseas, "overseas transform must be idempotent");
  const overseasKnown = new Set(["DIRECT", "REJECT", ...overseas.proxies.map(p => p.name), ...overseas["proxy-groups"].map(g => g.name)]);
  for (const rule of overseas.rules) {
    const parts = rule.replace(/,no-resolve$/, "").split(",");
    const isLogic = /^(AND|OR|NOT),/.test(rule);
    const target = isLogic ? parts[parts.length - 1] : parts[0] === "MATCH" ? parts[1] : parts[2];
    assert.ok(overseasKnown.has(target), `overseas rule must reference existing target: ${rule}`);
  }
  // 国内模式不受影响：没有海外出口组，兜底仍走线路选择
  const domestic = transform(source, overseasFixture, "liukun");
  assert.ok(!domestic["proxy-groups"].some(group => group.name === "海外出口"), "domestic mode has no overseas exit");
  assert.equal(domestic.rules[domestic.rules.length - 1], "MATCH,线路选择");
  assert.equal(domestic.dns["respect-rules"], true);

  console.log("PASS:", path, "explicit AI nodes, alias/provider/chain rejection, fail closed, idempotency, non-AI regression, bare profile, overseas mode");
}

// 新电脑用的独立海外脚本（overseas-mode.js）必须与 Script.js 的海外模式一致：AI 规则、DNS、兜底与大流量改向都相同
{
  const standalone = fs.readFileSync(__dirname + "/overseas-mode.js", "utf8");
  const full = fs.readFileSync(__dirname + "/Script.js", "utf8");
  // 结构与统一订阅相同：线路选择、DMIT、RAK、Bulk-Traffic 四个组，局域网直连在前，兜底走线路选择
  const portable = {
    proxies: [{ name: "DMIT-LA", type: "vless" }, { name: "DMIT-HY2", type: "hysteria2" }, { name: "RAK-HY2", type: "hysteria2" }, { name: "RAK-CDN", type: "vless" }],
    "proxy-groups": [
      { name: "线路选择", type: "select", proxies: ["DMIT", "RAK", "RAK-CDN"] },
      { name: "DMIT", type: "fallback", proxies: ["DMIT-LA", "DMIT-HY2"] },
      { name: "RAK", type: "fallback", proxies: ["RAK-HY2", "RAK-CDN"] },
      { name: "Bulk-Traffic", type: "select", proxies: ["RAK", "线路选择"] }
    ],
    dns: { enable: true, "respect-rules": true, nameserver: ["https://1.1.1.1/dns-query"], "default-nameserver": ["223.5.5.5"] },
    rules: ["IP-CIDR,192.168.0.0/16,DIRECT,no-resolve", "DOMAIN-SUFFIX,youtube.com,Bulk-Traffic", "GEOIP,telegram,Bulk-Traffic,no-resolve", "GEOSITE,CN,DIRECT", "GEOIP,CN,DIRECT", "MATCH,线路选择"]
  };
  assert.deepEqual(transform(standalone, portable, "liukun"), portable, "domestic profile is returned unchanged");
  const a = transform(standalone, portable, "海外");
  const b = transform(full, portable, "海外");
  assert.deepEqual(transform(standalone, a, "海外"), a, "standalone overseas transform must be idempotent");
  const aiOf = result => result.rules.filter(rule => rule.endsWith(",线路选择")).sort();
  assert.deepEqual(aiOf(a), aiOf(b), "AI rules match Script.js");
  assert.equal(aiOf(a).length, 11);
  for (const key of ["respect-rules", "default-nameserver", "nameserver", "proxy-server-nameserver"]) {
    assert.deepEqual(a.dns[key], b.dns[key], `dns ${key} matches Script.js`);
  }
  for (const rule of ["DOMAIN-SUFFIX,youtube.com,海外出口", "GEOIP,telegram,海外出口,no-resolve", "IP-CIDR,192.168.0.0/16,DIRECT,no-resolve", "GEOSITE,CN,DIRECT"]) {
    assert.ok(a.rules.includes(rule) && b.rules.includes(rule), `both modes contain ${rule}`);
  }
  assert.equal(a.rules[a.rules.length - 1], "MATCH,海外出口");
  assert.ok(!a.rules.some(rule => /,Bulk-Traffic(,no-resolve)?$/.test(rule)));
  assert.deepEqual(a["proxy-groups"][0], { name: "海外出口", type: "select", proxies: ["DIRECT", "线路选择"] });
  const foreign = { "proxy-groups": [{ name: "YKKCLOUD", type: "select", proxies: ["DIRECT"] }], rules: ["MATCH,YKKCLOUD"] };
  assert.deepEqual(transform(standalone, foreign, "海外"), foreign, "other subscriptions are left alone");
  console.log("PASS: overseas-mode.js matches Script.js overseas mode");
}
