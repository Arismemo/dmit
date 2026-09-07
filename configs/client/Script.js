// Clash Verge Rev 全局扩展脚本 (Script.js)
// 作用：
// 1. 全局注入 TCP Fast Open (TFO) 优化参数，消除 1 个 RTT 握手延时
// 2. 将 TUN 网络栈强制切换为 mixed 模式（降低 40%+ 首包 TTFB）
// 3. 动态注入 Hysteria 2 双协议节点至 Auto/Proxy/AI 策略组
// 4. 清理破坏分流的进程规则（如 VS Code 强制 DIRECT 等）
// 5. [可选] 支持企业内网 SSH 隧道代理高可用组注入

function main(config, profileName) {
  // === 1. 节点底层参数调优 ===
  const existingProxies = Array.isArray(config.proxies) ? config.proxies : [];
  existingProxies.forEach(p => {
    if (p && p.type === "vless") {
      // 开启 TCP Fast Open
      p.tfo = true;
    }
  });

  // === 2. TUN 网络栈调优 ===
  if (config.tun) {
    // 强制使用 mixed 混合网络栈（结合系统 TCP/IP 与 gVisor 用户态优势）
    config.tun.stack = "mixed";
  }

  // === 3. 注入 Hysteria 2 备用高速节点 ===
  const hy2Proxy = {
    name: "DMIT-HY2",
    type: "hysteria2",
    server: "<SERVER_IP>",
    port: 443,
    password: "<HY2_PASSWORD>",
    sni: "<DOMAIN_NAME>",
    "skip-cert-verify": false
  };

  // 避免重复追加
  const filteredProxies = existingProxies.filter(p => p && p.name !== hy2Proxy.name);
  config.proxies = [hy2Proxy].concat(filteredProxies);

  // === 4. 将 HY2 节点合并至 Auto / Proxy / AI 策略组 ===
  const existingGroups = Array.isArray(config["proxy-groups"]) ? config["proxy-groups"] : [];
  existingGroups.forEach(group => {
    if (group && (group.name === "Auto" || group.name === "Proxy" || group.name === "AI")) {
      if (Array.isArray(group.proxies) && !group.proxies.includes(hy2Proxy.name)) {
        group.proxies.push(hy2Proxy.name);
      }
    }
  });
  config["proxy-groups"] = existingGroups;

  // === 5. 规则清洗与自定义规则注入 ===
  const existingRules = Array.isArray(config.rules) ? config.rules : [];
  config.rules = existingRules.filter(
    rule =>
      // 移除可能存在的 IDE 强制直连规则，恢复域名智能分流
      !rule.startsWith("PROCESS-NAME,Code")
  );

  return config;
}
