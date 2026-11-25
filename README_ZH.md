<div align="center">

<img src="./assets/zhixu-icon.png" alt="知序 ZHIXU" width="108" />

<h1>知序 · ZHIXU</h1>

<p><strong>面向企业级场景的轻量开源 AI 知识库架构：可审阅、可溯源、可回滚的本地知识编译器与桌面工作台</strong></p>

<p>
  <a href="./README.md">English</a> | <strong>简体中文</strong>
</p>

<p>
  <a href="#项目简介">项目简介</a> ·
  <a href="#界面预览">界面预览</a> ·
  <a href="#与企业级开源知识库架构对比">架构对比</a> ·
  <a href="#技术架构与原理">技术原理</a> ·
  <a href="#模型路由与推荐搭配">模型搭配</a> ·
  <a href="#快速开始">快速开始</a> ·
  <a href="#部署与-api">部署与 API</a> ·
  <a href="#开源许可与代码签名证书">许可与证书</a>
</p>

<p>
  <a href="./LICENSE"><img alt="License: Apache-2.0" src="https://img.shields.io/badge/License-Apache--2.0-2563EB?style=flat-square" /></a>
  <a href="https://github.com/JoeJiang-927117/ZHIXUAgentic-Knowledge-Base/releases"><img alt="Release" src="https://img.shields.io/badge/Release-v0.1.0-059669?style=flat-square" /></a>
  <img alt="Tests" src="https://img.shields.io/badge/Checks-14%20Passed-059669?style=flat-square" />
  <img alt="Bilingual UI" src="https://img.shields.io/badge/UI-English%20%2F%20中文-0EA5E9?style=flat-square" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5.x-2563EB?style=flat-square&logo=typescript&logoColor=white" />
  <img alt="Electron" src="https://img.shields.io/badge/Electron-Desktop-0F172A?style=flat-square&logo=electron&logoColor=38BDF8" />
  <img alt="React 19" src="https://img.shields.io/badge/React-19-1D4ED8?style=flat-square&logo=react&logoColor=white" />
  <img alt="Node.js 24" src="https://img.shields.io/badge/Node.js-24+-15803D?style=flat-square&logo=node.js&logoColor=white" />
  <img alt="SQLite + Git" src="https://img.shields.io/badge/Storage-Markdown%20%2B%20SQLite%20%2B%20Git-4F46E5?style=flat-square" />
  <img alt="Default Login" src="https://img.shields.io/badge/初始账密-zhixu%20%2F%20123456789-0F172A?style=flat-square" />
</p>

<br />

<img src="./docs/screenshots/02-workspace.png" alt="知序工作台" width="96%" />

</div>

---

## 项目简介

知序（ZHIXU）直接对标**企业级开源知识库架构**（如 RAGFlow、Dify、AnythingLLM、XWiki），聚焦企业落地 AI 知识库时最真实的工程痛点：**既要企业级的严谨治理、可审计与安全边界，又不想背负 Elasticsearch + MinIO + Redis + MySQL + 多容器编排的沉重运维负担**。

在研发、运维、制度合规、项目管理等企业业务中，核心知识高度分散在 PDF 规范、Word 规程、Excel 台账、PPT 汇报与现场图片之中。现有方案通常存在三类落差：
- **传统企业 Wiki（Confluence / XWiki / Outline）**：权限与流程成熟，但完全依赖人工整理，存量文档无法自动转化为结构化知识，长期维护成本极高。
- **重型企业 RAG 平台（RAGFlow / Dify）**：流水线功能齐全，但部署链路重、组件多、硬件门槛高，且以“切片向量检索”为主，缺乏面向正式制度与规程的「草稿审核 → 发布基线 → AI 删除拦截 → Git 回滚」治理闭环。
- **轻量本地问答工具（AnythingLLM 等）**：上手快，但偏向个人对话助手，缺少结构化 Wiki 编译、原文摘录回查核验、分栏人工修订与多级审批审计能力。

**知序采用「轻量单体、企业内核」的 AI 知识编译架构**：

