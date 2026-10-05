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
      { name: "DMIT-Shadow", type: "vless" }
    ],
    "proxy-groups": [
      { name: "Auto", type: "url-test", proxies: ["DMIT-LA"] },
      { name: "Proxy", type: "select", proxies: ["Auto", "DIRECT"] },
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
    bare.rules.includes("DOMAIN-SUFFIX,claude.ai," + bare.proxies.find(p => p.name === "AWS-US-Clean").name),
    "AI rules must fall back to the injected AWS node when the profile has no AI group"
  );
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
