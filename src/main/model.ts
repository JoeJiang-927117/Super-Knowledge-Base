/**
 * Zhixu External-API-First Multi-Tier Model Client (LLLM + LLM + VM + Embedding + Adaptive Reranker).
 *
 * Three model API tiers:
 * - LLLM: Long-context / heavy reasoning model (Wiki global synthesis & planning)
 * - LLM:  Standard fast text model (QA & document note extraction)
 * - VM:   Vision multimodal model (Image & diagram understanding)
 *
 * Three simultaneous runtime profiles (External API / Cloud default first):
 * - cloud:   External OpenAI-compatible API / Cloud Zhixu server (DEFAULT)
 * - lan_gpu: Dedicated LAN GPU Server (vLLM / SGLang / Ollama / BGE-Reranker / Remote Zhixu server)
 * - local:   Local PC (Ollama on-demand)
 */

import type {
  DeploymentEndpointProfile,
  DeploymentEndpointProfileSnapshot,
  DeploymentMode,
  ModelProviderSettings,
  ModelProviderSnapshot,
  ModelTier
} from '../shared/types'

export type ModelMessage = {
  role: 'system' | 'user'
  content: string
}

export interface WikiModelClient {
  readonly tier: ModelTier
  readonly modelName: string
  listModels(): Promise<string[]>
  generateJson<T>(messages: ModelMessage[], schema: Record<string, unknown>, signal?: AbortSignal): Promise<T>
  embed(texts: string[], signal?: AbortSignal): Promise<number[][] | null>
  rerank(query: string, documents: string[], signal?: AbortSignal): Promise<number[] | null>
  analyzeImage(imageBase64: string, mimeType: string, prompt: string, signal?: AbortSignal): Promise<string | null>
}

export const DEFAULT_CLOUD_LLM = 'deepseek-chat'
export const DEFAULT_CLOUD_LLLM = 'deepseek-reasoner'
export const DEFAULT_CLOUD_VM = 'qwen-vl-max'

export const DEFAULT_LOCAL_LLM = 'qwen3.5:9b'
export const DEFAULT_LOCAL_VM = 'qwen2.5vl:7b'

export const DEFAULT_OLLAMA_BASE_URL = 'http://127.0.0.1:11434'
export const DEFAULT_LAN_GPU_BASE_URL = 'http://192.168.1.100:8000/v1'
export const DEFAULT_OPENAI_BASE_URL = 'https://api.deepseek.com/v1'

export function defaultProfiles(): Record<DeploymentMode, DeploymentEndpointProfile> {
  return {
    cloud: {
      provider: 'openai',
      baseUrl: DEFAULT_OPENAI_BASE_URL,
      apiKey: '',
      model: DEFAULT_CLOUD_LLM,
      lllmBaseUrl: '',
      lllmApiKey: '',
      lllmModel: DEFAULT_CLOUD_LLLM,
      llmBaseUrl: '',
      llmApiKey: '',
      llmModel: DEFAULT_CLOUD_LLM,
      vmBaseUrl: '',
      vmApiKey: '',
      visionModel: DEFAULT_CLOUD_VM,
      embeddingModel: 'text-embedding-3-small',
      rerankBaseUrl: '',
      rerankApiKey: '',
      rerankModel: '',
      remoteServerUrl: '',
      remoteServerToken: ''
    },
    lan_gpu: {
      provider: 'openai',
      baseUrl: DEFAULT_LAN_GPU_BASE_URL,
      apiKey: '',
      model: 'Qwen/Qwen2.5-14B-Instruct',
      lllmBaseUrl: '',
      lllmApiKey: '',
      lllmModel: 'Qwen/Qwen2.5-32B-Instruct',
      llmBaseUrl: '',
      llmApiKey: '',
      llmModel: 'Qwen/Qwen2.5-14B-Instruct',
      vmBaseUrl: '',
      vmApiKey: '',
      visionModel: 'Qwen/Qwen2.5-VL-7B-Instruct',
      embeddingModel: 'BAAI/bge-m3',
      rerankBaseUrl: '',
      rerankApiKey: '',
      rerankModel: 'BAAI/bge-reranker-v2-m3',
      remoteServerUrl: '',
      remoteServerToken: ''
    },
    local: {
      provider: 'ollama',
      baseUrl: DEFAULT_OLLAMA_BASE_URL,
      apiKey: '',
      model: DEFAULT_LOCAL_LLM,
      lllmBaseUrl: '',
      lllmApiKey: '',
      lllmModel: DEFAULT_LOCAL_LLM,
      llmBaseUrl: '',
      llmApiKey: '',
      llmModel: DEFAULT_LOCAL_LLM,
      vmBaseUrl: '',
      vmApiKey: '',
      visionModel: DEFAULT_LOCAL_VM,
      embeddingModel: '',
      rerankBaseUrl: '',
      rerankApiKey: '',
      rerankModel: '',
      remoteServerUrl: '',
      remoteServerToken: ''
    }
  }
}

