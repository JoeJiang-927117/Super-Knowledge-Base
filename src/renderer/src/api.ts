import type {
  AdminRole,
  ImportFilesResult,
  ModelProviderSettings,
  WorkspaceApi,
  WorkspaceSnapshot
} from '../../shared/types'
import { createDemoApi } from './demo'

const TOKEN_STORAGE_KEY = 'zhixu_auth_token'

function resolveWebToken(): string {
  try {
    const params = new URLSearchParams(window.location.search)
    const fromQuery = params.get('token')?.trim()
    if (fromQuery) {
      window.sessionStorage.setItem(TOKEN_STORAGE_KEY, fromQuery)
      return fromQuery
    }
    return (
      window.sessionStorage.getItem(TOKEN_STORAGE_KEY)?.trim() ??
      window.sessionStorage.getItem('zhixu_server_token')?.trim() ??
      ''
    )
  } catch {
    return ''
  }
}

function saveWebToken(token: string | null): void {
  try {
    if (token) window.sessionStorage.setItem(TOKEN_STORAGE_KEY, token)
    else window.sessionStorage.removeItem(TOKEN_STORAGE_KEY)
  } catch {
    // Ignore storage restriction.
  }
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  const chunkSize = 0x8000
  const parts: string[] = []
  for (let i = 0; i < bytes.length; i += chunkSize) {
    parts.push(String.fromCharCode(...bytes.subarray(i, i + chunkSize)))
  }
  return btoa(parts.join(''))
}

