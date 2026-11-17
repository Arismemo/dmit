#!/usr/bin/env node
// 生成其他设备可导入的通用 Mihomo 配置（JSON 是 YAML 的兼容格式）。
// 用法：node scripts/render-portable-subscription.js /absolute/output.yaml
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const target = process.argv[2];
if (!target || !path.isAbsolute(target)) throw new Error('请指定仓库外的绝对输出路径');
if (path.resolve(target).startsWith(root + path.sep)) throw new Error('含凭据的配置不能输出到仓库中');
const env = {};
for (const line of fs.readFileSync(path.join(root, 'secrets.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^(["'])(.*)\1$/, '$2');
}
const required = ['SERVER_IP', 'HY2_PASSWORD', 'DOMAIN_NAME', 'RAK_SERVER_IP', 'RAK_HY2_PASSWORD', 'RAK_HY2_SNI', 'RAK_HY2_PIN_SHA256', 'CDN_DOMAIN', 'CDN_PATH', 'RAK_CDN_UUID'];
for (const key of required) if (!env[key]) throw new Error('缺少 ' + key);
// 复用仓库脚本的节点定义和大流量名单，关闭设备专属的 SSH/GitLab 模块。
let source = fs.readFileSync(path.join(root, 'configs/client/Script.js'), 'utf8');
source = source.replace(/const enable(SshTunnel|GitlabAuto) = (true|false);/g, 'const enable$1 = false;');
source = source.replace(/<([A-Z][A-Z0-9_]*)>/g, (_, key) => JSON.stringify(env[key] || '-').slice(1, -1));
const context = vm.createContext({});
vm.runInContext(source, context);
const generated = JSON.parse(JSON.stringify(context.main({ proxies: [], 'proxy-groups': [], rules: [] }, 'portable')));
const names = ['DMIT-HY2', 'RAK-HY2', 'RAK-CDN'];
// 每 60 秒检测一次，实际连接连续失败 2 次立即重测，节点被封后约 1 分钟内切走。
const health = { type: 'fallback', url: 'https://www.gstatic.com/generate_204', interval: 60, timeout: 5000, lazy: false, 'max-failed-times': 2 };
// DMIT-LA（VLESS Reality，TCP）和 DMIT-CDN（VLESS WebSocket，经 Cloudflare 转发）由 Marzban 按用户下发，
// UUID 各用户不同，不能写死在共享模板里，渲染时按名称从 conf.proxies 取出；用户没有对应节点时整段省略。
// DMIT-LA 的主机记录虽已改为 443，这里仍强制写 443：Xray 实际监听回环端口 9444，对外入口是 nginx 的 TCP 443。
// DMIT 故障转移顺序：DMIT-LA → DMIT-HY2 → DMIT-CDN。TCP 与 UDP 互为备用，两者都被封时走 CDN。
const marzbanNodes = [
  { name: 'DMIT-LA', overrides: 'port=443, ' },
  { name: 'DMIT-CDN', overrides: '' }
];
const jinjaVar = name => 'node_' + name.toLowerCase().replace(/[^a-z0-9]/g, '_');
const jinjaHeader = marzbanNodes
  .map(node => `{% set ${jinjaVar(node.name)} = conf.proxies | selectattr('name', 'equalto', '${node.name}') | first %}`)
  .join('\n') + '\n';
