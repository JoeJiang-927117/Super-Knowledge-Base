# Changelog / 更新日志

## v0.3.0 (2026-11-26)

### MCP Server, Interactive Knowledge Graph & Scanned PDF Vision-OCR
- **Built-in Standard MCP Server (`src/mcp/index.ts` → `out/main/mcp.js`, `npm run mcp`)**: Zero-dependency JSON-RPC 2.0 over stdio supporting Claude Code, Cursor, Codex, Antigravity, and any MCP client. Exposes 6 governance-safe tools (`zhixu_search`, `zhixu_ask`, `zhixu_list_pages`, `zhixu_read_page`, `zhixu_propose_draft`, `zhixu_get_graph`) plus `zhixu://wiki/<slug>` and `zhixu://schema` resources. Agent writes strictly enter `draft` status and never mutate source files or overwrite published baselines. Includes a one-click MCP JSON copy snippet in Settings.
- **Interactive Knowledge Graph View (`KnowledgeGraphView.tsx`, `/api/v1/graph`, `workspace:graph`)**: High-DPI HTML5 Canvas force-directed graph visualizing Wiki pages, SPG Schema entities, wikilinks, and TF-IDF mutual-index relations across all storage domains with pan/zoom, node dragging, domain filtering, live search highlighting, and a slide-in inspector that jumps directly to any Wiki page.
- **Scanned PDF Vision-OCR Fallback (`src/main/pdf-ocr.ts` + `readPdf`)**: Zero-native-dependency embedded scan extractor and pure-JS PNG encoder with automatic downscaling; when a PDF page has no selectable text layer, ZHIXU automatically routes the page image through the configured `VM` tier (e.g., local Ollama `qwen2.5vl:7b` or cloud Vision API) to extract verbatim text and Markdown tables.
- **v0.3.0 Automated Verification (`tests/verify_zhixu_v3.mjs`)**: Added end-to-end stdio JSON-RPC MCP tests, draft-only governance assertions, graph endpoint verification, and pure-JS PNG/1-bit scan PDF OCR unit tests.

## v0.2.1 (2026-11-25)

### Experience & Interactive Polish
- **Passwordless Local Entry (`Enter ZHIXU`)**: Local desktop and loopback (`127.0.0.1`) launches now open directly into a clean welcome screen with one-click entry—zero forced password setup for personal use, while still keeping optional password protection in Admin Settings and enforcing strict `ZHIXU_ADMIN_PASSWORD` (`>= 12` chars) on non-loopback (`0.0.0.0` / Docker) deployments.
- **English Default UI**: Default interface language is now `English` with instant one-click switching to `简体中文`.
- **Unified 3-Layer Isometric Chunk Loader**: Introduced an interactive 3-layer isometric stacking loader (`BootLoader`, `ZhixuIsoLoader`, `ZhixuChunkProgress`) across app startup, file imports, knowledge compilation, Q&A generation, diff/version loading, and health checks.
- **Signed Windows Portable Release**: Published `ZHIXU-v0.2.1-windows-x64-portable.zip` (self-signed Authenticode binary) with `SHA256SUMS.txt` directly on GitHub Releases for zero-build desktop evaluation.

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