1. **不可变证据底座**：所有导入的 PDF、DOCX、XLSX、PPTX、Markdown 与图片作为不可变原始凭证本地落盘，按 SHA-256 哈希增量识别变化，任何 AI 操作绝不改写原件。
2. **两阶段知识编译与摘录核验**：通过结构感知切块、零重依赖 OOXML 解析与两阶段模型编译，将异构资料自动沉淀为结构化 Markdown Wiki、六大知识域分类与 TF-IDF 实体互索引；所有引用摘录自动回查原文行/页定位，无法核验的幻觉内容直接剔除。
3. **企业级变更治理闭环**：AI 新增与更新全部先进入声明式审核流（`草稿 → 初审 → 终审 → 发布 → 归档`），AI 删除建议强制拦截进入「待删审批 → 回收站」；内置分栏 Markdown 编辑器支持人工随时修订与新建，每次变更均可对比已发布基线的行级 Diff，并依托 SQLite 版本快照与 `isomorphic-git` 实现任意版本回滚与一键撤销整理。
4. **开放数据主权与低成本交付**：知识正文即标准 Markdown，索引与持久化向量存于本地 SQLite，版本审计存于标准 `.git` 仓库。支持中英双语界面一键切换，单机可跑桌面客户端，内网/服务器通过单个 Node 进程或单容器 Docker 即可一键交付团队使用。

### 典型企业落地场景

- **研发与运维知识底座**：沉淀服务器台账（`.xlsx`）、巡检规程（`.docx`/`.pdf`）、排障脚本与事故复盘，利用精确 IP/端口/版本号提权检索快速定位处置方案。
- **制度、标准与合规资料库**：对准确度与审计要求极高的场景——强制人工审核发布、保留历史正式基线、问答严格标注适用条件与冲突缺口，杜绝“AI 偷偷改规范”。
- **项目经验与方案复盘**：将分散的立项文档、汇报 PPT（含演讲备注）与现场图片统一编译为可跳转的主题百科，支持多轮追问并将优质分析一键沉淀为正式草稿。
- **专网 / 局域网私有部署**：默认外部 API 优先，也可无缝切换局域网 GPU（vLLM / SGLang / Ollama）或本机 Ollama，配合强制令牌鉴权与 `127.0.0.1` 默认绑定满足内网安全基线。

---

## 与企业级开源知识库架构对比

| 架构维度 | 重型开源 RAG 平台<br/>（如 RAGFlow / Dify） | 轻量本地 AI 助手<br/>（如 AnythingLLM） | 传统企业 Wiki<br/>（如 XWiki / Outline） | 知序 · ZHIXU |
| :--- | :--- | :--- | :--- | :--- |
| **核心定位** | 通用多租户 RAG 编排平台 | 个人/小团队本地对话与 Agent | 人工协作文档与知识门户 | **轻量级企业 AI 知识编译器与治理工作台** |
| **部署复杂度** | 高（常需 ES / DB / 对象存储 / Redis 多容器） | 低（单桌面或单容器） | 中（需数据库与 Web 服务） | **极低（桌面端或单进程 / 单容器 Docker）** |
| **知识产出形态** | 向量切片为主，人难直接维护 | 向量切片与聊天记录 | 人工编写页面 | **自动编译 + 人工可编辑的标准 Markdown Wiki** |
| **防幻觉与核验** | 依赖重排与提示词约束 | 依赖基础相似度召回 | 人工编写 | **原文摘录强制回查定位 + 证据不足诚实拒答** |
| **AI 变更治理** | 缺少页面级审批与删除拦截 | 无审核流与版本基线 | 有流程但无 AI 编译能力 | **声明式审核流 + AI 删除拦截回收站 + 行级 Diff + Git 回滚** |
| **模型算力分工** | 偏统一模型配置 | 单一聊天/嵌入模型 | 无 | **LLLM / LLM / VM 三层独立接口按任务分流** |
| **数据开放性** | 深度耦合内部数据库与对象存储 | 耦合内部向量库 | 耦合平台数据库 | **100% 开放本地文件（Markdown + SQLite + Git）** |

---

## 界面预览

<table>
  <tr>
    <td width="50%" align="center">
      <img src="./docs/screenshots/01-login.png" alt="登录页" />
      <br />
      <strong>登录页</strong>
    </td>
    <td width="50%" align="center">
      <img src="./docs/screenshots/03-knowledge.png" alt="三栏知识工作台" />
      <br />
      <strong>三栏知识工作台</strong> · 分栏编辑 / 版本差异 / 原文依据检查器
    </td>
  </tr>
  <tr>
    <td width="50%" align="center">
      <img src="./docs/screenshots/04-admin.png" alt="系统控制中心" />
      <br />
      <strong>全景系统控制中心</strong> · 三类 API 路由 / 防删回收站 / 多账号管理
    </td>
    <td width="50%" align="center">
      <img src="./docs/screenshots/02-workspace.png" alt="多轮问答工作台" />
      <br />
      <strong>多轮问答工作台</strong> · 上下文追问 / 命中高亮 / 一键沉淀草稿
    </td>
  </tr>