/**
 * External API (cloud) is the default first-class mode.
 */
export function defaultModelSettings(): ModelProviderSettings {
  const profiles = defaultProfiles()
  return {
    mode: 'cloud',
    ...profiles.cloud,
    profiles
  }
}

export function normalizeModelSettings(
  raw: Partial<ModelProviderSettings> | undefined,
  previous?: ModelProviderSettings
): ModelProviderSettings {
  const baseDefaults = defaultProfiles()
  const prevProfiles = previous?.profiles ?? {}
  const rawProfiles = raw?.profiles ?? {}

  const activeMode: DeploymentMode =
    raw?.mode === 'cloud' || raw?.mode === 'lan_gpu' || raw?.mode === 'local'
      ? raw.mode
      : previous?.mode ?? (raw?.provider === 'ollama' ? 'local' : 'cloud')

  const mergeProfile = (mode: DeploymentMode): DeploymentEndpointProfile => {
    const def = baseDefaults[mode]
    const prev = prevProfiles[mode] ?? (previous?.mode === mode ? previous : undefined)
    const incoming = rawProfiles[mode]
    const activeIncoming = mode === activeMode ? raw : undefined
    const pickStr = (a?: string, b?: string, c?: string, d = ''): string => {
      if (typeof a === 'string') return a.trim()
      if (typeof b === 'string') return b.trim()
      if (typeof c === 'string') return c.trim()
      return d
    }
    const pickSecret = (a?: string, b?: string, c?: string): string => {
      if (typeof a === 'string' && a.trim()) return a.trim()
      if (typeof b === 'string' && b.trim()) return b.trim()
      if (typeof c === 'string' && c.trim()) return c.trim()
      return ''
    }

    const providerRaw = activeIncoming?.provider ?? incoming?.provider ?? prev?.provider ?? def.provider
    const llmModel =
      pickStr(
        activeIncoming?.llmModel ?? activeIncoming?.model,
        incoming?.llmModel ?? incoming?.model,
        prev?.llmModel ?? prev?.model,
        def.llmModel ?? def.model
      ) || def.model
    const lllmModel =
      pickStr(activeIncoming?.lllmModel, incoming?.lllmModel, prev?.lllmModel, def.lllmModel ?? llmModel) || llmModel

    return {
      provider: providerRaw === 'ollama' ? 'ollama' : 'openai',
      baseUrl: pickStr(activeIncoming?.baseUrl, incoming?.baseUrl, prev?.baseUrl, def.baseUrl) || def.baseUrl,
      apiKey: pickSecret(activeIncoming?.apiKey, incoming?.apiKey, prev?.apiKey),
      model: llmModel,
      lllmBaseUrl: pickStr(activeIncoming?.lllmBaseUrl, incoming?.lllmBaseUrl, prev?.lllmBaseUrl, ''),
      lllmApiKey: pickSecret(activeIncoming?.lllmApiKey, incoming?.lllmApiKey, prev?.lllmApiKey),
      lllmModel,
      llmBaseUrl: pickStr(activeIncoming?.llmBaseUrl, incoming?.llmBaseUrl, prev?.llmBaseUrl, ''),
      llmApiKey: pickSecret(activeIncoming?.llmApiKey, incoming?.llmApiKey, prev?.llmApiKey),
      llmModel,
      vmBaseUrl: pickStr(activeIncoming?.vmBaseUrl, incoming?.vmBaseUrl, prev?.vmBaseUrl, ''),
      vmApiKey: pickSecret(activeIncoming?.vmApiKey, incoming?.vmApiKey, prev?.vmApiKey),
      visionModel: pickStr(activeIncoming?.visionModel, incoming?.visionModel, prev?.visionModel, def.visionModel ?? ''),
      embeddingModel: pickStr(
        activeIncoming?.embeddingModel,
        incoming?.embeddingModel,
        prev?.embeddingModel,
        def.embeddingModel ?? ''
      ),
      rerankBaseUrl: pickStr(
        activeIncoming?.rerankBaseUrl,
        incoming?.rerankBaseUrl,
        prev?.rerankBaseUrl,
        def.rerankBaseUrl ?? ''
      ),
      rerankApiKey: pickSecret(activeIncoming?.rerankApiKey, incoming?.rerankApiKey, prev?.rerankApiKey),
      rerankModel: pickStr(activeIncoming?.rerankModel, incoming?.rerankModel, prev?.rerankModel, def.rerankModel ?? ''),
      remoteServerUrl: pickStr(
        activeIncoming?.remoteServerUrl,
        incoming?.remoteServerUrl,
        prev?.remoteServerUrl,
        def.remoteServerUrl ?? ''
      ),
      remoteServerToken: pickSecret(
        activeIncoming?.remoteServerToken,
        incoming?.remoteServerToken,
        prev?.remoteServerToken
      )
    }
  }

  const profiles: Record<DeploymentMode, DeploymentEndpointProfile> = {
    cloud: mergeProfile('cloud'),
    lan_gpu: mergeProfile('lan_gpu'),
    local: mergeProfile('local')
  }
  const active = profiles[activeMode]

  return {
    mode: activeMode,
    ...active,
    profiles
  }
}

