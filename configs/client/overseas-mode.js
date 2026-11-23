// Clash Verge Rev 全局扩展脚本：国内/海外两种所在地模式（新电脑用）
//
// 用法见 CLIENT-GUIDE.md。同一个订阅链接导入两份，名称含“海外”的那份启用时，本脚本：
// 1. 其余网站与大流量改走“海外出口”组（默认直连，个别网站打不开时可临时切到线路选择）；
// 2. Anthropic、OpenAI、Gemini 仍走线路选择，出口留在美国；
// 3. DNS 直接查询境外公共 DNS，不再经代理，CDN 按本地位置返回就近的服务器。
// 名称不含“海外”时原样返回订阅内容。
//
// 本文件不含任何凭据，可以直接粘贴进 Clash Verge。主力电脑使用 Script.js，其中的海外模式与本文件一致，
// Script.test.js 会比对两者的输出。
function main(config, profileName) {
  if (!/海外/.test(String(profileName || ""))) return config;

  const lineGroupName = "线路选择";
  const bulkGroupName = "Bulk-Traffic";
  const overseasGroupName = "海外出口";

  const groups = Array.isArray(config["proxy-groups"]) ? config["proxy-groups"] : [];
  // 不是本项目的统一订阅（没有线路选择组）时不做改动，避免引用不存在的组
  if (!groups.some(group => group && group.name === lineGroupName)) return config;
  config["proxy-groups"] = [{ name: overseasGroupName, type: "select", proxies: ["DIRECT", lineGroupName] }]
    .concat(groups.filter(group => group && group.name !== overseasGroupName));

  if (config.dns) {
    config.dns["respect-rules"] = false;
    config.dns["default-nameserver"] = ["1.1.1.1", "8.8.8.8"];
    config.dns.nameserver = ["https://1.1.1.1/dns-query", "https://8.8.8.8/dns-query"];
    config.dns["proxy-server-nameserver"] = ["https://1.1.1.1/dns-query", "https://8.8.8.8/dns-query"];
  }

  const aiRules = [
    "DOMAIN-SUFFIX,anthropic.com",
    "DOMAIN-SUFFIX,claude.ai",
    "DOMAIN-SUFFIX,claude.com",
    "DOMAIN-SUFFIX,claudeusercontent.com",
    "DOMAIN-SUFFIX,openai.com",
    "DOMAIN-SUFFIX,chatgpt.com",
    "DOMAIN-SUFFIX,oaistatic.com",
    "DOMAIN-SUFFIX,oaiusercontent.com",
    "DOMAIN-SUFFIX,gemini.google.com",
    "DOMAIN-SUFFIX,generativelanguage.googleapis.com",
    "DOMAIN-SUFFIX,aistudio.google.com"
  ].map(rule => rule + "," + lineGroupName);

  const retarget = rule => {
    if (rule.startsWith("MATCH,")) return "MATCH," + overseasGroupName;
    const noResolve = rule.endsWith(",no-resolve");
    const body = noResolve ? rule.slice(0, -",no-resolve".length) : rule;
    if (!body.endsWith("," + bulkGroupName)) return rule;
    return body.slice(0, -bulkGroupName.length) + overseasGroupName + (noResolve ? ",no-resolve" : "");
  };

  const rules = Array.isArray(config.rules) ? config.rules : [];
  config.rules = Array.from(new Set(aiRules.concat(rules.filter(rule => aiRules.indexOf(rule) === -1)).map(retarget)));
  return config;
}
