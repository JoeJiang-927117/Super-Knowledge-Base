# Security Policy / 安全策略

## Default Security Baseline / 默认安全基线

- **Local Loopback Binding**: The HTTP server binds `127.0.0.1` by default (`ZHIXU_HOST`).
- **Mandatory Bearer Authentication**: Protected HTTP endpoints require a Bearer token (`ZHIXU_SERVER_TOKEN` or admin session token); when unset, a 256-bit cryptographically random token is generated at startup.
- **No Default Password**: First-run interactive setup requires a `>= 12`-character strong password; non-loopback binds (`0.0.0.0`) refuse to start if `ZHIXU_ADMIN_PASSWORD` is unset or weak.
- **Login Rate Limiting**: Per-IP and per-account sliding-window rate limiting with progressive delay, 15-minute lockout (`HTTP 429` + `Retry-After`), and structured failure logs.
- **Server-Side RBAC & Authoritative Session Identity**: `reviewer` vs `superadmin` permissions enforced on every endpoint (`src/main/rbac.ts`); client-supplied `reviewer` / `author` fields are ignored.
- **Password Storage**: Salted `scrypt` hashes with constant-time `timingSafeEqual` verification.
- **Path Safety**: `/api/source` and `/api/remove-source` reject path traversal (`..`) and dot-prefixed internal paths (`.localwiki/`, `.git/`).
- **AI Destructive Action Guard**: AI suggestions to delete pages are intercepted into `pending_delete` approval and Recycle Bin rather than hard-deleted.
- **Self-signed Windows Certificate**: Internal/self-signed builds can be verified against [`certs/zhixu-codesign.cer`](./certs/zhixu-codesign.cer) (not a public commercial CA; see [`certs/README.md`](./certs/README.md)).

## Reporting a Vulnerability / 漏洞报告

- Please do **not** open a public GitHub issue for security vulnerabilities.
- Report via GitHub Private Vulnerability Reporting (**Security → Advisories → Report a vulnerability**) or email `jiangjoe02@gmail.com`.
- Include reproduction steps, affected version/commit, and potential impact. We aim to acknowledge reports within 48 hours.