export function resolveTierEndpoint(
  settings: ModelProviderSettings,
  tier: ModelTier
): { provider: ModelProviderSettings['provider']; baseUrl: string; apiKey: string; model: string } {
  const sharedUrl = settings.baseUrl.trim()
  const sharedKey = settings.apiKey.trim()

  if (tier === 'LLLM') {
    const rawUrl = settings.lllmBaseUrl?.trim() || sharedUrl
    const provider = inferProviderForUrl(rawUrl, settings.provider)
    return {
      provider,
      baseUrl: normalizeBaseUrl(rawUrl, provider),
      apiKey: settings.lllmApiKey?.trim() || sharedKey,
      model: (settings.lllmModel?.trim() || settings.llmModel?.trim() || settings.model.trim())
    }
  }

  if (tier === 'VM') {
    const rawUrl = settings.vmBaseUrl?.trim() || sharedUrl
    const provider = inferProviderForUrl(rawUrl, settings.provider)
    return {
      provider,
      baseUrl: normalizeBaseUrl(rawUrl, provider),
      apiKey: settings.vmApiKey?.trim() || sharedKey,
      model: (settings.visionModel?.trim() || settings.llmModel?.trim() || settings.model.trim())
    }
  }

  // Default: LLM
  const rawUrl = settings.llmBaseUrl?.trim() || sharedUrl
  const provider = inferProviderForUrl(rawUrl, settings.provider)
  return {
    provider,
    baseUrl: normalizeBaseUrl(rawUrl, provider),
    apiKey: settings.llmApiKey?.trim() || sharedKey,
    model: (settings.llmModel?.trim() || settings.model.trim())
  }
}

function inferProviderForUrl(
  url: string,
  fallback: ModelProviderSettings['provider']
): ModelProviderSettings['provider'] {
  if (/\/v1(\/|$)/i.test(url)) return 'openai'
  if (/:11434(\/|$)/i.test(url)) return 'ollama'
  return fallback
}

