import { Check, Globe, RefreshCw, ShieldCheck, X } from 'lucide-react'
import type { RefObject } from 'react'
import type { DeploymentMode, ModelProviderSettings, WorkspaceSnapshot } from '../../../shared/types'
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
          <h2 id="settings-title">模型接口设置</h2>
          <button className="icon-btn-sm" onClick={onClose} aria-label="关闭"><X /></button>
        </div>

        <div className="seg-tabs mode-seg" role="tablist" aria-label="运行模式">
          {(
            [
              ['cloud', '外部 API（优先）'],
              ['lan_gpu', '局域网 GPU'],
              ['local', '本机 Ollama']
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
          <label htmlFor="provider-select">协议与主网关</label>
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
              <option value="openai">OpenAI 兼容 API</option>
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
            <label htmlFor="api-key">共享 API Key</label>
            <input
              id="api-key"
              className="text-input"
              type="password"
              value={draft.apiKey}
              onChange={event => update({ apiKey: event.target.value })}
              placeholder={activeProfileSnap?.apiKeySet ? '已保存，留空不变' : '输入主 API Key'}
              autoComplete="off"
            />
          </div>
        )}

        <div className="tier-config-stack">
          <div className="tier-config-card">
            <div className="tier-config-head">
              <span className="tier-badge lllm">LLLM</span>
              <strong>重推理整理</strong>
            </div>
            <div className="two-col-grid">
              <input
                className="text-input"
                value={draft.lllmModel ?? ''}
                onChange={event => update({ lllmModel: event.target.value })}
                placeholder="如 deepseek-reasoner"
                autoComplete="off"
              />
              <input
                className="text-input"
                value={draft.lllmBaseUrl ?? ''}
                onChange={event => update({ lllmBaseUrl: event.target.value })}
                placeholder="独立 Base URL（可选）"
                autoComplete="off"
              />
            </div>
            <input
              className="text-input"
              type="password"
              value={draft.lllmApiKey ?? ''}
              onChange={event => update({ lllmApiKey: event.target.value })}
              placeholder={activeProfileSnap?.lllmApiKeySet ? '独立 Key 已保存' : '独立 API Key（可选）'}
              autoComplete="off"
            />
          </div>

          <div className="tier-config-card">
            <div className="tier-config-head">
              <span className="tier-badge llm">LLM</span>
              <strong>文本问答</strong>
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
                    placeholder="如 deepseek-chat"
                    autoComplete="off"
                  />
                )}
                <button className="icon-btn-sm" type="button" onClick={onRefreshModels} aria-label="刷新"><RefreshCw /></button>
              </div>
              <input
                className="text-input"
                value={draft.llmBaseUrl ?? ''}
                onChange={event => update({ llmBaseUrl: event.target.value })}
                placeholder="独立 Base URL（可选）"
                autoComplete="off"
              />
            </div>
            <input
              className="text-input"
              type="password"
              value={draft.llmApiKey ?? ''}
              onChange={event => update({ llmApiKey: event.target.value })}
              placeholder={activeProfileSnap?.llmApiKeySet ? '独立 Key 已保存' : '独立 API Key（可选）'}
              autoComplete="off"
            />
          </div>

          <div className="tier-config-card">
            <div className="tier-config-head">
              <span className="tier-badge vm">VM</span>
              <strong>视觉多模态</strong>
            </div>
            <div className="two-col-grid">
              <input
                className="text-input"
                value={draft.visionModel ?? ''}
                onChange={event => update({ visionModel: event.target.value })}
                placeholder="如 qwen-vl-max"
                autoComplete="off"
              />
              <input
                className="text-input"
                value={draft.vmBaseUrl ?? ''}
                onChange={event => update({ vmBaseUrl: event.target.value })}
                placeholder="独立 Base URL（可选）"
                autoComplete="off"
              />
            </div>
            <input
              className="text-input"
              type="password"
              value={draft.vmApiKey ?? ''}
              onChange={event => update({ vmApiKey: event.target.value })}
              placeholder={activeProfileSnap?.vmApiKeySet ? '独立 Key 已保存' : '独立 API Key（可选）'}
              autoComplete="off"
            />
          </div>
        </div>

        <details className="advanced-box">
          <summary>高级：Embedding / Reranker / 远程服务端</summary>
          <div className="field-row">
            <label htmlFor="embedding-model">Embedding 模型</label>
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
              <label htmlFor="rerank-url">Reranker 地址</label>
              <input id="rerank-url" className="text-input" value={draft.rerankBaseUrl ?? ''} onChange={event => update({ rerankBaseUrl: event.target.value })} placeholder="http://192.168.1.100:8001/v1" />
            </div>
            <div className="field-row">
              <label htmlFor="rerank-model">Reranker 模型</label>
              <input id="rerank-model" className="text-input" value={draft.rerankModel ?? ''} onChange={event => update({ rerankModel: event.target.value })} placeholder="BAAI/bge-reranker-v2-m3" />
            </div>
          </div>
          {mode !== 'local' && (
            <div className="two-col-grid">
              <div className="field-row">
                <label htmlFor="remote-url">远程服务端 URL</label>
                <input id="remote-url" className="text-input" value={draft.remoteServerUrl ?? ''} onChange={event => update({ remoteServerUrl: event.target.value })} placeholder="http://192.168.1.100:8787" />
              </div>
              <div className="field-row">
                <label htmlFor="remote-token">访问令牌</label>
                <input
                  id="remote-token"
                  className="text-input"
                  type="password"
                  value={draft.remoteServerToken ?? ''}
                  onChange={event => update({ remoteServerToken: event.target.value })}
                  placeholder={activeProfileSnap?.remoteServerTokenSet ? '已保存' : 'ZHIXU_SERVER_TOKEN'}
                />
              </div>
            </div>
          )}
        </details>

        <button className="btn-primary btn-block settings-save" onClick={onSave}>
          <Check /> 保存并切换至「{deploymentModeLabel(mode)}」
        </button>

        <button className="connection-bar" onClick={onSelectWorkspace}>
          {mode === 'local' ? <ShieldCheck /> : <Globe />}
          <div>
            <strong>{snapshot.modelOnline ? '服务就绪' : '待配置接口'}</strong>
            <small>{providerLabel(snapshot.modelProvider)} · {snapshot.root}</small>
          </div>
        </button>
      </div>
    </dialog>
  )
}
