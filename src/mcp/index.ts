/**
 * ZHIXU (知序) Standard Model Context Protocol (MCP) Server (stdio JSON-RPC 2.0).
 *
 * Lets Claude Code, Cursor, Codex, Antigravity, and any MCP client query your
 * local auditable Markdown Wiki + SQLite source index with strict governance:
 * - Original source files remain 100% read-only.
 * - Agent writes (`zhixu_propose_draft`) ALWAYS enter Draft status (never bypass approval).
 * - Diagnostics log strictly to stderr so stdout carries pure JSON-RPC 2.0 frames.
 */

import { existsSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'
import type { ModelProviderSettings, StorageDomain, WikiPageType } from '../shared/types'
import { defaultModelSettings, normalizeModelSettings } from '../main/model'
import { askKnowledgeBase, searchKnowledge } from '../main/search'
import { WikiStore } from '../main/store'

const SERVER_NAME = 'zhixu-mcp'
const SERVER_VERSION = '0.3.0'
const PROTOCOL_VERSION = '2024-11-05'

type JsonRpcRequest = {
  jsonrpc: '2.0'
  id?: string | number | null
  method: string
  params?: Record<string, unknown>
}

type DesktopSettingsFile = {
  root?: string | null
  model?: Partial<ModelProviderSettings>
}

function parseCliRoot(argv: string[]): string | null {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--root' && argv[i + 1]) return path.resolve(argv[i + 1])
    if (arg.startsWith('--root=')) return path.resolve(arg.slice('--root='.length))
  }
  return null
}

function candidateSettingsPaths(): string[] {
  const candidates: string[] = []
  if (process.env.APPDATA) {
    candidates.push(path.join(process.env.APPDATA, 'zhixu', 'settings.json'))
    candidates.push(path.join(process.env.APPDATA, '知序 ZHIXU', 'settings.json'))
  }
  const home = os.homedir()
  if (process.platform === 'darwin') {
    candidates.push(path.join(home, 'Library', 'Application Support', 'zhixu', 'settings.json'))
  } else {
    candidates.push(path.join(home, '.config', 'zhixu', 'settings.json'))
  }
  return candidates
}

async function loadDesktopSettings(): Promise<DesktopSettingsFile | null> {
  for (const file of candidateSettingsPaths()) {
    if (!existsSync(file)) continue
    try {
      const raw = await fs.readFile(file, 'utf8')
      return JSON.parse(raw) as DesktopSettingsFile
    } catch {
      // Ignore malformed settings file
    }
  }
  return null
}

function buildModelSettings(saved?: Partial<ModelProviderSettings>): ModelProviderSettings {
  const defaults = defaultModelSettings()
  const base = saved ? normalizeModelSettings(saved, defaults) : defaults
  const modeEnv = process.env.ZHIXU_MODE
  const mode = modeEnv === 'cloud' || modeEnv === 'lan_gpu' || modeEnv === 'local' ? modeEnv : base.mode
  const provider =
    process.env.ZHIXU_PROVIDER === 'ollama' || process.env.ZHIXU_PROVIDER === 'openai'
      ? process.env.ZHIXU_PROVIDER
      : base.provider
  return normalizeModelSettings(
    {
      ...base,
      mode,
      provider,
      baseUrl: process.env.ZHIXU_MODEL_BASE_URL ?? base.baseUrl,
      apiKey: process.env.ZHIXU_API_KEY ?? base.apiKey,
      model: process.env.ZHIXU_MODEL ?? base.model,
      llmModel: process.env.ZHIXU_LLM_MODEL ?? process.env.ZHIXU_MODEL ?? base.llmModel,
      lllmModel: process.env.ZHIXU_LLLM_MODEL ?? base.lllmModel,
      visionModel: process.env.ZHIXU_VISION_MODEL ?? base.visionModel,
      embeddingModel: process.env.ZHIXU_EMBEDDING_MODEL ?? base.embeddingModel
    },
    base
  )
}