const proxyMarker = name => `__PROXY_${name}__`;
const memberMarker = name => `__MEMBER_${name}__`;
// conf.proxies 里的 uuid 是 UUID 对象，tojson 不能直接序列化，先转成字符串。
const replacements = marzbanNodes.flatMap(node => {
  const v = jinjaVar(node.name);
  return [
    [proxyMarker(node.name), `{{ dict(${v}, ${node.overrides}uuid=${v}.uuid | string) | tojson }}`, v],
    [memberMarker(node.name), JSON.stringify(node.name), v]
  ];
});
const config = {
  'mixed-port': 7897, 'allow-lan': false, mode: 'rule', 'log-level': 'info', ipv6: false,
  profile: { 'store-selected': true },
  dns: {
    enable: true, ipv6: false, 'enhanced-mode': 'fake-ip', 'fake-ip-range': '198.18.0.1/16',
    'fake-ip-filter': ['*.lan', '*.local', '*.ts.net'],
    'default-nameserver': ['223.5.5.5', '119.29.29.29'],
    nameserver: ['https://doh.pub/dns-query', 'https://dns.alidns.com/dns-query'],
    'proxy-server-nameserver': ['https://doh.pub/dns-query', 'https://dns.alidns.com/dns-query']
  },
  proxies: [proxyMarker('DMIT-LA'), proxyMarker('DMIT-CDN')].concat(names.map(name => {
    const proxy = generated.proxies.find(p => p.name === name);
    if (!proxy) throw new Error('缺少节点 ' + name);
    return proxy;
  })),
  'proxy-groups': [
    { name: '线路选择', type: 'select', proxies: ['DMIT', 'RAK', 'RAK-CDN'] },
    { name: 'DMIT', ...health, proxies: [memberMarker('DMIT-LA'), 'DMIT-HY2', memberMarker('DMIT-CDN')] },
    { name: 'RAK', ...health, proxies: ['RAK-HY2', 'RAK-CDN'] },
    { name: 'Bulk-Traffic', type: 'select', proxies: ['RAK', '线路选择'] }
  ],
  rules: [
    ...['127.0.0.0/8', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '100.64.0.0/10', '169.254.0.0/16', env.SERVER_IP + '/32', env.RAK_SERVER_IP + '/32'].map(cidr => `IP-CIDR,${cidr},DIRECT,no-resolve`),
    'DOMAIN-SUFFIX,ts.net,DIRECT', 'DOMAIN-SUFFIX,lan,DIRECT', 'DOMAIN-SUFFIX,local,DIRECT',
    ...generated.rules.filter(rule => rule.endsWith(',Bulk-Traffic') || rule.endsWith(',Bulk-Traffic,no-resolve')).filter(rule => !/derp|192\.73\.240|208\.111\.32|209\.177\.144|199\.38\.180|162\.248\.220|45\.159\.96/.test(rule)),
    'GEOSITE,CN,DIRECT', 'GEOIP,CN,DIRECT', 'MATCH,线路选择'
  ]
};
// 输出是 Marzban 的 Jinja2 模板：先按 JSON 序列化，再把占位符换成 Jinja 片段。
// 占位符后面有逗号时，逗号随片段一起放进条件块；位于数组末尾时，前面的逗号放进条件块，
// 这样节点缺失时生成的 JSON 仍然合法。
let output = jinjaHeader + JSON.stringify(config, null, 2) + '\n';
for (const [marker, jinja, v] of replacements) {
  const quoted = JSON.stringify(marker);
  const trailing = new RegExp(quoted + ',(\\s*)', 'g');
  const leading = new RegExp(',(\\s*)' + quoted, 'g');
  const nTrailing = (output.match(trailing) || []).length;
  const nLeading = (output.match(leading) || []).length;
  if (nTrailing === 1) {
    output = output.replace(trailing, (_, space) => `{% if ${v} %}${jinja},{% endif %}${space}`);
  } else if (nTrailing === 0 && nLeading === 1) {
    output = output.replace(leading, (_, space) => `{% if ${v} %},${space}${jinja}{% endif %}`);
  } else {
    throw new Error('模板占位符 ' + marker + ' 的位置不符合预期');
  }
}
fs.writeFileSync(target, output, { mode: 0o600 });
fs.chmodSync(target, 0o600);
console.log('已生成通用订阅模板：DMIT-LA、DMIT-CDN（按用户渲染）+ 3 个共享节点，无设备专属 SSH 配置');
