# Security Policy / 安全策略

## Default Security Baseline / 默认安全基线

- **Local Loopback Binding**: The HTTP server binds `127.0.0.1` by default (`ZHIXU_HOST`).
- **Mandatory Bearer Authentication**: Protected HTTP endpoints require a Bearer token (`ZHIXU_SERVER_TOKEN` or admin session token); when unset, a 256-bit cryptographically random token is generated at startup.
- **Credential Hygiene**: Default admin account is `zhixu` / `123456789` for initial setup only. Change it immediately in **Admin Console → Accounts** or override via `ZHIXU_ADMIN_USER` / `ZHIXU_ADMIN_PASSWORD`.
- **Password Storage**: Salted `scrypt` hashes with constant-time `timingSafeEqual` verification.
- **AI Destructive Action Guard**: AI suggestions to delete pages are intercepted into `pending_delete` approval and Recycle Bin rather than hard-deleted.
- **Code Signing**: Official Windows releases can be verified against the public certificate in [`certs/zhixu-codesign.cer`](./certs/zhixu-codesign.cer) (see [`certs/README.md`](./certs/README.md)).

## Reporting a Vulnerability / 漏洞报告

- Please do **not** open a public GitHub issue for security vulnerabilities.
- Report via GitHub Private Vulnerability Reporting (**Security → Advisories → Report a vulnerability**) or email `jiangjoe02@gmail.com`.
- Include reproduction steps, affected version/commit, and potential impact. We aim to acknowledge reports within 48 hours.