const TOOLS = [
  {
    name: 'zhixu_search',
    description:
      'Hybrid search (BM25 + persistent SQLite vectors + TF-IDF entity mutual-index) across local ZHIXU Markdown Wiki pages and immutable source document chunks.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query (Chinese or English keywords, IP, error code, or concept).' },
        domain: {
          type: 'string',
          enum: ['permissions', 'foundation', 'cases', 'concrete_media', 'domain_knowledge', 'versions'],
          description: 'Optional SPG storage domain filter.'
        },
        includeDrafts: { type: 'boolean', description: 'Include unreviewed drafts in search results (default: false).' },
        includeSources: { type: 'boolean', description: 'Include raw document chunks alongside Wiki pages (default: true).' },
        limit: { type: 'integer', minimum: 1, maximum: 25, description: 'Maximum hits to return (default: 8).' }
      },
      required: ['query']
    }
  },
  {
    name: 'zhixu_ask',
    description:
      'Ask a question against the local ZHIXU knowledge base and receive a strictly grounded answer with verified source citations (refuses out-of-scope questions honestly).',
    inputSchema: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'Natural language question to answer from the local knowledge base.' },
        domain: {
          type: 'string',
          enum: ['permissions', 'foundation', 'cases', 'concrete_media', 'domain_knowledge', 'versions']
        },
        includeDrafts: { type: 'boolean', description: 'Allow citing unreviewed draft pages (default: false).' },
        includeSources: { type: 'boolean', description: 'Search raw source chunks in addition to Wiki pages (default: true).' }
      },
      required: ['question']
    }
  },
  {
    name: 'zhixu_list_pages',
    description: 'List structured Markdown Wiki pages in the ZHIXU knowledge base with status, domain, version, and summary.',
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['all', 'published', 'draft', 'moderating', 'validating', 'archived'],
          description: 'Filter pages by workflow status (default: all non-deleted).'
        },
        domain: {
          type: 'string',
          enum: ['permissions', 'foundation', 'cases', 'concrete_media', 'domain_knowledge', 'versions']
        }
      }
    }
  },
  {
    name: 'zhixu_read_page',
    description:
      'Read the complete Markdown content, verified source citations, wikilinks, and linked Schema entities of a specific ZHIXU Wiki page.',
    inputSchema: {
      type: 'object',
      properties: {
        slug: { type: 'string', description: 'Wiki page slug (e.g. "index" or a slug returned by zhixu_list_pages).' }
      },
      required: ['slug']
    }
  },
  {
    name: 'zhixu_propose_draft',
    description:
      'Governance-safe write tool: propose a new Wiki page or update an existing page strictly as a Draft for human review. Never overwrites published baselines or mutates original source files.',
    inputSchema: {
      type: 'object',
      properties: {
        slug: { type: 'string', description: 'Optional existing slug to propose an updated draft for.' },
        title: { type: 'string', description: 'Concise page title.' },
        summary: { type: 'string', description: '1-2 sentence executive summary.' },
        content: { type: 'string', description: 'Structured Markdown body (without leading H1).' },
        applicability: { type: 'string', description: 'Scope / applicability conditions.' },
        pageType: {
          type: 'string',
          enum: ['concept', 'synthesis', 'protocol', 'regulation', 'ops', 'entity', 'case']
        },
        storageDomain: {
          type: 'string',
          enum: ['permissions', 'foundation', 'cases', 'concrete_media', 'domain_knowledge']
        },
        note: { type: 'string', description: 'Audit note explaining why this draft was proposed.' }
      },
      required: ['title', 'content']
    }
  },
  {
    name: 'zhixu_get_graph',
    description:
      'Return the ZHIXU SPG Schema knowledge graph (Wiki nodes, extracted Schema entities, wikilinks, and TF-IDF mutual-index edges) for multi-hop exploration.',
    inputSchema: {
      type: 'object',
      properties: {
        maxEntities: {
          type: 'integer',
          minimum: 10,
          maximum: 200,
          description: 'Maximum number of top schema entities to include (default: 60).'
        }
      }
    }
  }
]

