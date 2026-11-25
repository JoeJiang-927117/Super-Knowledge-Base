# Changelog / 更新日志

## v0.1.0 (2026-11-25)

### Highlights
- **Enterprise-Grade Local-First AI Knowledge Compiler**: Immutable local source storage (PDF / DOCX / XLSX / PPTX / Markdown / Images) compiled into structured, verifiable Markdown Wiki pages backed by SQLite and Git.
- **Zero-Bloat OOXML & Structure-Aware Chunker**: Native `node:zlib` `.xlsx`/`.pptx` parser, fenced code-block state machine, IP/version/decimal-safe sentence splitting, and micro-chunk coalescing.
- **RRF Multi-Signal Hybrid Retrieval**: Chinese/English BM25 + persistent SQLite vector cache + ASCII word-boundary TF-IDF mutual entity index + exact technical token boosting + temperature-scaled Logistic Sigmoid reranking.
- **Enterprise Governance & Security**: Declarative review workflow (`Draft → Moderating → Validating → Published → Archived`), AI delete guard into Recycle Bin, built-in split Markdown editor with line diffs and rollback, `127.0.0.1` default bind, constant-time Bearer auth, and dotfile read protection.
- **Full Bilingual Studio (`English / 简体中文`)**: Instant language toggle across Login Page, Workspace, 3-Pane Knowledge Studio, Review Queue, Health Check, Version Audit, Settings, Command Palette, and Admin Control Center.
- **Open-Source Compliance & Code Signing**: Licensed under **Apache License 2.0** with `NOTICE`, `THIRD_PARTY_LICENSES.md`, `SECURITY.md`, and RSA-4096 Windows Authenticode public certificate (`certs/zhixu-codesign.cer`).
