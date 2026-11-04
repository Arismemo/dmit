# 服务器接入住宅代理手册

本手册介绍如何在 Linux 服务器上使用 Xray 接入住宅代理供应商提供的 SOCKS5 服务。Xray 在服务器本机提供 HTTP 和 SOCKS5 代理端口，应用按需使用这些端口；服务器其他流量仍走原来的网络。

## 1. 准备

向住宅代理供应商获取以下信息：

| 信息 | 说明 |
|---|---|
| 上游地址、端口 | 供应商提供的 SOCKS5 接入地址和端口 |
| 用户名、密码 | 上游代理的认证信息 |
| 预期出口 IP | 可选；接入地址和实际出口 IP 不一定相同 |

确认服务器已经安装 Xray，且有 systemd 和 curl。安装方法和发行包见 [Xray 官方安装说明](https://github.com/XTLS/Xray-install)。如机器已有 Xray 服务，不要直接覆盖现有配置；本手册使用独立服务和配置文件。

下文以本机 HTTP 代理端口 `17890`、SOCKS5 代理端口 `17891` 为例。先检查端口是否已被占用；如果占用，请同时修改配置和后续命令中的端口。

```bash
ss -ltn | grep -E ':(17890|17891)\b' || true
```

## 2. 配置代理桥

以下命令使用 root 权限执行。先创建仅 root 可读取的配置目录：

```bash
install -d -m 700 /etc/residential-proxy
```

使用编辑器新建 `/etc/residential-proxy/config.json`，填入下面内容。将上游地址、端口和账号密码替换为供应商提供的值；真实信息不要提交到 Git，也不要粘贴到公开文档。

```json
{
  "log": { "loglevel": "warning" },
  "inbounds": [
    {
      "listen": "127.0.0.1",
      "port": 17890,
      "protocol": "http",
      "settings": {}
    },
    {
      "listen": "127.0.0.1",
      "port": 17891,
      "protocol": "socks",
      "settings": { "auth": "noauth", "udp": false }
    }
  ],
  "outbounds": [
    {
      "tag": "residential",
      "protocol": "socks",
      "settings": {
        "servers": [{
          "address": "UPSTREAM_HOST",
          "port": 1080,
          "users": [{ "user": "UPSTREAM_USER", "pass": "UPSTREAM_PASSWORD" }]
        }]
      }
    }
  ]
}
```

`UPSTREAM_HOST`、`1080`、`UPSTREAM_USER` 和 `UPSTREAM_PASSWORD` 都是示例，必须替换；带特殊字符的账号密码必须遵循 JSON 字符串转义规则。这里只配置住宅代理出站，不配置直连出站。

```bash
chmod 600 /etc/residential-proxy/config.json
```

确认 Xray 可执行文件路径，并检查配置。若 Xray 不在 `/usr/local/bin/xray`，将下方路径换成实际路径。

```bash
command -v xray
```

```bash
/usr/local/bin/xray run -test -config /etc/residential-proxy/config.json
```

只有配置检查成功后再继续。如果程序提示找不到资源文件，请按安装方式配置 Xray 资源路径。

## 3. 启动并设置开机自启

新建 `/etc/systemd/system/residential-proxy.service`，其中 Xray 路径应与上一步一致：

```ini
[Unit]
Description=Residential SOCKS5 proxy bridge
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/local/bin/xray run -config /etc/residential-proxy/config.json
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload
```

```bash
systemctl enable --now residential-proxy.service
```

```bash
systemctl is-active residential-proxy.service
```

应输出 `active`。检查端口只监听 `127.0.0.1`：

```bash
ss -ltn | grep -E ':(17890|17891)\b'
```

本机代理端口未设置客户端认证，因此不要改为监听 `0.0.0.0` 或直接暴露公网；本机其他用户也可能访问这些端口。

## 4. 验证家宽出口

分别通过 HTTP 和 SOCKS5 代理查询出口 IP：

```bash
curl --fail --silent --show-error --max-time 15 --noproxy '' --proxy http://127.0.0.1:17890 https://ipinfo.io/ip
```

```bash
curl --fail --silent --show-error --max-time 15 --noproxy '' --proxy socks5h://127.0.0.1:17891 https://ipinfo.io/ip
```

两次返回应与供应商提供的**实际出口 IP**一致。`socks5h` 会让代理端解析目标域名。若 IP 查询服务返回 429 或不可用，可换用其他可信的 IP 查询服务，不能把查询失败当成代理故障。

可以用 IP 信息服务核对国家、运营商和网络类型；不同数据库的识别可能不一致，住宅 IP 也不能保证服务商的识别或账号结果。

## 5. 让应用使用代理

对单条命令显式指定代理，例如：

```bash
curl --fail --silent --show-error --noproxy '' --proxy http://127.0.0.1:17890 https://example.com
```

对于支持代理环境变量的程序，可以在当前 shell 设置：

```bash
export HTTP_PROXY=http://127.0.0.1:17890 HTTPS_PROXY=http://127.0.0.1:17890 http_proxy=http://127.0.0.1:17890 https_proxy=http://127.0.0.1:17890 ALL_PROXY=socks5h://127.0.0.1:17891 all_proxy=socks5h://127.0.0.1:17891 NO_PROXY=localhost,127.0.0.1,::1 no_proxy=localhost,127.0.0.1,::1
```

这些变量只对当前 shell 及其子进程生效，并非所有程序都会遵循。要取消，可关闭该 shell，或执行：

```bash
unset HTTP_PROXY HTTPS_PROXY http_proxy https_proxy ALL_PROXY all_proxy NO_PROXY no_proxy
```

**本手册的代理桥不会强制应用使用代理。** 程序若忽略代理配置，仍可能走服务器原有出口；如要求代理故障时绝不直连，还需要单独配置并验证网络隔离或防火墙。

## 6. 排障和维护

| 现象 | 检查方法 |
|---|---|
| 服务未启动 | 查看 `systemctl status residential-proxy.service` 和 `journalctl -u residential-proxy.service` |
| 端口没有监听 | 检查配置语法、Xray 路径和端口占用 |
| 代理请求失败 | 检查上游地址、端口、认证信息和供应商服务状态 |
| 出口 IP 不一致 | 向供应商确认实际出口；上游接入地址可能与出口 IP 不同 |
| IP 查询接口返回 429 | 查询服务限流；更换查询服务或稍后再试 |

更换上游前，先确认是否有正在使用代理的连接。修改配置后先运行第 2 节的配置检查，再重启 `residential-proxy.service` 并重新验证出口；重启会中断正在使用该代理的连接。不要重启服务器上其他 Xray 服务。

住宅上游如果使用普通 SOCKS5 用户名/密码认证，服务器到供应商之间的 SOCKS5 连接本身不提供加密；HTTPS 请求内容仍受 TLS 保护。是否支持加密上游连接应向供应商确认。
