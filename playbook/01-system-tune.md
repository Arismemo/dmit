# Step 1: 系统内核层调优 (System & Kernel Tuning)

> **目标**：在 Linux 内核层启用 BBR 拥塞控制、FQ 队列、双向 TCP Fast Open 及长肥管道套接字缓存，大幅降低握手时延与弱网丢包抖动。

---

## 1. 原理与调优说明

- **BBR + FQ**：Google BBR 拥塞控制算法通过实时估算链路的最小往返时间 (RTT) 与最大瓶颈带宽 (BtlBw) 发包，摆脱传统丢包拥塞控制 (Cubic) 在跨境弱网高丢包时的断崖式降速。配合 Fair Queue (FQ) 实现微突发整形。
- **TCP Fast Open (`tcp_fastopen = 3`)**：允许客户端在首次握手 SYN 包中直接携带 HTTP 请求数据（Cookie 认证），将三次握手缩减为单次往返（节省 1 个完整的 RTT，在跨洋 150ms 延迟下直接节约 150ms 首包耗时）。数值 `3` 代表同时开启客户端和服务端 TFO。
- **套接字缓冲区 (16MB)**：根据带宽延迟积公式（BDP = Bandwidth × RTT），针对 1Gbps 端口在 150ms 延时下的管道，默认的 2MB 接收窗极易被打满引起丢包重传。调优至 16MB 可跑满跨洋千兆带宽。

---

## 2. 施工执行

将配置模板推送至远程目标服务器并加载生效：

```bash
# 1. 确保目标目录存在并上传配置
scp configs/server/sysctl.d-99-custom.conf root@<SERVER_IP>:/etc/sysctl.d/99-custom.conf

# 2. 立即全量重载内核配置
ssh root@<SERVER_IP> "sysctl --system"
```

---

## 3. 门禁验证 (Gate Verification)

在服务器端依次检查关键内核参数：

```bash
ssh root@<SERVER_IP> "
  echo -n 'TCP 拥塞算法: ' && sysctl -n net.ipv4.tcp_congestion_control
  echo -n '队列调度器: ' && sysctl -n net.core.default_qdisc
  echo -n 'TCP Fast Open: ' && sysctl -n net.ipv4.tcp_fastopen
  echo -n '读缓冲上限: ' && sysctl -n net.ipv4.tcp_rmem
"
```

**验收标准**：
- `tcp_congestion_control` 输出必须为 `bbr`。
- `default_qdisc` 输出必须为 `fq`。
- `tcp_fastopen` 输出必须为 `3`。
- `tcp_rmem` 最大值必须包含 `16777216`。
