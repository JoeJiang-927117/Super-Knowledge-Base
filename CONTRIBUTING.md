# Contributing to ZHIXU / 参与贡献

[English](#english) | [简体中文](#简体中文)

---

<a id="english"></a>

## English

Thank you for contributing to **ZHIXU · 知序**!

### Development Setup

1. Fork the repository and clone your fork.
2. Install dependencies with Node.js `>= 22.13` (`24.x` recommended):
   ```bash
   npm install
   ```
3. Run locally:
   ```bash
   npm run dev
   ```
4. Before opening a Pull Request, make sure all checks pass:
   ```bash
   npm run typecheck
   npm run build
   npm test
   ```

### Guidelines

- Keep PRs focused and well-scoped.
- Update both English and Chinese UI strings (`src/renderer/src/i18n.tsx` / `useI18n()`) when adding user-facing UI elements.
- Never commit API keys, private signing certificates (`.pfx`/`.key`), or personal documents.
- By submitting a contribution, you agree that it is licensed under **Apache License 2.0** (see [LICENSE](./LICENSE)).

---

<a id="简体中文"></a>

## 简体中文

感谢关注并参与 **知序 · ZHIXU** 开源项目！

### 本地开发

1. Fork 本仓库并克隆到本地。
2. 使用 Node.js `>= 22.13`（推荐 `24.x`）安装依赖并启动：
   ```bash
   npm install
   npm run dev
   ```
3. 提交 Pull Request 前请确保全部检查通过：
   ```bash
   npm run typecheck
   npm run build
   npm test
   ```

### 规范要求

- 每次 PR 保持职责单一、改动清晰。
- 新增前端界面文案请同步补齐中英双语（`useI18n()`）。
- 严禁提交 API Key、私钥证书（`.pfx`/`.key`）或个人私有业务文件。
- 提交的代码贡献默认遵循本项目的 **Apache License 2.0** 协议（见 [LICENSE](./LICENSE)）。
