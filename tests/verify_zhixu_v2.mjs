import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'zhixu-v2-test-'))
const serverEntry = path.resolve(import.meta.dirname, '../out/main/server.js')

await fs.writeFile(
  path.join(tmpRoot, '生态流量保障规程.md'),
  `# 生态流量保障规程

## 1. 控制断面标准
重要河湖必须设定生态流量控制断面与预警水位阈值。当水位连续 24 小时低于目标阈值时，立即启动应急生态调度。
`,
  'utf8'
)

const png1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
)
await fs.writeFile(path.join(tmpRoot, '监测断面实拍.png'), png1x1)

// Track 3-tier model calls (LLLM, LLM, VM) & embedding cache hits!
const calledModels = new Set()
let embedBatchCalls = 0
let qaMode = 'insufficient'
let organizeRound = 1

const mockApi = http.createServer(async (req, res) => {
  const chunks = []
  for await (const c of req) chunks.push(c)
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}

  if (req.url === '/v1/models') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ data: [{ id: 'mock-lllm' }, { id: 'mock-llm' }, { id: 'mock-vm' }] }))
    return
  }

  if (req.url === '/v1/embeddings') {
    const inputs = Array.isArray(body.input) ? body.input : [body.input]
    if (inputs.length > 1) embedBatchCalls += 1
    const data = inputs.map((_, index) => ({
      index,
      embedding: [0.25 + index * 0.01, 0.5, 0.75, 0.1]
    }))
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ data }))
    return
  }

  if (req.url === '/v1/chat/completions') {
    calledModels.add(body.model)
    const lastMsg = body.messages?.[body.messages.length - 1]
    if (Array.isArray(lastMsg?.content)) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({
          choices: [{ message: { content: '监测断面水位标尺清晰可见，当前水位处于安全绿色区间。' } }]
        })
      )
      return
    }

    const promptText = String(body.messages?.map(m => m.content).join('\n') ?? '')
    let payload
    if (promptText.includes('知识库问答引擎')) {
      if (qaMode === 'insufficient') {
        payload = {
          conclusion: '当前证据不足，无法确定具体年份的降雨量数据。',
          applicability: '证据不足',
          conflicts: '无',
          missingInfo: '缺少历史水文降雨记录',
          insufficientEvidence: true,
          citedIds: []
        }
      } else {
        payload = {
          conclusion: '当水位连续 24 小时低于目标阈值时，应立即启动应急生态调度。',
          applicability: '纳入生态流量保障的重点河湖',
          conflicts: '无',
          missingInfo: '无',
          insufficientEvidence: false,
          citedIds: [] // intentionally empty to test honest fallback labeling!
        }
      }
    } else if (promptText.includes('可核验的知识笔记')) {
      if (promptText.includes('生态流量保障规程.md')) {
        payload = {
          summary: '生态流量控制断面与低水位预警调度规程。',
          topics: ['生态流量', '控制断面', '应急调度'],
          keyPoints: [
            {
              point: '水位连续 24 小时低于阈值启动应急调度',
              excerpt: '当水位连续 24 小时低于目标阈值时，立即启动应急生态调度。'
            }
          ]
        }
      } else {
        payload = {
          summary: '监测断面实拍图像资产记录。',
          topics: ['监测断面', '水位标尺'],
          keyPoints: [
            {
              point: '实拍显示监测断面水位处于绿色安全区间',
              excerpt: '监测断面水位标尺清晰可见，当前水位处于安全绿色区间。'
            }
          ]
        }
      }
    } else if (organizeRound === 1) {
      payload = {
        summary: '建立生态流量保障规程知识页。',
        overview: '知序知识库覆盖生态流量保障与监测断面实拍。',
        operations: [
          {
            action: 'upsert',
            slug: 'eco-flow',
            title: '生态流量保障规程',
            summary: '控制断面水位连续 24 小时低于阈值时启动应急生态调度。',
            content: '详见生态流量控制断面管理要求与现场实拍水位标尺。',
            pageType: 'regulation',
            evidenceLevel: 'official_doc',
            applicability: '重点河湖生态流量保障',
            sources: [
              {
                file: '生态流量保障规程.md',
                excerpt: '当水位连续 24 小时低于目标阈值时，立即启动应急生态调度。'
              }
            ],
            links: [],
            schemaEntities: ['生态流量', '控制断面']
          }
        ]
      }
    } else {
      // Round 2: Model attempts to DELETE eco-flow — must be intercepted into pending_delete!
      payload = {
        summary: '模型尝试删除旧页面 eco-flow',
        overview: '测试删除审批保护机制',
        operations: [
          {
            action: 'delete',
            slug: 'eco-flow',
            title: '',
            summary: '',
            content: '',
            pageType: 'regulation',
            evidenceLevel: 'official_doc',
            applicability: '',
            sources: [],
            links: [],
            schemaEntities: []
          }
        ]
      }
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) } }] }))
    return
  }

  res.writeHead(404)
  res.end('not found')
})

