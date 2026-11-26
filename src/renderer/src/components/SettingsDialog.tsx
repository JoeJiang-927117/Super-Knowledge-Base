import { Check, Copy, Globe, RefreshCw, ShieldCheck, X } from 'lucide-react'
import { useState, type RefObject } from 'react'
import type { DeploymentMode, ModelProviderSettings, WorkspaceSnapshot } from '../../../shared/types'
import { useI18n } from '../i18n'
import { deploymentModeLabel, providerLabel } from '../labels'

export function fillDraftFromMode(snapshot: WorkspaceSnapshot, mode: DeploymentMode): ModelProviderSettings {
  const profile = snapshot.modelProvider.profiles?.[mode] ?? snapshot.modelProvider
  return {
    mode,
    provider: profile.provider,
    baseUrl: profile.baseUrl,
    apiKey: '',
    model: profile.llmModel || profile.model,
    lllmBaseUrl: profile.lllmBaseUrl ?? '',
    lllmApiKey: '',
    lllmModel: profile.lllmModel ?? profile.model,
    llmBaseUrl: profile.llmBaseUrl ?? '',
    llmApiKey: '',
    llmModel: profile.llmModel ?? profile.model,
    vmBaseUrl: profile.vmBaseUrl ?? '',
    vmApiKey: '',
    visionModel: profile.visionModel ?? '',
    embeddingModel: profile.embeddingModel ?? '',
    rerankBaseUrl: profile.rerankBaseUrl ?? '',
    rerankApiKey: '',
    rerankModel: profile.rerankModel ?? '',
    remoteServerUrl: profile.remoteServerUrl ?? '',
    remoteServerToken: ''
  }
}

type Props = {
  dialogRef: RefObject<HTMLDialogElement | null>
  snapshot: WorkspaceSnapshot
  draft: ModelProviderSettings
  onDraftChange: (next: ModelProviderSettings) => void
  onClose: () => void
  onSave: () => void
  onRefreshModels: () => void
  onSelectWorkspace: () => void
}

