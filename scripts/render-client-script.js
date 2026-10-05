#!/usr/bin/env node
// 客户端 Script.js 渲染安装器
// 用法: node scripts/render-client-script.js [--dry-run] [--force] [--target <path>] [--secrets <path>]
//
// 作用：读取 secrets.env，把 configs/client/Script.js（脱敏模板）渲染成真实配置并安装到 Clash Verge。
// 设计目的：杜绝"把占位符模板直接覆盖本地真实配置"导致私有分流（SSH 隧道 / GitLab-Auto）丢失。
// 三道闸门：
//   1. 渲染后不得残留任何 <PLACEHOLDER>；
//   2. 已启用的私有模块不得被降级关闭（除非 --force）；
//   3. 渲染产物必须通过语法检查与 Script.test.js；
// 安装前自动备份旧文件。

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const flag = name => args.includes(name);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const dryRun = flag("--dry-run");
const force = flag("--force");
const secretsPath = opt("--secrets", path.join(root, "secrets.env"));
const templatePath = path.join(root, "configs/client/Script.js");
const defaultTarget = path.join(
  os.homedir(),
  "Library/Application Support/io.github.clash-verge-rev.clash-verge-rev/profiles/Script.js"
);
const targetPath = opt("--target", defaultTarget);

function fail(message) {
  console.error("❌ " + message);
  process.exit(1);
}

// 解析 KEY=VALUE 形式的 secrets.env，忽略注释与空行，去除首尾引号
function parseEnv(file) {
  if (!fs.existsSync(file)) fail(`找不到 ${file}，请先复制 secrets.example.env 为 secrets.env 并填入真实值`);
  const env = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    env[m[1]] = m[2].replace(/^(["'])(.*)\1$/, "$2");
  }
  return env;
}

const env = parseEnv(secretsPath);
if (!env.CLIENT_UUID && env.UUID) env.CLIENT_UUID = env.UUID;

// 必填项：核心节点参数；可选模块：开关为 true 时其键必须齐全
const coreKeys = ["SERVER_IP", "HY2_PASSWORD", "DOMAIN_NAME", "AWS_SERVER_IP", "RAK_SERVER_IP", "CLIENT_UUID"];
const modules = {
  SSH_TUNNEL_ENABLE: {
    constant: "enableSshTunnel",
    keys: [
      "PRIMARY_LAN_IP", "TAILSCALE_IP_1", "TAILSCALE_IP_2", "SSH_USER_1", "SSH_USER_2",
      "SSH_HOST_KEY_1", "SSH_HOST_KEY_2", "SSH_PRIVATE_KEY_PATH",
      "INTERNAL_SUBNET_1", "INTERNAL_SUBNET_2", "INTERNAL_DOMAIN", "INTERNAL_HEALTHCHECK_DOMAIN"
    ]
  },
  GITLAB_AUTO_ENABLE: {
    constant: "enableGitlabAuto",
    keys: ["GITLAB_DOMAIN", "GITLAB_IP", "GITLAB_SSH_PORT"]
  }
};

const missingCore = coreKeys.filter(k => !env[k]);
if (missingCore.length) fail("secrets.env 缺少必填项: " + missingCore.join(", "));

const enabled = {};
for (const [flagKey, mod] of Object.entries(modules)) {
  enabled[mod.constant] = String(env[flagKey] || "false").toLowerCase() === "true";
  if (enabled[mod.constant]) {
    const missing = mod.keys.filter(k => !env[k]);
    if (missing.length) fail(`${flagKey}=true 但缺少: ${missing.join(", ")}`);
  }
}

// 值将被写入 JS 双引号字符串，禁止出现会破坏语法的字符
const allKeys = new Set([...coreKeys, ...Object.values(modules).flatMap(m => m.keys)]);
for (const k of allKeys) {
  if (env[k] && /["\\\r\n]/.test(env[k])) fail(`${k} 含有引号/反斜杠/换行，无法安全写入脚本`);
}

// 渲染：关闭的模块占位符替换为 "-"（其代码块不会执行），启用与核心项用真实值
let output = fs.readFileSync(templatePath, "utf8");
for (const k of allKeys) {
  output = output.split(`<${k}>`).join(env[k] || "-");
}
for (const [constant, on] of Object.entries(enabled)) {
  output = output.replace(
    new RegExp(`const ${constant} = (?:true|false);`),
    `const ${constant} = ${on};`
  );
}

// 闸门 1: 占位符残留检查
const leftover = [...new Set(output.match(/<[A-Z][A-Z0-9_]{2,}>/g) || [])];
if (leftover.length) fail("渲染后仍有未替换占位符: " + leftover.join(", "));

// 闸门 3: 语法检查 + 行为测试（在临时文件中完成，通过后才落盘）
try {
  new vm.Script(output);
} catch (e) {
  fail("渲染产物语法错误: " + e.message);
}
const tmpFile = path.join(os.tmpdir(), `Script.rendered.${process.pid}.js`);
fs.writeFileSync(tmpFile, output, { mode: 0o600 });
try {
  const test = spawnSync(process.execPath, [path.join(root, "configs/client/Script.test.js"), tmpFile], {
    encoding: "utf8"
  });
  if (test.status !== 0) fail("Script.test.js 未通过:\n" + (test.stdout || "") + (test.stderr || ""));
} finally {
  fs.rmSync(tmpFile, { force: true });
}

// 闸门 2: 降级保护——目标已启用的私有模块，新产物不得关闭
if (fs.existsSync(targetPath)) {
  const current = fs.readFileSync(targetPath, "utf8");
  for (const [constant, on] of Object.entries(enabled)) {
    const wasOn = new RegExp(`const ${constant} = true;`).test(current);
    if (wasOn && !on && !force) {
      fail(`目标当前已启用 ${constant}，新渲染结果会将其关闭。请在 secrets.env 中补齐开关，或确认后加 --force`);
    }
  }
}

const summary = Object.entries(enabled).map(([k, v]) => `${k}=${v}`).join(", ");
if (dryRun) {
  console.log(`✅ 干跑通过（未写入）。模块状态: ${summary}`);
  process.exit(0);
}

if (fs.existsSync(targetPath)) {
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const backup = `${targetPath}.bak-${stamp}-pre-render`;
  fs.copyFileSync(targetPath, backup);
  console.log("📦 已备份旧脚本: " + backup);
}
fs.mkdirSync(path.dirname(targetPath), { recursive: true });
fs.writeFileSync(targetPath, output);
console.log(`✅ 已安装到 ${targetPath}\n   模块状态: ${summary}\n   请在 Clash Verge 中点击"刷新/重载配置"使其生效`);