await new Promise(resolve => mockApi.listen(0, '127.0.0.1', resolve))
const mockPort = mockApi.address().port

// Boot server WITHOUT ZHIXU_SERVER_TOKEN to verify P0 mandatory auth by default!
const serverPort = 18887
const serverProc = spawn(process.execPath, [serverEntry], {
  env: {
    ...process.env,
    ZHIXU_ROOT: tmpRoot,
    ZHIXU_PORT: String(serverPort),
    ZHIXU_MODE: 'cloud',
    ZHIXU_PROVIDER: 'openai',
    ZHIXU_MODEL_BASE_URL: `http://127.0.0.1:${mockPort}/v1`,
    ZHIXU_API_KEY: 'sk-test-external-api',
    ZHIXU_LLLM_MODEL: 'mock-lllm',
    ZHIXU_LLM_MODEL: 'mock-llm',
    ZHIXU_VISION_MODEL: 'mock-vm',
    ZHIXU_EMBEDDING_MODEL: 'mock-embed',
    ZHIXU_SERVER_TOKEN: '' // intentionally empty to prove P0 fix still blocks unauthenticated requests!
  },
  stdio: ['ignore', 'pipe', 'pipe']
})

serverProc.stdout.on('data', d => process.stdout.write(`[zhixu-server] ${d}`))
serverProc.stderr.on('data', d => process.stderr.write(`[zhixu-server:err] ${d}`))

async function waitReady() {
  for (let i = 0; i < 30; i += 1) {
    try {
      const r = await fetch(`http://127.0.0.1:${serverPort}/api/v1/health`)
      if (r.ok) return await r.json()
    } catch {}
    await new Promise(r => setTimeout(r, 200))
  }
  throw new Error('Server did not start')
}

