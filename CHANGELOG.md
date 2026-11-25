# Changelog / 更新日志

## v0.2.0 (2026-11-25)

### Security & Governance Hardening
- **Eliminated Universal Default Password**: Removed hardcoded `123456789` default seeding. Desktop and loopback first-run launches now enforce interactive `superadmin` password initialization (`/api/auth/setup`), while non-loopback binds (`0.0.0.0` / Docker) refuse to start unless a strong `ZHIXU_ADMIN_PASSWORD` (`>= 12` chars) is supplied.
- **Minimum Password Strength (`>= 12` chars)**: Enforced across initial setup, password changes, and account creation with weak-password rejection.
- **Login Rate Limiting & Lockout**: Per-IP and per-account sliding-window rate limiting with progressive delay, 15-minute lockout (`HTTP 429` + `Retry-After`), and structured failure logs.
- **Strict Server-Side RBAC (`src/main/rbac.ts`)**: Enforced `reviewer` vs `superadmin` permissions on every HTTP API and Desktop IPC endpoint; high-risk operations (model settings, source upload/delete, compile/undo/lint-fix, version rollback, recycle bin confirm/restore, purge, account CRUD) return `403 Forbidden` for `reviewer`.
- **Authoritative Session Identity**: Ignored client-supplied `reviewer` / `author` fields; audit trails strictly record the authenticated server session user.
- **Path & Session Safety**: Blocked dot-prefixed hidden directories (`.localwiki/`, `.git/`) on `/api/source` and `/api/remove-source`, upgraded Bearer token verification to `timingSafeEqual`, and verified session TTL expiration (`401`).

### Retrieval Quality & Reproducible Evaluation
- **Bilingual Stopword Filtering**: Added English stopword filtering alongside Chinese stopwords in `src/main/search.ts`, lifting out-of-scope unanswerable query rejection from `60%` to `100%`.
- **Fixed-Corpus End-to-End Evaluation Benchmark (`npm run eval`)**: Added `tests/eval_benchmark.mjs` measuring Recall@1/@3/@5 (`100%`), MRR (`1.000`), Citation Excerpt Match (`100%`), Unanswerable Refusal (`100%`), cold backup/restore, session expiry, and HTTP latency (`p50 15.4ms / p95 16.3ms`).

### Documentation & Deployment Clarity
- Removed default credential badges, corrected TypeScript badge to `7.x`, clarified `ZHIXU_ROOT` vs `ZHIXU_HOST_DATA_DIR`, updated `.env.example` and `docker-compose.yml` to require a strong password, and explicitly labeled `certs/zhixu-codesign.cer` as a **Self-signed Windows Certificate**.

## v0.1.0 (2026-11-25)

- Initial public Apache-2.0 release: local-first AI knowledge compiler, zero-bloat OOXML parser, RRF hybrid retrieval, declarative review workflow, AI delete guard recycle bin, Git version chain, and full ZH/EN bilingual UI.