function writeRpc(payload: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(payload)}\n`)
}

function sendResult(id: string | number | null, result: unknown): void {
  writeRpc({ jsonrpc: '2.0', id, result })
}

function sendError(id: string | number | null, code: number, message: string): void {
  writeRpc({ jsonrpc: '2.0', id, error: { code, message } })
}

async function main(): Promise<void> {
  const saved = await loadDesktopSettings()
  const cliRoot = parseCliRoot(process.argv.slice(2))
  const envRoot = process.env.ZHIXU_ROOT?.trim() ? path.resolve(process.env.ZHIXU_ROOT.trim()) : null
  const kbRoot = cliRoot || envRoot || (saved?.root && existsSync(saved.root) ? saved.root : process.cwd())
  const modelSettings = buildModelSettings(saved?.model)

  const store = new WikiStore(kbRoot)
  await store.initialize()
  console.error(`[zhixu-mcp] Ready (${SERVER_VERSION}) | root=${kbRoot} | pages=${store.getPages().length}`)

  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })

  async function handleRequest(req: JsonRpcRequest): Promise<void> {
    const id = req.id ?? null
    const isNotification = req.id === undefined

    try {
      if (req.method === 'initialize') {
        if (!isNotification) {
          sendResult(id, {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: {
              tools: {},
              resources: {}
            },
            serverInfo: {
              name: SERVER_NAME,
              version: SERVER_VERSION
            }
          })
        }
        return
      }

      if (req.method === 'notifications/initialized' || req.method === 'notifications/cancelled') {
        return
      }

      if (req.method === 'ping') {
        if (!isNotification) sendResult(id, {})
        return
      }

      if (req.method === 'tools/list') {
        sendResult(id, { tools: TOOLS })
        return
      }

      if (req.method === 'resources/list') {
        const pages = store.getPages().filter(p => p.status !== 'deleted')
        const resources = [
          {
            uri: 'zhixu://schema',
            name: 'ZHIXU SPG Schema & Mutual Index Overview',
            description: 'JSON summary of storage domains, chunk counts, and extracted entities.',
            mimeType: 'application/json'
          },
          ...pages.map(p => ({
            uri: `zhixu://wiki/${p.slug}`,
            name: p.title,
            description: `[${p.status} · ${p.versionLabel ?? 'V1.0'}] ${p.summary}`.slice(0, 200),
            mimeType: 'text/markdown'
          }))
        ]
        sendResult(id, { resources })
        return
      }

      if (req.method === 'resources/read') {
        const uri = typeof req.params?.uri === 'string' ? req.params.uri : ''
        if (uri === 'zhixu://schema') {
          sendResult(id, {
            contents: [
              {
                uri,
                mimeType: 'application/json',
                text: JSON.stringify(store.getSchemaOverview(), null, 2)
              }
            ]
          })
          return
        }
        if (uri.startsWith('zhixu://wiki/')) {
          const slug = uri.slice('zhixu://wiki/'.length)
          const page = store.getPages().find(p => p.slug === slug && p.status !== 'deleted')
          if (!page) {
            sendError(id, -32002, `Wiki page not found: ${slug}`)
            return
          }
          const md = [
            `# ${page.title}`,
            `> ${page.summary}`,
            '',
            `- Status: ${page.status} | Version: ${page.versionLabel ?? 'V1.0'} | Domain: ${page.storageDomain ?? 'foundation'}`,
            page.applicability ? `- Applicability: ${page.applicability}` : '',
            '',
            page.content,
            page.sources.length
              ? `\n## Verified Sources\n${page.sources.map(s => `- **${s.file}** (${s.locator}): ${s.excerpt}`).join('\n')}`
              : ''
          ]
            .filter(Boolean)
            .join('\n')
          sendResult(id, {
            contents: [{ uri, mimeType: 'text/markdown', text: md }]
          })
          return
        }
        sendError(id, -32002, `Unknown resource URI: ${uri}`)
        return
      }

      if (req.method === 'tools/call') {
        const toolName = typeof req.params?.name === 'string' ? req.params.name : ''
        const args = (req.params?.arguments ?? {}) as Record<string, unknown>

        if (toolName === 'zhixu_search') {
          const query = typeof args.query === 'string' ? args.query.trim() : ''
          if (!query) throw new Error('query is required')
          const hits = await searchKnowledge(store, modelSettings, query, {
            domain: typeof args.domain === 'string' ? (args.domain as StorageDomain) : undefined,
            includeDrafts: Boolean(args.includeDrafts),
            includeSources: args.includeSources !== false,
            limit: typeof args.limit === 'number' ? Math.max(1, Math.min(25, Math.round(args.limit))) : 8
          })
          sendResult(id, {
            content: [{ type: 'text', text: JSON.stringify({ query, totalHits: hits.length, hits }, null, 2) }]
          })
          return
        }

        if (toolName === 'zhixu_ask') {
          const question = typeof args.question === 'string' ? args.question.trim() : ''
          if (!question) throw new Error('question is required')
          const answer = await askKnowledgeBase(store, modelSettings, question, {
            domain: typeof args.domain === 'string' ? (args.domain as StorageDomain) : undefined,
            includeDrafts: Boolean(args.includeDrafts),
            includeSources: args.includeSources !== false
          })
          sendResult(id, {
            content: [{ type: 'text', text: JSON.stringify(answer, null, 2) }]
          })
          return
        }

        if (toolName === 'zhixu_list_pages') {
          const statusFilter = typeof args.status === 'string' ? args.status : 'all'
          const domainFilter = typeof args.domain === 'string' ? args.domain : ''
          const pages = store
            .getPages()
            .filter(p => p.status !== 'deleted')
            .filter(p => (statusFilter === 'all' ? true : p.status === statusFilter))
            .filter(p => (domainFilter ? p.storageDomain === domainFilter : true))
            .map(p => ({
              slug: p.slug,
              title: p.title,
              status: p.status,
              version: p.versionLabel ?? 'V1.0',
              storageDomain: p.storageDomain ?? 'foundation',
              pageType: p.pageType,
              summary: p.summary,
              sourceCount: p.sources.length,
              linkCount: p.links.length,
              updatedAt: p.updatedAt
            }))
          sendResult(id, {
            content: [{ type: 'text', text: JSON.stringify({ root: kbRoot, count: pages.length, pages }, null, 2) }]
          })
          return
        }

        if (toolName === 'zhixu_read_page') {
          const slug = typeof args.slug === 'string' ? args.slug.trim() : ''
          if (!slug) throw new Error('slug is required')
          const page = store.getPages().find(p => p.slug === slug && p.status !== 'deleted')
          if (!page) {
            sendResult(id, {
              isError: true,
              content: [{ type: 'text', text: `Page not found: "${slug}". Call zhixu_list_pages to see available slugs.` }]
            })
            return
          }
          sendResult(id, {
            content: [{ type: 'text', text: JSON.stringify(page, null, 2) }]
          })
          return
        }

        if (toolName === 'zhixu_propose_draft') {
          const title = typeof args.title === 'string' ? args.title.trim() : ''
          const content = typeof args.content === 'string' ? args.content.trim() : ''
          if (!title || !content) throw new Error('title and content are required')
          // Strict governance guard: MCP agents can ONLY create/update drafts, never publish or delete baselines!
          const savedPage = await store.saveManualPage(
            {
              slug: typeof args.slug === 'string' && args.slug.trim() ? args.slug.trim() : undefined,
              title,
              summary: typeof args.summary === 'string' ? args.summary : '',
              content,
              applicability: typeof args.applicability === 'string' ? args.applicability : 'MCP Agent Draft',
              pageType: typeof args.pageType === 'string' ? (args.pageType as WikiPageType) : 'concept',
              storageDomain: typeof args.storageDomain === 'string' ? (args.storageDomain as StorageDomain) : undefined,
              publishImmediately: false,
              note: typeof args.note === 'string' && args.note.trim() ? args.note.trim() : 'Proposed via MCP agent (pending human review)'
            },
            'mcp-agent'
          )
          sendResult(id, {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    ok: true,
                    message: 'Draft saved into ZHIXU Review Queue (published baseline preserved untouched).',
                    slug: savedPage.slug,
                    status: savedPage.status,
                    versionLabel: savedPage.versionLabel
                  },
                  null,
                  2
                )
              }
            ]
          })
          return
        }

        if (toolName === 'zhixu_get_graph') {
          const maxEntities = typeof args.maxEntities === 'number' ? args.maxEntities : 60
          const graph = store.getKnowledgeGraph(maxEntities)
          sendResult(id, {
            content: [{ type: 'text', text: JSON.stringify(graph, null, 2) }]
          })
          return
        }

        sendError(id, -32601, `Unknown tool: ${toolName}`)
        return
      }

      if (!isNotification) {
        sendError(id, -32601, `Method not found: ${req.method}`)
      }
    } catch (error) {
      if (!isNotification) {
        const msg = error instanceof Error ? error.message : String(error)
        if (req.method === 'tools/call') {
          sendResult(id, {
            isError: true,
            content: [{ type: 'text', text: `Error: ${msg}` }]
          })
        } else {
          sendError(id, -32000, msg)
        }
      }
    }
  }

  let queue = Promise.resolve()
  rl.on('line', line => {
    const trimmed = line.trim()
    if (!trimmed) return
    let parsed: JsonRpcRequest
    try {
      parsed = JSON.parse(trimmed) as JsonRpcRequest
    } catch {
      sendError(null, -32700, 'Parse error')
      return
    }
    queue = queue.then(() => handleRequest(parsed))
  })

  rl.on('close', () => {
    queue.finally(() => {
      store.close()
      process.exit(0)
    })
  })
}

main().catch(err => {
  console.error('[zhixu-mcp] Fatal error:', err)
  process.exit(1)
})
