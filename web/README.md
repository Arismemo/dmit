# 网络架构图

`public/index.html` 是自建网络架构图的唯一真源，覆盖 DMIT、RAK、AWS 三台海外服务器、本机代理链路、模型服务链路和管理通道。

## 本地预览

直接用浏览器打开 `public/index.html` 即可，页面不依赖任何外部资源。

## 部署

在 Cloudflare Worker 上以静态资源方式托管，自定义域名 `arch.230254.xyz`。

```bash
cd web
wrangler deploy
```

部署后确认输出里出现 `arch.230254.xyz`，再从公网访问一次：

```bash
curl -sI https://arch.230254.xyz | head -3
```

## 什么时候必须改这个文件

网络有下列变动时，先改 `public/index.html`，再重新部署：

- 增删服务器、节点或代理线路
- 改动服务、监听端口、域名、订阅或分流规则
- 改动管理通道（Tailscale 节点、SSH 跳板、隔离环境的转发路径）

页面里只写主机、端口、服务名和线路关系，不写密码、token、私钥和 UUID。

## 注意

- `wrangler.toml` 里 `routes` 必须写在所有 `[section]` 之前。放在 `[assets]` 之后会被解析成 `assets.routes` 而静默失效：部署成功但域名不生效。
- `wrangler deploy` 输出里的资源数量必须随文件改动变化；数量不变说明改动没上去。
- 绑定自定义域名后，确认同一 zone 下的其它站点仍然正常返回 200。