export default function SettingsDialog({
  dialogRef,
  snapshot,
  draft,
  onDraftChange,
  onClose,
  onSave,
  onRefreshModels,
  onSelectWorkspace
}: Props) {
  const { locale, tx } = useI18n()
  const [mcpCopied, setMcpCopied] = useState(false)
  const mcpSnippet = JSON.stringify(
    {
      mcpServers: {
        zhixu: {
          command: 'node',
          args: ['/path/to/zhixu/out/main/mcp.js', '--root', snapshot.root || '/path/to/your-knowledge-base']
        }
      }
    },
    null,
    2
  )
  const copyMcpConfig = async () => {
    try {
      await navigator.clipboard.writeText(mcpSnippet)
      setMcpCopied(true)
      window.setTimeout(() => setMcpCopied(false), 1800)
    } catch {
      // Ignore clipboard restriction
    }
  }
  const mode = draft.mode ?? 'cloud'
  const activeProfileSnap = snapshot.modelProvider.profiles?.[mode]
  const update = (patch: Partial<ModelProviderSettings>) => onDraftChange({ ...draft, ...patch })

  return (
    <dialog
      ref={dialogRef}
      className="settings-dialog"
      aria-labelledby="settings-title"
      onClick={event => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="settings-card">
        <div className="dialog-header">
          <h2 id="settings-title">{tx('模型接口设置', 'Model API Settings')}</h2>
          <button className="icon-btn-sm" onClick={onClose} aria-label={tx('关闭', 'Close')}><X /></button>
        </div>

        <div className="seg-tabs mode-seg" role="tablist" aria-label={tx('运行模式', 'Deployment mode')}>
          {(
            [
              ['cloud', tx('外部 API（优先）', 'Cloud API (Primary)')],
              ['lan_gpu', tx('局域网 GPU', 'LAN GPU')],
              ['local', tx('本机 Ollama', 'Local Ollama')]
            ] as [DeploymentMode, string][]
          ).map(([modeKey, label]) => (
            <button
              key={modeKey}
              type="button"
              role="tab"
              aria-selected={mode === modeKey}
              className={mode === modeKey ? 'active' : ''}
              onClick={() => onDraftChange(fillDraftFromMode(snapshot, modeKey))}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="field-row">
          <label htmlFor="provider-select">{tx('协议与主网关', 'Protocol & Primary Gateway')}</label>
          <div className="two-col-grid">
            <select
              id="provider-select"
              className="text-input"
              value={draft.provider}
              onChange={event => {
                const provider = event.target.value === 'ollama' ? 'ollama' : 'openai'
                onDraftChange({
                  ...draft,
                  provider,
                  baseUrl:
                    provider === 'ollama'
                      ? 'http://127.0.0.1:11434'
                      : draft.baseUrl.includes(':11434')
                        ? mode === 'lan_gpu'
                          ? 'http://192.168.1.100:8000/v1'
                          : 'https://api.deepseek.com/v1'
                        : draft.baseUrl
                })
              }}
            >
              <option value="openai">{tx('OpenAI 兼容 API', 'OpenAI-Compatible API')}</option>
              <option value="ollama">Ollama</option>
            </select>
            <input
              id="api-base-url"
              className="text-input"
              value={draft.baseUrl}
              onChange={event => update({ baseUrl: event.target.value })}
              placeholder={mode === 'local' ? 'http://127.0.0.1:11434' : 'https://api.deepseek.com/v1'}
              autoComplete="off"
            />
          </div>
        </div>

        {draft.provider === 'openai' && (
          <div className="field-row">
            <label htmlFor="api-key">{tx('共享 API Key', 'Shared API Key')}</label>
            <input
              id="api-key"
              className="text-input"
              type="password"
              value={draft.apiKey}
              onChange={event => update({ apiKey: event.target.value })}
              placeholder={activeProfileSnap?.apiKeySet ? tx('已保存，留空不变', 'Saved — leave blank to keep') : tx('输入主 API Key', 'Enter primary API Key')}
              autoComplete="off"
            />
          </div>
        )}

        <div className="tier-config-stack">
          <div className="tier-config-card">
            <div className="tier-config-head">
              <span className="tier-badge lllm">LLLM</span>
              <strong>{tx('重推理整理', 'Deep Reasoning & Synthesis')}</strong>
            </div>
            <div className="two-col-grid">
              <input
                className="text-input"
                value={draft.lllmModel ?? ''}
                onChange={event => update({ lllmModel: event.target.value })}
                placeholder={tx('如 deepseek-reasoner', 'e.g. deepseek-reasoner')}
                autoComplete="off"
              />
              <input
                className="text-input"
                value={draft.lllmBaseUrl ?? ''}
                onChange={event => update({ lllmBaseUrl: event.target.value })}
                placeholder={tx('独立 Base URL（可选）', 'Dedicated Base URL (optional)')}
                autoComplete="off"
              />
            </div>
            <input
              className="text-input"
              type="password"
              value={draft.lllmApiKey ?? ''}
              onChange={event => update({ lllmApiKey: event.target.value })}
              placeholder={activeProfileSnap?.lllmApiKeySet ? tx('独立 Key 已保存', 'Dedicated key saved') : tx('独立 API Key（可选）', 'Dedicated API Key (optional)')}
              autoComplete="off"
            />
          </div>

          <div className="tier-config-card">
            <div className="tier-config-head">
              <span className="tier-badge llm">LLM</span>
              <strong>{tx('文本问答', 'Standard Q&A')}</strong>
            </div>
            <div className="two-col-grid">
              <div className="input-with-btn">
                {draft.provider === 'ollama' && mode === 'local' ? (
                  <select
                    className="text-input"
                    value={draft.llmModel || draft.model}
                    onChange={event => update({ llmModel: event.target.value, model: event.target.value })}
                    disabled={!snapshot.models.length}
                  >
                    {snapshot.models.length
                      ? snapshot.models.map(m => <option key={m}>{m}</option>)
                      : <option>{draft.llmModel || draft.model}</option>}
                  </select>
                ) : (
                  <input
                    className="text-input"
                    value={draft.llmModel ?? draft.model}
                    onChange={event => update({ llmModel: event.target.value, model: event.target.value })}
                    placeholder={tx('如 deepseek-chat', 'e.g. deepseek-chat')}
                    autoComplete="off"
                  />
                )}
                <button className="icon-btn-sm" type="button" onClick={onRefreshModels} aria-label={tx('刷新', 'Refresh')}><RefreshCw /></button>
              </div>
              <input
                className="text-input"
                value={draft.llmBaseUrl ?? ''}
                onChange={event => update({ llmBaseUrl: event.target.value })}
                placeholder={tx('独立 Base URL（可选）', 'Dedicated Base URL (optional)')}
                autoComplete="off"
              />
            </div>
            <input
              className="text-input"
              type="password"
              value={draft.llmApiKey ?? ''}
              onChange={event => update({ llmApiKey: event.target.value })}
              placeholder={activeProfileSnap?.llmApiKeySet ? tx('独立 Key 已保存', 'Dedicated key saved') : tx('独立 API Key（可选）', 'Dedicated API Key (optional)')}
              autoComplete="off"
            />
          </div>

          <div className="tier-config-card">
            <div className="tier-config-head">
              <span className="tier-badge vm">VM</span>
              <strong>{tx('视觉多模态', 'Vision Multimodal')}</strong>
            </div>
            <div className="two-col-grid">
              <input
                className="text-input"
                value={draft.visionModel ?? ''}
                onChange={event => update({ visionModel: event.target.value })}
                placeholder={tx('如 qwen-vl-max', 'e.g. qwen-vl-max')}
                autoComplete="off"
              />
              <input
                className="text-input"
                value={draft.vmBaseUrl ?? ''}
                onChange={event => update({ vmBaseUrl: event.target.value })}
                placeholder={tx('独立 Base URL（可选）', 'Dedicated Base URL (optional)')}
                autoComplete="off"
              />
            </div>
            <input
              className="text-input"
              type="password"
              value={draft.vmApiKey ?? ''}
              onChange={event => update({ vmApiKey: event.target.value })}
              placeholder={activeProfileSnap?.vmApiKeySet ? tx('独立 Key 已保存', 'Dedicated key saved') : tx('独立 API Key（可选）', 'Dedicated API Key (optional)')}
              autoComplete="off"
            />
          </div>
        </div>

        <details className="advanced-box">
          <summary>{tx('高级：Embedding / Reranker / 远程服务端', 'Advanced: Embedding / Reranker / Remote Server')}</summary>
          <div className="field-row">
            <label htmlFor="embedding-model">{tx('Embedding 模型', 'Embedding Model')}</label>
            <input
              id="embedding-model"
              className="text-input"
              value={draft.embeddingModel ?? ''}
              onChange={event => update({ embeddingModel: event.target.value })}
              placeholder="text-embedding-3-small / BAAI/bge-m3"
            />
          </div>
          <div className="two-col-grid">
            <div className="field-row">
              <label htmlFor="rerank-url">{tx('Reranker 地址', 'Reranker URL')}</label>
              <input id="rerank-url" className="text-input" value={draft.rerankBaseUrl ?? ''} onChange={event => update({ rerankBaseUrl: event.target.value })} placeholder="http://192.168.1.100:8001/v1" />
            </div>
            <div className="field-row">
              <label htmlFor="rerank-model">{tx('Reranker 模型', 'Reranker Model')}</label>
              <input id="rerank-model" className="text-input" value={draft.rerankModel ?? ''} onChange={event => update({ rerankModel: event.target.value })} placeholder="BAAI/bge-reranker-v2-m3" />
            </div>
          </div>
          {mode !== 'local' && (
            <div className="two-col-grid">
              <div className="field-row">
                <label htmlFor="remote-url">{tx('远程服务端 URL', 'Remote Server URL')}</label>
                <input id="remote-url" className="text-input" value={draft.remoteServerUrl ?? ''} onChange={event => update({ remoteServerUrl: event.target.value })} placeholder="http://192.168.1.100:8787" />
              </div>
              <div className="field-row">
                <label htmlFor="remote-token">{tx('访问令牌', 'Access Token')}</label>
                <input
                  id="remote-token"
                  className="text-input"
                  type="password"
                  value={draft.remoteServerToken ?? ''}
                  onChange={event => update({ remoteServerToken: event.target.value })}
                  placeholder={activeProfileSnap?.remoteServerTokenSet ? tx('已保存', 'Saved') : 'ZHIXU_SERVER_TOKEN'}
                />
              </div>
            </div>
          )}
        </details>

        <details className="advanced-box">
          <summary>{tx('MCP Server 接入（Claude Code / Cursor / Codex / Antigravity）', 'MCP Server Integration (Claude Code / Cursor / Codex / Antigravity)')}</summary>
          <p className="tier-desc" style={{ marginBottom: 8 }}>
            {tx(
              '一键接入本地知识库：支持 zhixu_search、zhixu_ask、zhixu_read_page、zhixu_get_graph 与仅写草稿的 zhixu_propose_draft（绝不改写原文件）。',
              'Connect AI coding agents to this audited Wiki: exposes zhixu_search, zhixu_ask, zhixu_read_page, zhixu_get_graph, and draft-only zhixu_propose_draft (source files stay read-only).'
            )}
          </p>
          <pre
            style={{
              margin: '0 0 8px',
              padding: '10px 12px',
              borderRadius: 10,
              background: 'var(--bg-subtle)',
              border: '1px solid var(--border)',
              fontSize: 11.5,
              lineHeight: 1.5,
              overflowX: 'auto'
            }}
          >
            {mcpSnippet}
          </pre>
          <button type="button" className="btn-outline" onClick={copyMcpConfig}>
            {mcpCopied ? <Check /> : <Copy />}{' '}
            {mcpCopied ? tx('已复制 MCP 配置', 'Copied MCP Config') : tx('复制 MCP JSON 配置', 'Copy MCP JSON Config')}
          </button>
        </details>

        <button className="btn-primary btn-block settings-save" onClick={onSave}>
          <Check /> {locale === 'en' ? `Save & Switch to ${deploymentModeLabel(mode, locale)}` : `保存并切换至「${deploymentModeLabel(mode, locale)}」`}
        </button>

        <button className="connection-bar" onClick={onSelectWorkspace}>
          {mode === 'local' ? <ShieldCheck /> : <Globe />}
          <div>
            <strong>{snapshot.modelOnline ? tx('服务就绪', 'Service Ready') : tx('待配置接口', 'API Key Needed')}</strong>
            <small>{providerLabel(snapshot.modelProvider, locale)} · {snapshot.root}</small>
          </div>
        </button>
      </div>
    </dialog>
  )
}
