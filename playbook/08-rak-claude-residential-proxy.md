# Step 8：RAK Claude 住宅代理网桥

更新日期：2026-10-04。本节只描述住宅上游网桥；Claude 和浏览器的运行身份、网络隔离、桌面、备份及完整验收以 [Step 9](09-rak-claude-isolated-runtime.md) 为准。

## 1. 作用与边界

`claude-bridge.service` 在 RAK 主机回环地址监听 HTTP7890 与 SOCKS57891，经带鉴权的住宅SOCKS5上游转发。部署验收时，接入地址为 `48.46.113.162:47940`，实际出口为 `48.46.113.162`，IP元数据报告Comcast。

网桥配置只包含住宅出站和blackhole，没有freedom。该限制只作用于经过此网桥的连接。Claude命名空间没有公网网卡/路由，通过私有UNIX socket接入此网桥；普通大流量Xray继续使用自身公网出站。

不要恢复 `/etc/environment` 或 root `.bashrc` 的全局住宅代理，也不要将普通Xray的freedom出站当成此网桥的配置。住宅IP、时区、Cloudflare节点和HTTP404不能证明账号资格或保证账号不会被封。

## 2. 配置

| 对象 | 路径或服务 |
|---|---|
| 网桥程序 | `/usr/local/bin/claude-xray` |
| Xray资源 | `/usr/local/share/claude-xray/` |
| 上游接入配置及凭据 | `/etc/claude-bridge/config.json` |
| 预期出口、用户与本地代理地址 | `/etc/claude-runtime.json` |
| 主机网桥 | `claude-bridge.service` |
| 隔离环境内代理入口 | `claude-proxy-relay.service` |
| 主机UNIX socket转发 | `claude-http-egress.socket`、`claude-socks-egress.socket` |
| 5分钟健康检查（出口不符时停止 Claude） | `proxy-health-check.timer` |

凭据不写入源码、交接、命令输出或测试报告。网桥配置继续采用受限文件权限。集中配置只保存非秘密参数，守卫与健康探针从中读取同一组预期IP和组织信息。

## 3. 日常验证

在RAK管理SSH会话运行：

```bash
systemctl is-active claude-bridge claude-proxy-relay
proxy-health-check
/usr/local/sbin/claude-exec curl -fsS --max-time 15 https://claude.ai/cdn-cgi/trace
/usr/local/sbin/claude-exec curl -fsS --max-time 15 --proxy socks5h://127.0.0.1:7891 https://ipinfo.io/ip
/usr/local/sbin/claude-exec curl -sSI --max-time 15 https://api.anthropic.com
cat /var/run/claude-proxy-status
```

前两个出口检查应与集中配置一致；trace 返回的 `ip`/`loc` 就是 Anthropic 边缘看到的来源。`socks5h` 把目标域名交给代理解析。Anthropic根路径404只能作为本次请求的可达性证据，不是登录或模型调用成功。

健康状态另有 `/var/run/claude-proxy-status.json`。探针失败返回非零并保存原因，不自动重启桥；仅在确认出口 IP/国家不符时结束运行中的 Claude 与桌面。更换上游时先改集中配置再切桥，否则探针会按不符处置。

## 4. 更换住宅上游

1. 记录当前配置的受限回滚副本，并检查是否有正在运行的Claude任务或授权流程。后续重启住宅桥会中断其连接。
2. 在服务器上更新 `/etc/claude-bridge/config.json` 的上游接入地址、端口和凭据，保持入站回环绑定及无直连出站。
3. 更新 `/etc/claude-runtime.json` 的 `expected_ip`、`expected_country` 与 `expected_org`。供应商接入地址可能与实际出口IP不同，不能直接认为二者相同。
4. 检查配置语法后重启住宅链路的转发服务：

   ```bash
   XRAY_LOCATION_ASSET=/usr/local/share/claude-xray /usr/local/bin/claude-xray run -test -config /etc/claude-bridge/config.json
   systemctl restart claude-bridge.service
   systemctl restart claude-http-egress.service claude-socks-egress.service
   ```

   后两个服务依赖主机桥。显式重启可让命名空间中的后续连接重新接入新桥；无需重启普通大流量Xray。
5. 运行本节日常验证及 `claude --version`。健康探针和启动守卫都应使用新的预期出口。完整模型调用需要已登录账号另行验证。

## 5. 维护限制

上游SOCKS5用户名/密码认证当前没有额外传输加密；要改变这一点，需要供应商提供兼容的加密接入。Anthropic HTTPS内容仍由TLS保护。

部署源码位于 [运行环境源码目录](../configs/server/claude-runtime/README.md)。该目录不含供应商凭据，也不是一键重装器。保持SSH28827、普通Xray、Marzban控制通道和Tailscale的业务边界；故障测试应限定到住宅链路，并准备自动撤销临时故障规则。