export function createTierModelClient(settings: ModelProviderSettings, tier: ModelTier = 'LLM'): WikiModelClient {
  const endpoint = resolveTierEndpoint(settings, tier)
  const embeddingModel = settings.embeddingModel?.trim() ?? ''
  const rerankBaseUrl = settings.rerankBaseUrl?.trim() ? normalizeBaseUrl(settings.rerankBaseUrl, 'openai') : ''
  const rerankApiKey = settings.rerankApiKey?.trim() || endpoint.apiKey
  const rerankModel = settings.rerankModel?.trim() ?? ''
  if (!endpoint.model) throw new Error(`请填写 ${tier} 模型名称`)

  if (endpoint.provider === 'ollama') {
    return new OllamaModelClient(
      tier,
      endpoint.baseUrl,
      endpoint.model,
      settings.visionModel?.trim() ?? '',
      embeddingModel,
      rerankBaseUrl,
      rerankApiKey,
      rerankModel
    )
  }
  return new OpenAiCompatibleClient(
    tier,
    endpoint.baseUrl,
    endpoint.apiKey,
    endpoint.model,
    settings.visionModel?.trim() || endpoint.model,
    embeddingModel,
    rerankBaseUrl,
    rerankApiKey,
    rerankModel
  )
}

export function createModelClient(settings: ModelProviderSettings): WikiModelClient {
  return createTierModelClient(settings, 'LLM')
}

function toProfileSnapshot(profile: DeploymentEndpointProfile): DeploymentEndpointProfileSnapshot {
  return {
    provider: profile.provider,
    baseUrl: profile.baseUrl,
    model: profile.llmModel || profile.model,
    lllmBaseUrl: profile.lllmBaseUrl ?? '',
    lllmModel: profile.lllmModel ?? profile.model,
    llmBaseUrl: profile.llmBaseUrl ?? '',
    llmModel: profile.llmModel ?? profile.model,
    vmBaseUrl: profile.vmBaseUrl ?? '',
    visionModel: profile.visionModel ?? '',
    embeddingModel: profile.embeddingModel ?? '',
    rerankBaseUrl: profile.rerankBaseUrl ?? '',
    rerankModel: profile.rerankModel ?? '',
    remoteServerUrl: profile.remoteServerUrl ?? '',
    apiKeySet: Boolean(profile.apiKey.trim()),
    lllmApiKeySet: Boolean(profile.lllmApiKey?.trim()),
    llmApiKeySet: Boolean(profile.llmApiKey?.trim()),
    vmApiKeySet: Boolean(profile.vmApiKey?.trim()),
    rerankApiKeySet: Boolean(profile.rerankApiKey?.trim()),
    remoteServerTokenSet: Boolean(profile.remoteServerToken?.trim())
  }
}

export function publicModelSettings(settings: ModelProviderSettings): ModelProviderSnapshot {
  const normalized = normalizeModelSettings(settings)
  const mode = normalized.mode ?? 'cloud'
  const profiles = {
    cloud: toProfileSnapshot(normalized.profiles!.cloud!),
    lan_gpu: toProfileSnapshot(normalized.profiles!.lan_gpu!),
    local: toProfileSnapshot(normalized.profiles!.local!)
  }
  const active = profiles[mode]
  return {
    mode,
    ...active,
    profiles
  }
}

export function deploymentModeLabel(mode: DeploymentMode | undefined): string {
  if (mode === 'lan_gpu') return '局域网 GPU'
  if (mode === 'local') return '本机 Ollama'
  return '外部 API'
}

export function describeModel(settings: ModelProviderSettings, tier: ModelTier = 'LLM'): string {
  const modeTag = deploymentModeLabel(settings.mode)
  const ep = resolveTierEndpoint(settings, tier)
  return `${modeTag} · ${tier}:${ep.model}`
}

export function providerLabel(settings: Pick<ModelProviderSettings, 'provider' | 'mode'>): string {
  if (settings.mode === 'lan_gpu') return '局域网 GPU 服务器'
  if (settings.mode === 'local') return '本机 Ollama'
  return '外部 API（优先）'
}

