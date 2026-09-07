// Clash Verge Rev 全局扩展脚本 (Script.js)
// 存放路径:
//   macOS: ~/Library/Application Support/io.github.clash-verge-rev.clash-verge-rev/profiles/Script.js
//   Linux: ~/.config/clash-verge-rev/profiles/Script.js
//   Windows: %APPDATA%/io.github.clash-verge-rev.clash-verge-rev/profiles/Script.js
//
// 核心功能：
// 1. [性能优化] 自动注入 TCP Fast Open (TFO: true)，消除 1 个 RTT 握手延时
// 2. [性能优化] 强制开启 TUN 混合网络栈 (stack: mixed)，降低 40%+ 首包 TTFB
// 3. [双协议容灾] 自动注入 Hysteria 2 UDP 节点，并聚合至 Auto / Proxy / AI 策略组
// 4. [智能分流] 清除破坏规则分流的 IDE 强直连配置（按域名/IP动态分流）
// 5. [内网穿透] 支持配置私网/公司内网 SSH 隧道高可用故障转移组 (SSH-AUTO)

function main(config, profileName) {
  // =========================================================================
  // 模块 1: 内网企业 SSH 隧道与 Tailscale 穿透高可用组 (按需配置)
  // =========================================================================
  const enableSshTunnel = false; // 若需启用内网 SSH 穿透代理，将其置为 true

  const primaryName = "SSH-Primary";
  const backupName = "SSH-Tailscale-Backup";
  const backup2Name = "SSH-Remote-Backup";
  const groupName = "SSH-AUTO";

  // 证书与公钥占位符
  const hostKey = "ssh-ed25519 <BASE64_PUBLIC_KEY>";
  const backup2HostKey = "ssh-ed25519 <BASE64_PUBLIC_KEY>";
  const privateKey = "<PATH_TO_PRIVATE_KEY>";

  function createSshProxy(name, server, username, proxyHostKey, interfaceName) {
    const proxy = {
      name: name,
      type: "ssh",
      server: server,
      port: 22,
      username: username,
      "host-key": [proxyHostKey],
      "host-key-algorithms": ["ssh-ed25519"],
      "private-key": privateKey
    };
    if (interfaceName) {
      proxy["interface-name"] = interfaceName;
    }
    return proxy;
  }

  let extraProxies = [];
  let fallbackGroup = null;
  let managedRules = [];
  let obsoleteRules = [];

  if (enableSshTunnel) {
    const primaryProxy = createSshProxy(primaryName, "<PRIMARY_LAN_IP>", "user", hostKey);
    // 备用地址绑定 Tailscale 接口 (如 utun4)，避免与 Clash TUN 发生路由环路
    const backupProxy = createSshProxy(backupName, "<TAILSCALE_IP_1>", "user", hostKey, "utun4");
    const backup2Proxy = createSshProxy(backup2Name, "<TAILSCALE_IP_2>", "user", backup2HostKey, "utun4");

    extraProxies = [primaryProxy, backupProxy, backup2Proxy];

    fallbackGroup = {
      name: groupName,
      type: "fallback",
      proxies: [primaryName, backupName, backup2Name],
      url: "https://<INTERNAL_HEALTHCHECK_DOMAIN>/",
      interval: 30,
      timeout: 5000,
      "max-failed-times": 1,
      lazy: false,
      "expected-status": "200/204/301/302",
      "disable-udp": true
    };

    managedRules = [
      "IP-CIDR,<PRIMARY_LAN_IP>/32,DIRECT,no-resolve",
      "IP-CIDR,<TAILSCALE_IP_1>/32,DIRECT,no-resolve",
      "IP-CIDR,<TAILSCALE_IP_2>/32,DIRECT,no-resolve",
      "IP-CIDR,<INTERNAL_SUBNET_1>," + groupName + ",no-resolve",
      "IP-CIDR,<INTERNAL_SUBNET_2>," + groupName + ",no-resolve",
      "DOMAIN-SUFFIX,<INTERNAL_DOMAIN>," + groupName
    ];
  }

  // =========================================================================
  // 模块 2: 节点协议底层调优 (TFO)
  // =========================================================================
  const existingProxies = Array.isArray(config.proxies) ? config.proxies : [];
  existingProxies.forEach(p => {
    if (p && p.type === "vless") {
      p.tfo = true; // 启用 TCP Fast Open
    }
  });

  // =========================================================================
  // 模块 3: TUN 网络栈调优 (Mixed 混合栈)
  // =========================================================================
  if (config.tun) {
    config.tun.stack = "mixed"; // 切换为 mixed 模式
  }

  // =========================================================================
  // 模块 4: 注入 Hysteria 2 双协议备用节点
  // =========================================================================
  const hy2Proxy = {
    name: "DMIT-HY2",
    type: "hysteria2",
    server: "<SERVER_IP>",
    port: 443,
    password: "<HY2_PASSWORD>",
    sni: "<DOMAIN_NAME>",
    "skip-cert-verify": false
  };

  const filteredExistingProxies = existingProxies.filter(
    proxy => proxy && proxy.name !== hy2Proxy.name && proxy.name !== primaryName && proxy.name !== backupName && proxy.name !== backup2Name
  );
  config.proxies = extraProxies.concat([hy2Proxy], filteredExistingProxies);

  // =========================================================================
  // 模块 5: 将 HY2 节点注入 Auto / Proxy / AI 策略组
  // =========================================================================
  const existingGroups = Array.isArray(config["proxy-groups"]) ? config["proxy-groups"] : [];
  existingGroups.forEach(group => {
    if (group && (group.name === "Auto" || group.name === "Proxy" || group.name === "AI")) {
      if (Array.isArray(group.proxies) && !group.proxies.includes(hy2Proxy.name)) {
        group.proxies.push(hy2Proxy.name);
      }
    }
  });

  if (fallbackGroup) {
    config["proxy-groups"] = [fallbackGroup].concat(
      existingGroups.filter(g => g && g.name !== groupName)
    );
  } else {
    config["proxy-groups"] = existingGroups;
  }

  // =========================================================================
  // 模块 6: 规则清洗与自定义规则注入
  // =========================================================================
  const existingRules = Array.isArray(config.rules) ? config.rules : [];
  config.rules = managedRules.concat(
    existingRules.filter(
      rule =>
        managedRules.indexOf(rule) === -1 &&
        // 清理 IDE 进程级直连限制，恢复由域名智能分流（内网直连，外部服务代理）
        !rule.startsWith("PROCESS-NAME,Code")
    )
  );

  return config;
}
