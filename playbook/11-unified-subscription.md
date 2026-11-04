# Marzban 统一订阅

2026-10-27：恢复使用 Marzban 的原有用户订阅地址，统一下发 DMIT-HY2、RAK-HY2、RAK-CDN。已用 liukun 的原地址和 Clash.Meta User-Agent 实际下载，Mihomo 配置校验通过。

## 当前行为

- 订阅包含线路选择、DMIT、RAK、Bulk-Traffic 分组。
- 不包含旧 RAK Reality、AWS 节点、本机 SSH 私钥路径或公司专属配置。
- DMIT 和 RAK 的独立服务继续运行；RAK 的旧 Marzban 节点保持 disabled。
- 本次更新的是 Clash 模板，未改其他客户端格式的模板。
- 三个节点使用共享凭据。Marzban 提供订阅入口，不负责它们的逐用户流量统计、限额和停用联动；已获取节点凭据的用户不会因为面板禁用而立即失去访问能力。

## 维护

通用配置由 `scripts/render-portable-subscription.js` 从本机 `secrets.env` 和客户端脚本生成。`configs/server/portable-clash.json` 是脱敏结构快照；旧 `configs/server/custom-clash.yml` 仍有其他工作中的改动，本次未覆盖，不能直接重新部署旧模板。

生成配置：

```bash
node scripts/render-portable-subscription.js /tmp/portable-clash.yaml
```

生成文件含凭据，权限应保持 0600。核对三条节点和路由、使用 Mihomo 校验后，备份并替换 DMIT 的 `/var/lib/marzban/templates/clash/custom.yml`。Marzban 的 Jinja2 文件加载器会重新读取模板，无需重启代理。然后用现有用户订阅地址和 Clash.Meta User-Agent 验证实际响应。

线上模板备份命名为 `custom.yml.bak-unified-*`。回滚时恢复该备份并再次验证订阅。

之前新增的 RAK 静态订阅地址暂时保留兼容；新设备优先使用 Marzban 原订阅地址。手机端原导入文件不受此次更新影响，手机实际导入和证书指纹支持仍需在设备上验收。

## 手机端的机制与当前状态

Shadowrocket 把"订阅"和"配置"分开管：

| 手机上的操作 | 更新的内容 |
|---|---|
| 更新订阅 | 只更新节点列表，更新不了规则 |
| 更新远程配置 | 更新规则、DNS 和策略组 |

因此手机端的规则要单独走一份 `.conf`（[configs/client/shadowrocket.conf](../configs/client/shadowrocket.conf)），第一次要用文件导入一次，之后对这份配置点更新即可。

这份 `.conf` 不能并入云端 Clash 模板，原因有两个：Marzban 按 User-Agent 决定返回的格式，`custom-clash.yml` 只在 Clash 类客户端拉取时才渲染；模板里的 `TAILSCALE` 策略只有 Shadowrocket 认，Clash Verge 遇到会解析失败，所以电脑端只能用 `DIRECT`。这一条是根据 Marzban 的机制推断的，没有用 Shadowrocket 的标识实际拉一遍验证。

当前未完成项（2026-10-27 之后没有进展）：

- 手机停在空的"添加节点"页面。新节点不在订阅里，手机拉不到订阅；需要先手工导入一个可用节点建立连接，再刷新订阅。导入链接与配置生成在 Mac 的"下载"文件夹，含凭据，用完应删除。
- `RAK-HY2` 在手机上是否支持链接里的证书指纹参数（`pinSHA256`）没有在真机上验证过。
- `RAK-CDN` 在部署完成时延迟 196/222 ms，之后多轮测速超时，一直没有复测。

另外，手机订阅里拿不到只写在 Clash 模板里的节点，需要手工添加；如果某个策略组是空的，说明手机上的节点名不匹配配置的分组正则。