export function getWorkspaceApi(): WorkspaceApi {
  if (window.localWiki) return window.localWiki
  if (import.meta.env.DEV) return createDemoApi()

  async function request<T>(url: string, init?: RequestInit): Promise<T> {
    const token = resolveWebToken()
    const response = await fetch(url, {
      ...init,
      headers: {
        ...(init?.body ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...init?.headers
      }
    })
    if (!response.ok) {
      const detail = await response.text()
      try {
        const parsed = JSON.parse(detail) as { error?: string }
        if (parsed.error) throw new Error(parsed.error)
      } catch (err) {
        if (err instanceof Error && err.message && detail.includes(err.message)) throw err
      }
      throw new Error(detail || `请求失败（${response.status}）`)
    }
    if (response.status === 204) return undefined as T
    return response.json() as Promise<T>
  }

  return {
    getSnapshot: async () => {
      try {
        return await request<WorkspaceSnapshot>('/api/snapshot')
      } catch {
        const status = await request<{ needsSetup: boolean; minPasswordLength: number; authEnabled: boolean }>(
          '/api/auth/status'
        ).catch(() => ({ needsSetup: false, minPasswordLength: 12, authEnabled: true }))
        return {
          root: null,
          modelProvider: {
            mode: 'cloud',
            provider: 'openai',
            baseUrl: '',
            model: '',
            apiKeySet: false,
            lllmApiKeySet: false,
            llmApiKeySet: false,
            vmApiKeySet: false,
            rerankApiKeySet: false,
            remoteServerTokenSet: false,
            profiles: {
              cloud: { provider: 'openai', baseUrl: '', model: '', apiKeySet: false, lllmApiKeySet: false, llmApiKeySet: false, vmApiKeySet: false, rerankApiKeySet: false, remoteServerTokenSet: false },
              lan_gpu: { provider: 'openai', baseUrl: '', model: '', apiKeySet: false, lllmApiKeySet: false, llmApiKeySet: false, vmApiKeySet: false, rerankApiKeySet: false, remoteServerTokenSet: false },
              local: { provider: 'ollama', baseUrl: '', model: '', apiKeySet: false, lllmApiKeySet: false, llmApiKeySet: false, vmApiKeySet: false, rerankApiKeySet: false, remoteServerTokenSet: false }
            }
          },
          models: [],
          modelOnline: false,
          deploymentMode: 'cloud',
          remoteConnected: true,
          fileCount: 0,
          pendingCount: 0,
          draftCount: 0,
          pendingDeleteCount: 0,
          deletedCount: 0,
          publishedCount: 0,
          chunkCount: 0,
          entityCount: 0,
          mutualLinkCount: 0,
          cachedEmbeddingCount: 0,
          adminAuth: {
            authenticated: false,
            needsSetup: status.needsSetup,
            minPasswordLength: status.minPasswordLength,
            user: null,
            users: [],
            serverAuthEnforced: status.authEnabled
          },
          sourceFiles: [],
          pages: [],
          runs: [],
          modelCalls: [],
          feedbacks: []
        } satisfies WorkspaceSnapshot
      }
    },
    selectWorkspace: () => request<WorkspaceSnapshot | null>('/api/workspace', { method: 'POST' }).catch(() => null),
    importDroppedFiles: async (files: File[]): Promise<ImportFilesResult> => {
      const imported: string[] = []
      const skipped: string[] = []
      let latestSnapshot: WorkspaceSnapshot | null = null
      for (const file of files) {
        try {
          const buf = await file.arrayBuffer()
          const res = await request<{ file: string; snapshot: WorkspaceSnapshot }>('/api/upload', {
            method: 'POST',
            body: JSON.stringify({ fileName: file.name, contentBase64: arrayBufferToBase64(buf) })
          })
          imported.push(res.file)
          latestSnapshot = res.snapshot
        } catch {
          skipped.push(`${file.name}（上传失败）`)
        }
      }
      return {
        imported,
        skipped,
        snapshot: latestSnapshot ?? (await request<WorkspaceSnapshot>('/api/snapshot'))
      }
    },
    removeSource: file => request('/api/remove-source', { method: 'POST', body: JSON.stringify({ file }) }),
    organize: () => request('/api/organize', { method: 'POST' }),
    cancelOrganize: () => request('/api/cancel', { method: 'POST' }).then(() => undefined),
    undoRun: runId => request('/api/undo', { method: 'POST', body: JSON.stringify({ runId }) }),
    saveManualPage: input => request('/api/pages/save', { method: 'POST', body: JSON.stringify(input) }),
    publishPage: slug => request('/api/publish', { method: 'POST', body: JSON.stringify({ slug }) }),
    publishAllDrafts: () => request('/api/publish-all', { method: 'POST' }),
    transitionWorkflow: (slug, action, note) =>
      request('/api/workflow/transition', { method: 'POST', body: JSON.stringify({ slug, action, note }) }),
    purgeDeletedPage: slug => request('/api/pages/purge', { method: 'POST', body: JSON.stringify({ slug }) }),
    listPageVersions: slug => request(`/api/versions?slug=${encodeURIComponent(slug)}`),
    rollbackPageVersion: (slug, versionLabel) =>
      request('/api/versions/rollback', { method: 'POST', body: JSON.stringify({ slug, versionLabel }) }),
    getPageDiff: slug => request(`/api/diff?slug=${encodeURIComponent(slug)}`),
    runLint: () => request('/api/lint'),
    fixLint: () => request('/api/lint/fix', { method: 'POST' }),
    getSchemaOverview: () => request('/api/v1/schema'),
    searchKnowledge: (query, options) =>
      request('/api/v1/search', { method: 'POST', body: JSON.stringify({ query, ...options }) }),
    askKnowledge: (question, options) =>
      request('/api/v1/ask', { method: 'POST', body: JSON.stringify({ question, ...options }) }),
    submitFeedback: async entry => {
      await request('/api/v1/feedback', { method: 'POST', body: JSON.stringify(entry) })
      return request<WorkspaceSnapshot>('/api/snapshot')
    },
    setModel: (settings: ModelProviderSettings) =>
      request('/api/model', { method: 'POST', body: JSON.stringify(settings) }),
    refreshModels: () => request('/api/models', { method: 'POST' }),
    openSource: async file => {
      const token = resolveWebToken()
      const tokenParam = token ? `&token=${encodeURIComponent(token)}` : ''
      const anchor = document.createElement('a')
      anchor.href = `/api/source?file=${encodeURIComponent(file)}${tokenParam}`
      anchor.download = file.split('/').pop() ?? file
      anchor.rel = 'noopener'
      anchor.click()
    },
    adminSetup: async (username: string, password: string) => {
      const res = await request<{ token: string; snapshot: WorkspaceSnapshot }>('/api/auth/setup', {
        method: 'POST',
        body: JSON.stringify({ username, password })
      })
      saveWebToken(res.token)
      return res.snapshot
    },
    adminLogin: async (username: string, password: string) => {
      const res = await request<{ token: string; snapshot: WorkspaceSnapshot }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password })
      })
      saveWebToken(res.token)
      return res.snapshot
    },
    adminLogout: async () => {
      const res = await request<{ snapshot: WorkspaceSnapshot }>('/api/auth/logout', { method: 'POST' })
      saveWebToken(null)
      return res.snapshot
    },
    adminChangePassword: (oldPassword: string, newPassword: string) =>
      request('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ oldPassword, newPassword })
      }),
    adminCreateUser: (username: string, password: string, role: AdminRole) =>
      request('/api/auth/users', {
        method: 'POST',
        body: JSON.stringify({ username, password, role })
      }),
    adminDeleteUser: (username: string) =>
      request('/api/auth/users/delete', {
        method: 'POST',
        body: JSON.stringify({ username })
      }),
    onProgress: listener => {
      const token = resolveWebToken()
      const query = token ? `?token=${encodeURIComponent(token)}` : ''
      const source = new EventSource(`/api/events${query}`)
      source.onmessage = event => listener(JSON.parse(event.data))
      source.onerror = () => {
        // Reconnect automatically.
      }
      return () => source.close()
    }
  }
}
