# Step 0: 环境探测与变量装填 (Pre-check & Environment Setup)

> **目标**：在对服务器执行任何系统级变更前，探测硬件网络环境，检测端口占用，准备保密配置文件。

---

## 1. 操作前检查清单

在本地或操作机执行以下探测命令：

```bash
# 1. 检查 SSH 免密与连接性
ssh -o ConnectTimeout=5 root@<SERVER_IP> "uname -a && lsb_release -d"

# 2. 检查 80 与 443 端口占用情况（严防已有 Web 服务冲突）
ssh root@<SERVER_IP> "ss -tulpn | grep -E ':(80|443)\b'"

# 3. 检查系统架构与可用磁盘
ssh root@<SERVER_IP> "uname -m && df -h /"
```

**准入标准**：
- 操作系统为 Ubuntu 20.04/22.04/24.04 或 Debian 11/12 (x86_64 / arm64)。
- 根目录可用空间 > 5GB。
- TCP/UDP 443 与 TCP 80 端口无阻断性业务占用（如有无用服务需提前停用）。

---

## 2. 准备 `secrets.env`

在本地项目根目录下，复制模板并填入本次交付所需的真实参数：

```bash
cp secrets.example.env secrets.env
chmod 600 secrets.env
```

**参数核对表**：
| 变量名 | 说明 | 示例 |
| :--- | :--- | :--- |
| `SERVER_IP` | 目标 VPS 的外网公网 IPv4 | `198.51.100.1` |
| `DOMAIN_NAME` | 解析至该 VPS 的主域名（申请证书用） | `mz.yourdomain.com` |
| `CF_EMAIL` | 证书申请的提醒邮箱 | `admin@yourdomain.com` |
| `REALITY_DEST` | Xray Reality 伪装目标与端口 | `itunes.apple.com:443` |
| `REALITY_SNI` | Xray Reality 伪装 SNI | `itunes.apple.com` |
| `HY2_PASSWORD` | Hysteria 2 强密码（建议 32 位以上十六进制） | 可用 `openssl rand -hex 32` 生成 |
| `MARZBAN_USER` | Marzban 管理员初始用户名 | `admin` |
| `MARZBAN_PASS` | Marzban 管理员初始密码 | 可用 `openssl rand -base64 16` 生成 |

---

## 3. 门禁验证 (Gate Verification)

执行如下检测指令，确保所有必填字段非空：

```bash
source secrets.env
for var in SERVER_IP DOMAIN_NAME CF_EMAIL HY2_PASSWORD MARZBAN_USER MARZBAN_PASS; do
  if [ -z "${!var:-}" ]; then
    echo "[-] 缺少环境变量: $var，请在 secrets.env 中补全！"
    exit 1
  fi
done
echo "[+] 环境变量预检通过！"
```