</table>

---

## 技术架构与原理

```mermaid
flowchart LR
    A["多格式原件<br/>PDF · DOCX · XLSX · PPTX · 图片"] --> B["结构感知切块<br/>代码围栏保护 · IP/版本安全分句"]
    B --> C["三类接口路由<br/>LLLM 规划 · LLM 问答 · VM 识图"]
    C --> D["原文摘录核验<br/>回查行/页定位 · 丢弃幻觉"]
    D --> E["声明式治理队列<br/>草稿审核 · AI 删除拦截进回收站"]
    E --> F["本地数据底座<br/>Markdown · SQLite 持久向量 · Git"]
    F --> G["RRF 混合检索 & 多轮问答<br/>精确参数提权 · 问答一键沉淀"]
```

### 1. 零重依赖文档解析与结构感知切块
- **自研 OOXML 解析器**（`src/main/ooxml.ts`）：基于 Node 原生 `zlib` 与纯 TypeScript ZIP 中央目录读取器实现，无需引入数十 MB 的重型第三方表格库。Excel 按工作表输出标准 Markdown 表格（切块时自动为每个切片续接表头），PPT 按幻灯片序号提取正文并自动合并演讲者备注。
- **结构感知语义切块引擎**（`src/main/chunker.ts`）：
  - **围栏代码块状态机**：精确追踪 ```` ``` ```` 与 `~~~` 区域，确保脚本中的 `# 注释` 或编号行绝不被误判为章节标题；超长代码块按行安全拆分并补全围栏标记。
  - **工程字面量安全分句**：保护 IP 地址（`192.168.1.100`）、版本号（`v2.0.1`）与小数（`3.14`）不被英文句点切碎。
  - **微块自动合并与内容去重**：同章节路径下的过短文本碎片自动合并，保留完整层级面包屑与行/页定位。

### 2. RRF 多路融合检索与诚实引用问答
- **四路融合排序**（`src/main/search.ts`、`src/main/schema.ts`）：
  1. **中文分词 BM25**：基于 `Intl.Segmenter('zh-CN')` + 二元切词的全文检索，内存索引按 `(root, revision, scope)` 缓存；
  2. **SQLite 持久化向量检索**：按文档内容哈希增量写入本地 `embeddings` 表，去除数量上限且避免重复计算；
  3. **边界感知 TF-IDF 互索引**：对英文/ASCII 实体强制词边界匹配（彻底消除 `port` 误命中 `import`/`report`），自动提取并归并括号别名（如 `标准操作规程（SOP）` → `SOP`），按 TF-IDF × 标题位置加权关联切块与 Wiki；
  4. **精确参数提权 + 自适应 Sigmoid 精排**：针对 IP、端口、版本号、带单位数值额外提权；Cross-Encoder 原始 logit 采用温度缩放 Logistic Sigmoid 校准（`1 / (1 + exp(-x / T))`），避免线性 min-max 把低相关候选误拉为满分。
- **多轮连续追问与证据高亮**：支持携带近 3 轮对话历史进行指代消解与上下文检索，命中证据自动高亮查询词；每条回答均输出「核心结论 / 适用条件 / 冲突与缺失 / 引用来源」，证据不足时明确拒答且绝不伪造引用。

### 3. 容错存储、版本治理与安全边界
- **崩溃自愈与原子写盘**（`src/main/safe-write.ts`）：写入锁文件记录进程 PID，异常崩溃遗留的死锁在毫秒级自动检测回收；Markdown 写入走「临时文件 → `fsync` → 原子重命名（Windows `EPERM/EBUSY` 退避重试）」。
- **代码块保护体检修复**（`src/main/linter.ts`）：自动巡检无依据页面、过期原件、断链、孤立页、重复标题、Schema 缺项与过薄内容；一键修复断链时严格跳过围栏代码与行内代码中的 `[[...]]`。
- **安全默认项**（`src/main/admin-auth.ts`、`src/server/index.ts`）：服务端默认绑定 `127.0.0.1`，未配置 Token 时自动生成强随机令牌并通过常量时间比对校验；`/api/source` 禁止读取 `.localwiki`/`.git` 等内部隐藏路径；CORS 支持来源白名单；后台账号支持 `superadmin` / `reviewer` 分级，密码采用随机盐 `scrypt`。