let sessionToken = ''
async function api(pathname, init = {}) {
  const res = await fetch(`http://127.0.0.1:${serverPort}${pathname}`, {
    ...init,
    headers: {
      ...(sessionToken ? { authorization: `Bearer ${sessionToken}` } : {}),
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...init.headers
    }
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${pathname} failed (${res.status}): ${text}`)
  return JSON.parse(text)
}

try {
  const health = await waitReady()
  assert.equal(health.ok, true)
  assert.equal(health.authEnabled, true, 'P0: Server must enforce auth even without ZHIXU_SERVER_TOKEN')

  // P0 check: Unauthenticated snapshot must fail with 401
  const unauth = await fetch(`http://127.0.0.1:${serverPort}/api/snapshot`)
  assert.equal(unauth.status, 401, 'P0: Unauthenticated request must return 401')
  console.log('✓ P0: Default server auth enforcement verified (401 without token)')

  // Admin auth check: Wrong password fails, default zhixu / 123456789 succeeds
  const badLogin = await fetch(`http://127.0.0.1:${serverPort}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'zhixu', password: 'wrong' })
  })
  assert.notEqual(badLogin.status, 200)

  const loginRes = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'zhixu', password: '123456789' })
  })
  sessionToken = loginRes.token
  assert.equal(loginRes.user.username, 'zhixu')
  assert.equal(loginRes.user.role, 'superadmin')

  // Create & delete a reviewer account
  let snap = await api('/api/auth/users', {
    method: 'POST',
    body: JSON.stringify({ username: 'reviewer01', password: 'PassWord123', role: 'reviewer' })
  })
  assert.equal(snap.adminAuth.users.length, 2)
  snap = await api('/api/auth/users/delete', {
    method: 'POST',
    body: JSON.stringify({ username: 'reviewer01' })
  })
  assert.equal(snap.adminAuth.users.length, 1)
  console.log('✓ Admin auth system (zhixu / 123456789 + user CRUD) verified')

  // Organize round 1 — verify LLLM, LLM, VM three-tier routing
  const org1 = await api('/api/organize', { method: 'POST' })
  assert.equal(org1.status, 'completed')
  assert.equal(calledModels.has('mock-lllm'), true, 'LLLM tier must be called for wiki planning')
  assert.equal(calledModels.has('mock-llm'), true, 'LLM tier must be called for note extraction')
  assert.equal(calledModels.has('mock-vm'), true, 'VM tier must be called for image analysis')
  console.log('✓ Three-tier API routing (LLLM + LLM + VM) verified:', [...calledModels].join(', '))

  // Publish eco-flow as admin zhixu
  snap = await api('/api/publish', { method: 'POST', body: JSON.stringify({ slug: 'eco-flow' }) })
  const pubPage = snap.pages.find(p => p.slug === 'eco-flow')
  assert.equal(pubPage.status, 'published')
  assert.equal(pubPage.reviewedBy, 'zhixu')

  // P1 Persistent SQLite Vector Cache verification
  await api('/api/v1/search', { method: 'POST', body: JSON.stringify({ query: '生态流量 24小时', includeSources: true }) })
  const callsAfterFirst = embedBatchCalls
  assert.ok(callsAfterFirst >= 1, 'First search should populate SQLite embeddings cache')
  await api('/api/v1/search', { method: 'POST', body: JSON.stringify({ query: '控制断面 应急调度', includeSources: true }) })
  assert.equal(embedBatchCalls, callsAfterFirst, 'Second search must hit persistent SQLite/Orama cache with 0 document re-embeds')
  const cachedSnap = await api('/api/snapshot')
  assert.ok(cachedSnap.cachedEmbeddingCount >= 2, 'SQLite embeddings table must persist vectors')
  console.log(`✓ P1: Persistent SQLite vector cache verified (cached=${cachedSnap.cachedEmbeddingCount}, batchCalls=${embedBatchCalls})`)

  // P2 Honest QA citations verification
  qaMode = 'insufficient'
  const qaInsuff = await api('/api/v1/ask', { method: 'POST', body: JSON.stringify({ question: '2020年降雨量是多少？' }) })
  assert.equal(qaInsuff.insufficientEvidence, true)
  assert.equal(qaInsuff.citations.length, 0, 'P2: Insufficient evidence must NOT fabricate top-3 fallback citations')

  qaMode = 'fallback_label'
  const qaFallback = await api('/api/v1/ask', { method: 'POST', body: JSON.stringify({ question: '生态流量低于阈值怎么处理？' }) })
  assert.equal(qaFallback.insufficientEvidence, false)
  assert.ok(qaFallback.citations.length > 0 && qaFallback.citations[0].isFallback === true)
  assert.ok(qaFallback.citations[0].label.includes('检索参考候选'))
  console.log('✓ P2: Honest QA citation handling verified (0 fake cites on insufficient, explicit fallback label)')

  // P1 Deletion Approval + Recycle Bin verification
  organizeRound = 2
  await fs.writeFile(path.join(tmpRoot, '触发二次整理.txt'), '这是一份用于触发二次增量整理的新资料。', 'utf8')
  const org2 = await api('/api/organize', { method: 'POST' })
  const afterModelDelete = org2.snapshot.pages.find(p => p.slug === 'eco-flow')
  assert.ok(afterModelDelete, 'P1: Model delete MUST NOT erase page from database')
  assert.equal(afterModelDelete.status, 'pending_delete', 'P1: Model delete must enter pending_delete approval state')

  // Reject delete -> restores published!
  snap = await api('/api/workflow/transition', {
    method: 'POST',
    body: JSON.stringify({ slug: 'eco-flow', action: 'reject_delete', note: '管理员驳回删除' })
  })
  assert.equal(snap.pages.find(p => p.slug === 'eco-flow').status, 'published')

  // Confirm delete -> moves to recycle bin (deleted), then restore -> draft, then confirm_delete + purge
  snap = await api('/api/workflow/transition', {
    method: 'POST',
    body: JSON.stringify({ slug: 'eco-flow', action: 'confirm_delete', note: '移入回收站' })
  })
  assert.equal(snap.pages.find(p => p.slug === 'eco-flow').status, 'deleted')
  assert.equal(snap.deletedCount, 1)

  snap = await api('/api/workflow/transition', {
    method: 'POST',
    body: JSON.stringify({ slug: 'eco-flow', action: 'restore_deleted', note: '从回收站恢复' })
  })
  assert.equal(snap.pages.find(p => p.slug === 'eco-flow').status, 'draft')

  await api('/api/workflow/transition', {
    method: 'POST',
    body: JSON.stringify({ slug: 'eco-flow', action: 'confirm_delete', note: '再次移入回收站' })
  })
  snap = await api('/api/pages/purge', { method: 'POST', body: JSON.stringify({ slug: 'eco-flow' }) })
  assert.equal(snap.pages.some(p => p.slug === 'eco-flow'), false, 'Purge should remove page from recycle bin')
  console.log('✓ P1: Model deletion approval + recycle bin + restore + purge verified')

  // Manual page creation, editing, versioning & multi-turn QA history verification
  const created = await api('/api/pages/save', {
    method: 'POST',
    body: JSON.stringify({
      title: '人工运维经验',
      summary: '端口 8787 巡检记录',
      content: '## 检查步骤\n检查 192.168.1.100 端口 8787 响应。',
      publishImmediately: true
    })
  })
  assert.ok(created.slug)
  const edited = await api('/api/pages/save', {
    method: 'POST',
    body: JSON.stringify({
      slug: created.slug,
      title: '人工运维经验',
      summary: '端口 8787 巡检记录（修订）',
      content: '## 检查步骤\n检查 192.168.1.100 端口 8787 与健康接口响应。',
      publishImmediately: false
    })
  })
  const editedPage = edited.snapshot.pages.find(p => p.slug === created.slug)
  assert.equal(editedPage.status, 'draft', 'Manual draft edit preserves published baseline for diff/review')
  const versions = await api(`/api/versions?slug=${encodeURIComponent(created.slug)}`)
  assert.ok(versions.length >= 2, 'Manual edits must record version snapshots')

  qaMode = 'fallback_label'
  const followUp = await api('/api/v1/ask', {
    method: 'POST',
    body: JSON.stringify({
      question: '那端口是多少？',
      includeDrafts: true,
      history: [{ question: '人工运维经验里提到什么端口？', conclusion: '提到端口 8787。' }]
    })
  })
  assert.ok(followUp.conclusion.length > 0 && followUp.hits.length > 0, 'Multi-turn follow-up QA must resolve context and return hits')
  console.log('✓ Manual Wiki editor + version chain + multi-turn follow-up QA verified')

  console.log('\nALL ZHIXU V2 VERIFICATION CHECKS PASSED!')
} finally {
  serverProc.kill()
  mockApi.close()
  await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => undefined)
}
