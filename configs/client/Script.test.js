// Run: node configs/client/Script.test.js [optional installed Script.js path]
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function transform(source, config) {
  const context = vm.createContext({});
  vm.runInContext(source, context);
  return JSON.parse(JSON.stringify(context.main(structuredClone(config), "test")));
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
    assert.deepEqual(groups["线路选择"].proxies, ["DMIT", "RAK"]);
    assert.deepEqual(groups.RAK.proxies, ["RAK-HY2", "RAK-CDN"], "RAK line must not reference DMIT nodes");
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
  console.log("PASS:", path, "explicit AI nodes, alias/provider/chain rejection, fail closed, idempotency, non-AI regression, bare profile");
}
