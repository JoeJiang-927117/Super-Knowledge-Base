# Code Signing Certificate / 代码签名证书

[English](#english) | [简体中文](#简体中文)

---

<a id="english"></a>

## English

This directory contains the **public code-signing certificate** (`zhixu-codesign.cer`) for verifying self-signed Windows builds of **知序 · ZHIXU** in internal / enterprise deployments.

> **Security Note**: Private keys (`.pfx` / `.p12` / `.key`) are strictly excluded via `.gitignore` and are never committed to this repository.

### Certificate Details

| Field | Value |
| :--- | :--- |
| **Subject** | `CN=ZHIXU (Felix Joe), O=ZHIXU Open Source, C=CN` |
| **Algorithm** | RSA 4096-bit / SHA-256 Authenticode |
| **Validity** | `2026-11-25` – `2031-11-25` |
| **Thumbprint (SHA-1)** | `252C0ECD64B70B122EF0FEF369120D624B1175D2` |
| **File SHA-256 (`zhixu-codesign.cer`)** | `F965FD3351C1DC3C971D786FB39BDFAE6B0BE2F86BDFED6AF5E7DDEFFFA15B5B` |

### Verifying a Signed Binary (Windows)

```powershell
Get-AuthenticodeSignature ".\知序 ZHIXU.exe" | Format-List Status, SignerCertificate, TimeStamperCertificate
```

### Trusting in Enterprise / Intranet Environments

For internal Windows deployment, administrators may import `certs/zhixu-codesign.cer` into **Trusted Root Certification Authorities** and **Trusted Publishers** (via Group Policy or PowerShell):

```powershell
Import-Certificate -FilePath ".\certs\zhixu-codesign.cer" -CertStoreLocation Cert:\CurrentUser\TrustedPublisher
Import-Certificate -FilePath ".\certs\zhixu-codesign.cer" -CertStoreLocation Cert:\CurrentUser\Root
```

### Signing Local Builds or Using a Commercial OV/EV CA Certificate

- **Local self-signed build**:
  ```powershell
  powershell -ExecutionPolicy Bypass -File .\scripts\sign-windows.ps1 -TargetPath ".\release\win-unpacked\知序 ZHIXU.exe"
  ```
- **Commercial CA / CI release (`electron-builder`)**:
  Set `CSC_LINK` (path or base64 `.pfx`) and `CSC_KEY_PASSWORD` before running `npm run package`.

---

<a id="简体中文"></a>

## 简体中文

本目录包含 **知序 · ZHIXU** 的**公开代码签名证书**（`zhixu-codesign.cer`），用于校验自签名 Windows 客户端的发布者身份与文件完整性（适用于内网与企业自部署分发）。

> **安全说明**：签名私钥（`.pfx` / `.p12` / `.key`）已通过 `.gitignore` 严格隔离，绝不提交至代码仓库。

### 证书信息

| 字段 | 内容 |
| :--- | :--- |
| **证书主体 (Subject)** | `CN=ZHIXU (Felix Joe), O=ZHIXU Open Source, C=CN` |
| **密钥与算法** | RSA 4096-bit / SHA-256 Authenticode |
| **有效期** | `2026-11-25` 至 `2031-11-25` |
| **指纹 (SHA-1)** | `252C0ECD64B70B122EF0FEF369120D624B1175D2` |
| **证书文件 SHA-256** | `F965FD3351C1DC3C971D786FB39BDFAE6B0BE2F86BDFED6AF5E7DDEFFFA15B5B` |

### 校验已签名客户端

```powershell
Get-AuthenticodeSignature ".\知序 ZHIXU.exe" | Format-List Status, SignerCertificate, TimeStamperCertificate
```

### 企业 / 局域网环境信任导入

企业 IT 可通过组策略（GPO）或以下命令将 `certs/zhixu-codesign.cer` 导入终端信任库：

```powershell
Import-Certificate -FilePath ".\certs\zhixu-codesign.cer" -CertStoreLocation Cert:\CurrentUser\TrustedPublisher
Import-Certificate -FilePath ".\certs\zhixu-codesign.cer" -CertStoreLocation Cert:\CurrentUser\Root
```

### 签名本地构建 / 切换商业 CA 证书

- **本机构建签名**：
  ```powershell
  powershell -ExecutionPolicy Bypass -File .\scripts\sign-windows.ps1 -TargetPath ".\release\win-unpacked\知序 ZHIXU.exe"
  ```
- **商业 OV/EV 证书正式分发（`electron-builder`）**：
  在执行 `npm run package` 前配置环境变量 `CSC_LINK`（`.pfx` 路径或 Base64）与 `CSC_KEY_PASSWORD` 即可自动完成商业签名。
