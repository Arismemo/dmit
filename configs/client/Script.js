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
      "IP-CIDR,100.64.0.0/10,DIRECT,no-resolve",
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
  // 模块 3: TUN 网络栈调优 (Mixed 混合栈 & 路由旁路)
  // =========================================================================
  if (config.tun) {
    config.tun.stack = "mixed"; // 切换为 mixed 模式
    const exclude = Array.isArray(config.tun["route-exclude-address"])
      ? config.tun["route-exclude-address"]
      : [];
    if (!exclude.includes("100.64.0.0/10")) {
      exclude.push("100.64.0.0/10");
    }
    config.tun["route-exclude-address"] = exclude;
  }
  if (config.dns) {
    const fakeIpFilter = Array.isArray(config.dns["fake-ip-filter"])
      ? config.dns["fake-ip-filter"]
      : [];
    if (!fakeIpFilter.includes("*.ts.net")) {
      fakeIpFilter.push("*.ts.net");
    }
    config.dns["fake-ip-filter"] = fakeIpFilter;
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

  const awsProxy = {
    name: "AWS-Reality",
    type: "vless",
    server: "18.188.243.223",
    port: 443,
    uuid: "471ddddf-dca2-4685-8fda-1a6822c4c2c3",
    network: "tcp",
    tls: true,
    udp: true,
    flow: "xtls-rprx-vision",
    "client-fingerprint": "chrome",
    servername: "www.apple.com",
    "reality-opts": {
      "public-key": "U_MBhD54oYLcI_CYKtclrvdsKG0v5UrIVGddr3NxRHM",
      "short-id": "7301c722e60756ab"
    },
    tfo: true
  };

  const rakProxy = {
    name: "RAK-Bulk-1T",
    type: "vless",
    server: "<RAK_SERVER_IP>",
    port: 3389,
    uuid: "<RAK_UUID>",
    network: "tcp",
    tls: true,
    udp: true,
    flow: "xtls-rprx-vision",
    "client-fingerprint": "chrome",
    servername: "apple.com",
    "reality-opts": {
      "public-key": "wAgwdEPwgawxCmpFynh7--GzSEExDnFIDNpPa-T6a14",
      "short-id": "abcd1234"
    },
    tfo: false
  };

  const filteredExistingProxies = existingProxies.filter(
    proxy => proxy && proxy.name !== hy2Proxy.name && proxy.name !== primaryName && proxy.name !== backupName && proxy.name !== backup2Name && proxy.name !== awsProxy.name && proxy.name !== rakProxy.name
  );
  config.proxies = extraProxies.concat([hy2Proxy, awsProxy, rakProxy], filteredExistingProxies);

  // =========================================================================
  // 模块 5: 策略组编排 (Bulk-Traffic 白名单泄洪组与通用策略组)
  // =========================================================================
  const bulkGroupName = "Bulk-Traffic";
  const bulkGroup = {
    name: bulkGroupName,
    type: "select",
    proxies: ["RAK-Bulk-1T", "Proxy", "DIRECT"]
  };

  const existingGroups = Array.isArray(config["proxy-groups"]) ? config["proxy-groups"] : [];
  existingGroups.forEach(group => {
    if (group && (group.name === "Auto" || group.name === "Proxy" || group.name === "AI")) {
      if (Array.isArray(group.proxies)) {
        if (!group.proxies.includes(hy2Proxy.name)) group.proxies.push(hy2Proxy.name);
      }
    }
    // AWS-Reality 仅作为独立手动容灾节点，严禁进入 Auto 自动选优
    if (group && (group.name === "Proxy" || group.name === "AI")) {
      if (Array.isArray(group.proxies)) {
        if (!group.proxies.includes(awsProxy.name)) group.proxies.push(awsProxy.name);
      }
    }
    // RAK-Bulk-1T 注入 Proxy 组作为备选用量；【严格禁止进入 AI 策略组，杜绝风控】
    if (group && group.name === "Proxy") {
      if (Array.isArray(group.proxies)) {
        if (!group.proxies.includes(rakProxy.name)) group.proxies.push(rakProxy.name);
      }
    }
  });

  const mergedGroups = [bulkGroup].concat(
    existingGroups.filter(g => g && g.name !== bulkGroupName)
  );

  if (fallbackGroup) {
    config["proxy-groups"] = [fallbackGroup].concat(
      mergedGroups.filter(g => g && g.name !== groupName)
    );
  } else {
    config["proxy-groups"] = mergedGroups;
  }

  // =========================================================================
  // 模块 6: 规则清洗与大流量白名单规则注入
  // =========================================================================
  const bulkRules = [
    // 1. Telegram 全网段（群视频、无损大文件、媒体流泄洪）
    "GEOIP,telegram," + bulkGroupName + ",no-resolve",
    "DOMAIN-SUFFIX,telegram.org," + bulkGroupName,
    "DOMAIN-SUFFIX,t.me," + bulkGroupName,
    "DOMAIN-SUFFIX,tdesktop.com," + bulkGroupName,
    "DOMAIN-SUFFIX,telegra.ph," + bulkGroupName,
    "DOMAIN-SUFFIX,telesco.pe," + bulkGroupName,
    "IP-CIDR,91.108.4.0/22," + bulkGroupName + ",no-resolve",
    "IP-CIDR,91.108.8.0/22," + bulkGroupName + ",no-resolve",
    "IP-CIDR,91.108.56.0/22," + bulkGroupName + ",no-resolve",
    "IP-CIDR,149.154.160.0/20," + bulkGroupName + ",no-resolve",

    // 2. 视频与高码率流媒体 (YouTube、Netflix、Disney+、Spotify、Twitch、Twitter/Reddit/TikTok 视频)
    "DOMAIN-SUFFIX,googlevideo.com," + bulkGroupName,
    "DOMAIN-SUFFIX,youtube.com," + bulkGroupName,
    "DOMAIN-SUFFIX,ytimg.com," + bulkGroupName,
    "DOMAIN-SUFFIX,youtu.be," + bulkGroupName,
    "DOMAIN-SUFFIX,spotify.com," + bulkGroupName,
    "DOMAIN-SUFFIX,scdn.co," + bulkGroupName,
    "DOMAIN-SUFFIX,twitch.tv," + bulkGroupName,
    "DOMAIN-SUFFIX,ttvnw.net," + bulkGroupName,
    "DOMAIN-SUFFIX,twimg.com," + bulkGroupName,
    "DOMAIN-SUFFIX,nflxvideo.net," + bulkGroupName,
    "DOMAIN-SUFFIX,nflximg.net," + bulkGroupName,
    "DOMAIN-SUFFIX,nflxext.com," + bulkGroupName,
    "DOMAIN-SUFFIX,netflix.com," + bulkGroupName,
    "DOMAIN-SUFFIX,bamgrid.com," + bulkGroupName,
    "DOMAIN-SUFFIX,disneyplus.com," + bulkGroupName,
    "DOMAIN-SUFFIX,v.redd.it," + bulkGroupName,
    "DOMAIN-SUFFIX,tiktokcdn.com," + bulkGroupName,
    "DOMAIN-SUFFIX,byteoversea.com," + bulkGroupName,
    "DOMAIN-SUFFIX,ibytedtos.com," + bulkGroupName,

    // 3. 网络测速类泄洪 (一次测速消耗 1~3GB，强烈阻断走高价 DMIT)
    "DOMAIN-SUFFIX,speedtest.net," + bulkGroupName,
    "DOMAIN-SUFFIX,fast.com," + bulkGroupName,
    "DOMAIN-KEYWORD,ooklaserver," + bulkGroupName,

    // 4. AI 与开源大模型生态 (HuggingFace 权重、Ollama 库、LM Studio、Civitai、Kaggle 等，动辄数十GB)
    "DOMAIN-SUFFIX,huggingface.co," + bulkGroupName,
    "DOMAIN-SUFFIX,hf.space," + bulkGroupName,
    "DOMAIN-SUFFIX,cdn-lfs.huggingface.co," + bulkGroupName,
    "DOMAIN-SUFFIX,cdn-lfs.hf.co," + bulkGroupName,
    "DOMAIN-SUFFIX,ollama.com," + bulkGroupName,
    "DOMAIN-SUFFIX,registry.ollama.ai," + bulkGroupName,
    "DOMAIN-SUFFIX,lmstudio.ai," + bulkGroupName,
    "DOMAIN-SUFFIX,civitai.com," + bulkGroupName,
    "DOMAIN-KEYWORD,civitai," + bulkGroupName,
    "DOMAIN-SUFFIX,kaggle.com," + bulkGroupName,
    "DOMAIN-SUFFIX,kaggleusercontent.com," + bulkGroupName,
    "DOMAIN-SUFFIX,modelscope.cn," + bulkGroupName,
    "DOMAIN-SUFFIX,wandb.ai," + bulkGroupName,

    // 5. 开发者大型依赖源、操作系统与底层镜像
    "DOMAIN-SUFFIX,objects.githubusercontent.com," + bulkGroupName,
    "DOMAIN-SUFFIX,codeload.github.com," + bulkGroupName,
    "DOMAIN-SUFFIX,github-releases.githubusercontent.com," + bulkGroupName,
    "DOMAIN-SUFFIX,ghcr.io," + bulkGroupName,
    "DOMAIN-SUFFIX,pkg-containers.githubusercontent.com," + bulkGroupName,
    "DOMAIN-SUFFIX,download.pytorch.org," + bulkGroupName,
    "DOMAIN-SUFFIX,repo.anaconda.com," + bulkGroupName,
    "DOMAIN-SUFFIX,registry.npmjs.org," + bulkGroupName,
    "DOMAIN-SUFFIX,production.cloudflare.docker.com," + bulkGroupName,
    "DOMAIN-SUFFIX,registry-1.docker.io," + bulkGroupName,
    "DOMAIN-SUFFIX,quay.io," + bulkGroupName,
    "DOMAIN-SUFFIX,registry.k8s.io," + bulkGroupName,
    "DOMAIN-SUFFIX,k8s.gcr.io," + bulkGroupName,
    "DOMAIN-SUFFIX,alpinelinux.org," + bulkGroupName,
    "DOMAIN-SUFFIX,debian.org," + bulkGroupName,
    "DOMAIN-SUFFIX,ubuntu.com," + bulkGroupName,
    "DOMAIN-SUFFIX,files.pythonhosted.org," + bulkGroupName,
    "DOMAIN-SUFFIX,static.crates.io," + bulkGroupName,

    // 6. 跨洋网盘与大文件传输
    "DOMAIN-SUFFIX,drive.google.com," + bulkGroupName,
    "DOMAIN-SUFFIX,googleusercontent.com," + bulkGroupName,
    "DOMAIN-SUFFIX,dropbox.com," + bulkGroupName,
    "DOMAIN-SUFFIX,dropboxapi.com," + bulkGroupName,
    "DOMAIN-SUFFIX,1drv.ms," + bulkGroupName,
    "DOMAIN-SUFFIX,sharepoint.com," + bulkGroupName,
    "DOMAIN-SUFFIX,mega.nz," + bulkGroupName,
    "DOMAIN-SUFFIX,mega.co.nz," + bulkGroupName,
    "DOMAIN-SUFFIX,mediafire.com," + bulkGroupName,
    "DOMAIN-SUFFIX,icloud-content.com," + bulkGroupName,

    // 7. 软件全量更新、系统大固件与日志高频隐患
    "DOMAIN-SUFFIX,download.jetbrains.com," + bulkGroupName,
    "DOMAIN-SUFFIX,vscode.download.prss.microsoft.com," + bulkGroupName,
    "DOMAIN-SUFFIX,vscode-cdn.net," + bulkGroupName,
    "DOMAIN-SUFFIX,visualstudio.com," + bulkGroupName,
    "DOMAIN-SUFFIX,updates.cdn-apple.com," + bulkGroupName,
    "DOMAIN-SUFFIX,appldnld.apple.com," + bulkGroupName,
    "DOMAIN-SUFFIX,swcdn.apple.com," + bulkGroupName,
    "DOMAIN-SUFFIX,mzstatic.com," + bulkGroupName,
    "DOMAIN-SUFFIX,itunes.apple.com," + bulkGroupName,
    "DOMAIN-SUFFIX,orbstack.dev," + bulkGroupName,
    "DOMAIN-SUFFIX,whatsapp.net," + bulkGroupName,
    "DOMAIN-SUFFIX,vercel-storage.com," + bulkGroupName,

    // 8. 游戏平台大客户端与大型更新下载
    "DOMAIN-SUFFIX,steamcontent.com," + bulkGroupName,
    "DOMAIN-SUFFIX,steamstatic.com," + bulkGroupName,
    "DOMAIN-SUFFIX,steampowered.com," + bulkGroupName,
    "DOMAIN-SUFFIX,epicgames.com," + bulkGroupName,
    "DOMAIN-SUFFIX,unrealengine.com," + bulkGroupName,
    "DOMAIN-SUFFIX,ea.com," + bulkGroupName
  ];

  const existingRules = Array.isArray(config.rules) ? config.rules : [];
  config.rules = managedRules.concat(
    bulkRules,
    existingRules.filter(
      rule =>
        managedRules.indexOf(rule) === -1 &&
        bulkRules.indexOf(rule) === -1 &&
        // 清理 IDE 进程级直连限制，恢复由域名智能分流（内网直连，外部服务代理）
        !rule.startsWith("PROCESS-NAME,Code") &&
        // 清理历史残留的私有 GitLab 走 Proxy 错误规则（避免境内自建服务被强行代理）
        !rule.includes("gitlab.709970.xyz,Proxy")
    )
  );

  return config;
}