---

## 模型路由与推荐搭配

知序采用**外部 API 优先**架构，同时支持局域网 GPU 服务（vLLM / SGLang / Ollama）与本机 Ollama，并把不同认知负载拆分到三类独立接口（可共享同一主网关，也可分别配置独立的 `Base URL` 与 `API Key`）：

| 接口层级 | 职责范围 | 云端外部 API 推荐 | 局域网 / 本机私有推荐 |
| :--- | :--- | :--- | :--- |
| **`LLLM`** | 全局 Wiki 结构规划、跨文档综合编译 | `deepseek-reasoner` / `qwen-max` / `o3-mini` | `Qwen3-32B` / `DeepSeek-R1-Distill-32B` |
| **`LLM`** | 日常多轮问答、单文档要点提取、引用核验 | `deepseek-chat` / `gpt-4o-mini` / `qwen-plus` | `Qwen3-14B` / `qwen2.5:14b` |
| **`VM`** | 现场照片、架构图、扫描图表多模态解析 | `qwen-vl-max` / `gpt-4o` | `qwen2.5vl:7b` / `Qwen2.5-VL-72B` |
| **`Embedding` / `Rerank`**（可选） | 持久化语义向量与精排打分 | `text-embedding-3-small` / `BAAI/bge-m3` | `bge-m3` + `bge-reranker-v2-m3` |

---

## 快速开始

> [!IMPORTANT]
> **初始默认账密**：账号 `zhixu` / 密码 `123456789`（可通过环境变量 `ZHIXU_ADMIN_USER` / `ZHIXU_ADMIN_PASSWORD` 覆盖，首次登录后可在「系统后台 → 账号安全」修改）。

> **环境要求**：Node.js `>= 22.13`（推荐 `24.x`，原生内置 `node:sqlite`）

### 桌面端本地运行

```bash
git clone https://github.com/JoeJiang-927117/ZHIXUAgentic-Knowledge-Base.git
cd ZHIXUAgentic-Knowledge-Base
npm install
npm run dev
```

- 国内网络安装 Electron 可选设置 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`。
- 快捷键：`Ctrl + K` 唤起全局命令面板；编辑模式下 `Ctrl + S` 快速保存草稿。

### 类型检查、构建与自动化验证

```bash
npm run typecheck
npm run build
npm test
```

`npm test` 会运行全部 **14 项自动化验证**（结构切块、OOXML 解析、词边界互索引、Sigmoid 校准、死进程锁自愈、强制鉴权、三层路由、持久向量缓存、诚实引用、删除审批回收站及人工编辑器版本链）。

### 打包 Windows 客户端

```bash
npm run package:dir   # 免安装绿色版 -> release/win-unpacked/
npm run package       # NSIS 安装包 -> release/
```

---

## 部署与 API

### Docker Compose 一键启动服务端

```bash
ZHIXU_API_KEY=your-api-key \
ZHIXU_SERVER_TOKEN=your-strong-token \
ZHIXU_ADMIN_PASSWORD=your-strong-password \
docker compose up -d --build
```

### Node 独立服务端

```bash
ZHIXU_ROOT=/data/knowledge-base \
ZHIXU_API_KEY=your-api-key \
ZHIXU_SERVER_TOKEN=your-strong-token \
npm run server
```

<details>
<summary><strong>展开查看：完整环境变量清单</strong></summary>

| 变量 | 说明 | 默认值 |
| :--- | :--- | :--- |
| `ZHIXU_HOST` / `ZHIXU_PORT` | 服务端监听地址与端口 | `127.0.0.1` / `8787` |
| `ZHIXU_ROOT` | 知识库数据根目录 | `./data` |
| `ZHIXU_MODE` | 运行模式：`cloud`（外部 API 优先）/ `lan_gpu` / `local` | `cloud` |
| `ZHIXU_MODEL_BASE_URL` | 主模型网关地址（OpenAI 兼容） | `https://api.deepseek.com/v1` |
| `ZHIXU_API_KEY` | 默认共享 API Key | 空 |
| `ZHIXU_LLLM_MODEL` | LLLM 重推理模型（可选独立 `ZHIXU_LLLM_BASE_URL` / `ZHIXU_LLLM_API_KEY`） | `deepseek-reasoner` |
| `ZHIXU_LLM_MODEL` | LLM 标准问答模型（可选独立 `ZHIXU_LLM_BASE_URL` / `ZHIXU_LLM_API_KEY`） | `deepseek-chat` |
| `ZHIXU_VISION_MODEL` | VM 视觉多模态模型（可选独立 `ZHIXU_VM_BASE_URL` / `ZHIXU_VM_API_KEY`） | `qwen-vl-max` |
| `ZHIXU_EMBEDDING_MODEL` | 持久化向量 Embedding 模型 | `text-embedding-3-small` |
| `ZHIXU_RERANK_BASE_URL` / `ZHIXU_RERANK_MODEL` | 可选 Cross-Encoder 精排服务 | 空 |
| `ZHIXU_SERVER_TOKEN` | 服务端 Bearer 令牌（留空自动生成高强度随机令牌） | 自动生成 |
| `ZHIXU_CORS_ORIGIN` | 允许跨域来源白名单（逗号分隔） | 本机环回 |
| `ZHIXU_ADMIN_USER` / `ZHIXU_ADMIN_PASSWORD` | 初始超级管理员账密 | `zhixu` / `123456789` |