function normalizeBaseUrl(baseUrl: string, provider: ModelProviderSettings['provider']): string {
  const fallback = provider === 'ollama' ? DEFAULT_OLLAMA_BASE_URL : DEFAULT_OPENAI_BASE_URL
  const normalized = (baseUrl.trim() || fallback).replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(normalized)) throw new Error('模型服务地址必须以 http:// 或 https:// 开头')
  return normalized
}

/**
 * Zhixu Adaptive Logistic Sigmoid Rerank Score Calibration (v2):
 * - Preserves already-calibrated probability scores in [0, 1] verbatim.
 * - Maps unbounded raw reranker logits (e.g., BGE-Reranker [-10, +10]) via temperature-scaled
 *   logistic sigmoid `1 / (1 + exp(-x / T))` instead of naive min-max scaling, preventing
 *   globally irrelevant candidates (e.g. [-9.2, -8.5]) from being falsely inflated to 1.0.
 */
export function normalizeRerankScores(scores: number[], temperature = 1.5): number[] {
  if (!scores.length) return scores
  let allProbability = true
  for (const s of scores) {
    if (!Number.isFinite(s) || s < 0 || s > 1) {
      allProbability = false
      break
    }
  }
  if (allProbability) return scores

  const t = Math.max(0.25, temperature)
  return scores.map(s => {
    if (!Number.isFinite(s)) return 0
    const z = Math.max(-30, Math.min(30, s / t))
    return Number((1 / (1 + Math.exp(-z))).toFixed(6))
  })
}

async function callRerankEndpoint(
  rerankBaseUrl: string,
  rerankApiKey: string,
  rerankModel: string,
  query: string,
  documents: string[],
  signal?: AbortSignal
): Promise<number[] | null> {
  if (!rerankBaseUrl || !rerankModel || !documents.length) return null
  const endpoint = rerankBaseUrl.endsWith('/rerank') ? rerankBaseUrl : `${rerankBaseUrl}/rerank`
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(rerankApiKey ? { authorization: `Bearer ${rerankApiKey}` } : {})
      },
      body: JSON.stringify({
        model: rerankModel,
        query,
        documents,
        top_n: documents.length,
        return_documents: false
      }),
      signal: signal ?? AbortSignal.timeout(15000)
    })
    if (!response.ok) return null
    const data = (await response.json()) as {
      results?: { index: number; relevance_score?: number; score?: number }[]
      data?: { index: number; relevance_score?: number; score?: number }[]
    }
    const items = data.results ?? data.data ?? []
    if (!items.length) return null
    const scores = new Array<number>(documents.length).fill(0)
    for (const item of items) {
      if (item.index >= 0 && item.index < scores.length) {
        const val = typeof item.relevance_score === 'number' ? item.relevance_score : (item.score ?? 0)
        scores[item.index] = val
      }
    }
    return normalizeRerankScores(scores)
  } catch {
    return null
  }
}

class OllamaModelClient implements WikiModelClient {
  private detectedEmbedModel: string | null = null
  private detectedVisionModel: string | null = null

  constructor(
    readonly tier: ModelTier,
    private readonly baseUrl: string,
    readonly modelName: string,
    private readonly visionModel: string,
    private readonly embeddingModel: string,
    private readonly rerankBaseUrl: string,
    private readonly rerankApiKey: string,
    private readonly rerankModel: string
  ) {}

  async listModels(): Promise<string[]> {
    const response = await fetch(`${this.baseUrl}/api/tags`, {
      signal: AbortSignal.timeout(5000)
    })
    if (!response.ok) throw new Error(`Ollama 返回 ${response.status}`)
    const data = (await response.json()) as { models?: { name: string }[] }
    return (data.models ?? []).map(item => item.name)
  }

