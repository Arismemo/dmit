# Step 6: 客户端接入与端到端健康验收 (Client Setup & End-to-End Verification)

> **目标**：完成客户端（如 Clash Verge Rev）深度调优与导入，并进行首包延迟压测、国际 AI 接口连通性验证以及安全黑洞拦截防线测试。

---

## 1. 客户端配置调优 (Clash Verge Rev)

### 1.1 导入订阅
1. 打开 Clash Verge Rev，进入 **订阅 (Profiles)**；
2. 粘贴在 Step 5 中生成的 `SUB_URL` 订阅地址，点击保存并刷新；
3. 右键订阅卡片，选择 **设为当前 (Use)**。

### 1.2 注入全局扩展脚本 (`Script.js`)
1. 进入 **订阅 (Profiles)** -> 顶部或右键选择 **全局扩展脚本 (Script)**；
2. 将项目根目录下的 `configs/client/Script.js` 内容全量替换粘贴进去；
3. 保存并触发一次刷新。
4. **作用**：
   - 自动为所有 VLESS Reality 节点添加 `tfo: true`；
   - 强制 TUN 网络栈启用 `stack: mixed`；
   - 注入 Hysteria 2 双协议节点至 Auto/Proxy/AI 策略组；
   - 清除 VS Code 强制直连等干扰规则，恢复域名智能分流；
   - [可选] 开启多跳企业内网 SSH-AUTO 故障转移隧道。

### 1.3 注入全局覆写配置 (`Merge.yaml`)
1. 进入 **订阅 (Profiles)** -> 顶部或右键选择 **Merge 覆写配置 (Merge)**；
2. 将项目根目录下的 `configs/client/Merge.yaml` 内容全量替换粘贴进去；
3. 保存并触发刷新。
4. **作用**：
   - 强制 `respect-rules: true` 与国内 DoH 解析；
   - 注入国内金融量化与股票数据源（东方财富、新浪、同花顺等）直连白名单，保证投研系统低延迟且不消耗代理流量。

### 1.4 校验 TUN 网络栈模式
在终端核查当前 TUN 核心运行栈：
```bash
grep "stack:" ~/Library/Application\ Support/io.github.clash-verge-rev.clash-verge-rev/config.yaml
```
确认输出为 `stack: mixed`。

---

## 2. 端到端性能基准压测 (Benchmarks)

在客户端终端执行连通性与首包时间 (TTFB) 实测：

```bash
# 1. 国际 AI 接口首包延迟（Anthropic Claude）
curl -o /dev/null -s -w "HTTP状态: %{http_code} | DNS解析: %{time_namelookup}s | TCP握手: %{time_connect}s | TLS握手: %{time_appconnect}s | 首包响应(TTFB): %{time_starttransfer}s | 总耗时: %{time_total}s\n" https://api.anthropic.com

# 2. OpenAI 接口首包延迟
curl -o /dev/null -s -w "HTTP状态: %{http_code} | DNS解析: %{time_namelookup}s | TCP握手: %{time_connect}s | TLS握手: %{time_appconnect}s | 首包响应(TTFB): %{time_starttransfer}s | 总耗时: %{time_total}s\n" https://api.openai.com/v1/models

# 3. Google 全球出口连通性
curl -o /dev/null -s -w "HTTP状态: %{http_code} | 总耗时: %{time_total}s\n" https://www.google.com/generate_204
```

**性能达标指标**：
- Claude / OpenAI API 的首包 TTFB 应在 **400ms ~ 550ms** 以内（相比优化前 900ms 降低 40% 以上）。
- Google generate_204 延迟稳定在 **180ms ~ 230ms** 以内。

---

## 3. 安全黑洞防御验证 (Blackhole Interception Test)

验证第二层服务端安全黑洞是否生效，防止被滥用导致 VPS 被投诉甚至封机：

```bash
# 1. 模拟通过代理访问国内受阻 IP (例如腾讯云、国内网段)
# 预期：客户端或服务器端直接拒绝连接 (Connection Refused 或 Blocked)
curl -v --proxy socks5h://127.0.0.1:7890 http://119.29.29.29:80 --connect-timeout 3 || echo "[+] 国内回环已被成功拦截！"

# 2. 模拟访问已知广告/黑名单域名
curl -v --proxy socks5h://127.0.0.1:7890 https://adservice.google.com --connect-timeout 3 || echo "[+] 恶意广告域名已被黑洞丢弃！"
```

---

## 4. 服务端综合诊断采样

在服务器端运行巡检脚本：

```bash
scp configs/server/dmit-proxy-sampler.sh root@<SERVER_IP>:/root/sampler.sh
ssh root@<SERVER_IP> "bash /root/sampler.sh"
```

至此，全套节点平台部署完毕，达到生产级高可用。