</details>

<details>
<summary><strong>展开查看：主要 HTTP API 接口</strong></summary>

所有受保护接口需携带 `Authorization: Bearer <TOKEN>`（服务端令牌或 `/api/auth/login` 返回的管理员会话令牌）：

| 方法与路径 | 说明 |
| :--- | :--- |
| `GET /api/v1/health` | 健康检查与鉴权状态 |
| `POST /api/auth/login` | 管理员登录换取会话令牌 |
| `GET /api/snapshot` | 获取工作区完整快照 |
| `POST /api/upload` | 上传原始资料（支持 Base64 JSON） |
| `POST /api/organize` | 触发增量扫描、切块与 Wiki 编译 |
| `POST /api/pages/save` | 人工新建或编辑 Wiki 页面（带版本快照与 Git 留痕） |
| `POST /api/workflow/transition` | 审核流转与删除审批（发布 / 退回 / 回收站 / 恢复） |
| `POST /api/v1/search` | RRF 多路混合检索 |
| `POST /api/v1/ask` | 多轮上下文溯源问答 |
| `GET /api/lint` / `POST /api/lint/fix` | 确定性知识体检与代码块安全断链修复 |

</details>

---

## 演进路线

- [x] 多格式原件解析（含零依赖 `.xlsx` / `.pptx`）与代码围栏安全切块
- [x] RRF 混合检索、SQLite 持久化向量缓存、词边界 TF-IDF 互索引与 Sigmoid 精排
- [x] 内置分栏 Markdown 编辑器、多轮连续追问、问答一键沉淀草稿与中英双语界面
- [x] 声明式审核流、AI 删除审批拦截、回收站与 Git 版本链
- [ ] 页面级 RBAC 访问隔离与组织角色映射
- [ ] 扫描版 PDF 本地 OCR 与复杂多栏版面还原
- [ ] 检索召回率与引用忠实度自动化评估基准集

---

## 开源许可与代码签名证书

- **开源协议**：本项目基于 **[Apache License 2.0](./LICENSE)** 开源（可商用、支持二次开发，含专利授权；分发修改版请保留 [LICENSE](./LICENSE) 与 [NOTICE](./NOTICE) 声明）。
- **第三方许可**：依赖组件开源协议清单见 [THIRD_PARTY_LICENSES.md](./THIRD_PARTY_LICENSES.md)。
- **安全策略**：默认安全基线与漏洞披露流程见 [SECURITY.md](./SECURITY.md)。
- **贡献指南与更新日志**：见 [CONTRIBUTING.md](./CONTRIBUTING.md) 与 [CHANGELOG.md](./CHANGELOG.md)。
- **Windows 代码签名证书**：仓库提供公开校验签名证书 [`certs/zhixu-codesign.cer`](./certs/zhixu-codesign.cer)（RSA 4096 / SHA-256，指纹 `252C0ECD64B70B122EF0FEF369120D624B1175D2`），支持内网分发校验与企业信任导入；签名脚本与商业 CA 替换方式见 [`certs/README.md`](./certs/README.md)。