  async generateJson<T>(messages: ModelMessage[], schema: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: this.modelName,
        messages,
        stream: false,
        think: false,
        format: schema,
        options: {
          temperature: 0.1,
          num_ctx: 32768,
          num_predict: 6000
        }
      }),
      signal
    })
    if (!response.ok) {
      const detail = await response.text()
      throw new Error(`本地模型请求失败（${response.status}）：${detail}`)
    }
    const data = (await response.json()) as { message?: { content?: string } }
    return parseModelJson(data.message?.content, `本地 ${this.tier}`)
  }

  async embed(texts: string[], signal?: AbortSignal): Promise<number[][] | null> {
    if (!texts.length) return []
    let targetModel = this.embeddingModel
    if (!targetModel) {
      if (this.detectedEmbedModel === null) {
        try {
          const available = await this.listModels()
          this.detectedEmbedModel =
            available.find(name => /(embed|bge|nomic|mxbai|snowflake|gte|e5)/i.test(name)) ?? ''
        } catch {
          this.detectedEmbedModel = ''
        }
      }
      targetModel = this.detectedEmbedModel
    }
    if (!targetModel) return null

    try {
      const response = await fetch(`${this.baseUrl}/api/embed`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: targetModel, input: texts }),
        signal: signal ?? AbortSignal.timeout(20000)
      })
      if (!response.ok) return null
      const data = (await response.json()) as { embeddings?: number[][] }
      return Array.isArray(data.embeddings) && data.embeddings.length === texts.length ? data.embeddings : null
    } catch {
      return null
    }
  }

  async rerank(query: string, documents: string[], signal?: AbortSignal): Promise<number[] | null> {
    return callRerankEndpoint(this.rerankBaseUrl, this.rerankApiKey, this.rerankModel, query, documents, signal)
  }

  async analyzeImage(
    imageBase64: string,
    _mimeType: string,
    prompt: string,
    signal?: AbortSignal
  ): Promise<string | null> {
    let targetModel = this.visionModel || this.modelName
    if (!targetModel) {
      if (this.detectedVisionModel === null) {
        try {
          const available = await this.listModels()
          this.detectedVisionModel =
            available.find(name => /(vl|vision|llava|minicpm-v|moondream)/i.test(name)) ?? ''
        } catch {
          this.detectedVisionModel = ''
        }
      }
      targetModel = this.detectedVisionModel
    }
    if (!targetModel) return null

    try {
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: targetModel,
          messages: [{ role: 'user', content: prompt, images: [imageBase64] }],
          stream: false,
          options: { temperature: 0.1, num_predict: 1200 }
        }),
        signal: signal ?? AbortSignal.timeout(45000)
      })
      if (!response.ok) return null
      const data = (await response.json()) as { message?: { content?: string } }
      return data.message?.content?.trim() || null
    } catch {
      return null
    }
  }
}

type OpenAiResponseMode = 'json_schema' | 'json_object' | 'prompt_only'

class OpenAiCompatibleClient implements WikiModelClient {
  private responseMode: OpenAiResponseMode = 'json_schema'

  constructor(
    readonly tier: ModelTier,
    private readonly baseUrl: string,
    private readonly apiKey: string,
    readonly modelName: string,
    private readonly visionModel: string,
    private readonly embeddingModel: string,
    private readonly rerankBaseUrl: string,
    private readonly rerankApiKey: string,
    private readonly rerankModel: string
  ) {}

  async listModels(): Promise<string[]> {
    const response = await fetch(`${this.baseUrl}/models`, {
      headers: this.headers(),
      signal: AbortSignal.timeout(8000)
    })
    if (!response.ok) throw new Error(`模型服务返回 ${response.status}`)
    const data = (await response.json()) as { data?: { id?: string }[] }
    return (data.data ?? []).map(item => item.id).filter((id): id is string => Boolean(id))
  }

  async generateJson<T>(messages: ModelMessage[], schema: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
    const schemaMessages = withSchemaInstruction(messages, schema)
    const modesToTry: OpenAiResponseMode[] =
      this.responseMode === 'json_schema'
        ? ['json_schema', 'json_object', 'prompt_only']
        : this.responseMode === 'json_object'
          ? ['json_object', 'prompt_only']
          : ['prompt_only']

    let lastStatus = 0
    let lastDetail = ''

    for (let i = 0; i < modesToTry.length; i += 1) {
      const mode = modesToTry[i]
      const payload: Record<string, unknown> = {
        model: this.modelName,
        messages: schemaMessages,
        temperature: 0.1
      }
      if (mode === 'json_schema') {
        payload.response_format = {
          type: 'json_schema',
          json_schema: {
            name: 'wiki_result',
            schema,
            strict: true
          }
        }
      } else if (mode === 'json_object') {
        payload.response_format = { type: 'json_object' }
      }

      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...this.headers()
        },
        body: JSON.stringify(payload),
        signal
      })

      if (response.ok) {
        this.responseMode = mode
        const data = (await response.json()) as { choices?: { message?: { content?: string } }[] }
        return parseModelJson(data.choices?.[0]?.message?.content, `外部 ${this.tier}`)
      }

      lastStatus = response.status
      lastDetail = await response.text()
      const canDowngrade = (response.status === 400 || response.status === 422) && i < modesToTry.length - 1
      if (!canDowngrade) break
    }

    throw new Error(`外部 ${this.tier} 模型请求失败（${lastStatus}）：${lastDetail}`)
  }

  async embed(texts: string[], signal?: AbortSignal): Promise<number[][] | null> {
    if (!texts.length || !this.embeddingModel) return null
    try {
      const response = await fetch(`${this.baseUrl}/embeddings`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...this.headers()
        },
        body: JSON.stringify({
          model: this.embeddingModel,
          input: texts
        }),
        signal: signal ?? AbortSignal.timeout(20000)
      })
      if (!response.ok) return null
      const data = (await response.json()) as { data?: { embedding?: number[]; index?: number }[] }
      const rows = (data.data ?? []).sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
      const vectors = rows.map(row => row.embedding).filter((vec): vec is number[] => Array.isArray(vec))
      return vectors.length === texts.length ? vectors : null
    } catch {
      return null
    }
  }

  async rerank(query: string, documents: string[], signal?: AbortSignal): Promise<number[] | null> {
    const targetUrl = this.rerankBaseUrl || (this.rerankModel ? this.baseUrl : '')
    return callRerankEndpoint(targetUrl, this.rerankApiKey, this.rerankModel, query, documents, signal)
  }

  async analyzeImage(
    imageBase64: string,
    mimeType: string,
    prompt: string,
    signal?: AbortSignal
  ): Promise<string | null> {
    const targetModel = this.visionModel || this.modelName
    if (!targetModel) return null
    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...this.headers()
        },
        body: JSON.stringify({
          model: targetModel,
          temperature: 0.1,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: prompt },
                { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBase64}` } }
              ]
            }
          ]
        }),
        signal: signal ?? AbortSignal.timeout(45000)
      })
      if (!response.ok) return null
      const data = (await response.json()) as { choices?: { message?: { content?: string } }[] }
      return data.choices?.[0]?.message?.content?.trim() || null
    } catch {
      return null
    }
  }

  private headers(): Record<string, string> {
    return this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}
  }
}

function withSchemaInstruction(messages: ModelMessage[], schema: Record<string, unknown>): ModelMessage[] {
  const instruction = `\n\n请严格只输出一个符合以下 JSON Schema 的合法 JSON 对象，不要附加 Markdown 代码块或任何解释文字：\n${JSON.stringify(schema)}`
  return messages.map((msg, idx) =>
    idx === 0 && msg.role === 'system'
      ? { ...msg, content: `${msg.content}${instruction}` }
      : msg
  )
}

function parseModelJson<T>(content: string | undefined, label: string): T {
  const raw = content?.trim()
  if (!raw) throw new Error(`${label}没有返回内容`)
  const stripped = raw
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
  try {
    return JSON.parse(stripped) as T
  } catch {
    const start = stripped.indexOf('{')
    const end = stripped.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(stripped.slice(start, end + 1)) as T
      } catch {
        // Fall through to the standardized error below.
      }
    }
    throw new Error(`${label}返回了无法解析的结构化结果，请重试`)
  }
}
