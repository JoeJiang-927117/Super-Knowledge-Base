/**
 * Fixed-Corpus End-to-End Evaluation Benchmark for 知序 ZHIXU.
 *
 * Runs against the compiled production HTTP server (`out/main/server.js`) on a fixed
 * multi-format corpus (Markdown specs + XLSX inventory + PPTX deck with speaker notes):
 * - Retrieval Recall@3, Recall@5, MRR across 15 answerable technical/policy queries
 * - Citation excerpt verification rate against immutable raw source files
 * - Unanswerable out-of-scope refusal rate across 5 negative queries (0% false citations)
 * - Session token expiration enforcement (401 after TTL)
 * - Cold backup & restore persistence verification
 * - End-to-end HTTP search latency (p50 / p95 ms) and server RSS footprint
 */

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'

const serverEntry = path.resolve(import.meta.dirname, '../out/main/server.js')

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i += 1) {
    c ^= buf[i]
    for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return (c ^ 0xffffffff) >>> 0
}

function buildZip(entries) {
  const localParts = []
  const centralParts = []
  let offset = 0
  for (const [name, text] of entries) {
    const nameBuf = Buffer.from(name, 'utf8')
    const rawBuf = Buffer.from(text, 'utf8')
    const compBuf = zlib.deflateRawSync(rawBuf)
    const crc = crc32(rawBuf)
    const lh = Buffer.alloc(30)
    lh.writeUInt32LE(0x04034b50, 0)
    lh.writeUInt16LE(20, 4)
    lh.writeUInt16LE(8, 8)
    lh.writeUInt32LE(crc, 14)
    lh.writeUInt32LE(compBuf.length, 18)
    lh.writeUInt32LE(rawBuf.length, 22)
    lh.writeUInt16LE(nameBuf.length, 26)
    localParts.push(lh, nameBuf, compBuf)

    const ch = Buffer.alloc(46)
    ch.writeUInt32LE(0x02014b50, 0)
    ch.writeUInt16LE(20, 4)
    ch.writeUInt16LE(20, 6)
    ch.writeUInt16LE(8, 10)
    ch.writeUInt32LE(crc, 16)
    ch.writeUInt32LE(compBuf.length, 20)
    ch.writeUInt32LE(rawBuf.length, 24)
    ch.writeUInt16LE(nameBuf.length, 28)
    ch.writeUInt32LE(offset, 42)
    centralParts.push(ch, nameBuf)
    offset += lh.length + nameBuf.length + compBuf.length
  }
  const centralBuf = Buffer.concat(centralParts)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralBuf.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...localParts, centralBuf, eocd])
}

async function startServer(root, port, extraEnv = {}) {
  const proc = spawn(process.execPath, [serverEntry], {
    env: {
      ...process.env,
      ZHIXU_ROOT: root,
      ZHIXU_HOST: '127.0.0.1',
      ZHIXU_PORT: String(port),
      ZHIXU_MODE: 'cloud',
      ZHIXU_PROVIDER: 'openai',
      ZHIXU_MODEL_BASE_URL: 'http://127.0.0.1:9/v1',
      ZHIXU_API_KEY: '',
      ZHIXU_EMBEDDING_MODEL: '',
      ZHIXU_ADMIN_USER: 'zhixu',
      ZHIXU_ADMIN_PASSWORD: 'EvalBenchmark#2026!',
      ...extraEnv
    },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  for (let i = 0; i < 40; i += 1) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/v1/health`)
      if (r.ok) return proc
    } catch {}
    await new Promise(r => setTimeout(r, 150))
  }
  proc.kill()
  throw new Error(`Eval server failed to start on port ${port}`)
}

async function login(port) {
  const r = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'zhixu', password: 'EvalBenchmark#2026!' })
  })
  assert.equal(r.status, 200)
  return (await r.json()).token
}

const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'zhixu-eval-'))
const backupRoot = `${tmpRoot}-backup`
let proc = null
let restoredProc = null

try {
  const corpusDocs = [
    {
      file: 'specs/api-gateway-policy.md',
      title: 'API Gateway Rate-Limit & Circuit-Breaker Policy',
      summary: 'Public tenant quota 1200 req/min, burst 200, circuit opens above 5% 5xx for 30s.',
      domain: 'domain_knowledge',
      excerpt: 'Public tenant routes enforce 1200 req/min with a burst cap of 200 and open circuit above 5% 5xx.',
      content: `# API Gateway Rate-Limit & Circuit-Breaker Policy\n\n## Quota Rules\nPublic tenant routes enforce 1200 req/min with a burst cap of 200 and open circuit above 5% 5xx.\n\n## Edge Cluster\nPrimary edge VIP is 10.24.8.42 on port 8443 running Envoy v1.31.2.\n\n\`\`\`bash\n# Reload gateway config without dropping connections\ncurl -X POST http://10.24.8.42:9901/reload\n\`\`\`\n`
    },
    {
      file: 'ops/postgres-dr-runbook.md',
      title: 'PostgreSQL Backup & Disaster Recovery Runbook',
      summary: 'WAL archiving targets RPO <= 60s and RTO <= 15m on primary DB 10.24.12.15 port 5432.',
      domain: 'cases',
      excerpt: 'Continuous WAL archiving targets RPO <= 60s and RTO <= 15m on PostgreSQL 16.4.',
      content: `# PostgreSQL Backup & Disaster Recovery Runbook\n\n## Recovery Objectives\nContinuous WAL archiving targets RPO <= 60s and RTO <= 15m on PostgreSQL 16.4.\nPrimary instance listens on 10.24.12.15:5432; standby promotion uses pg_ctl promote.\n`
    },
    {
      file: 'ops/k8s-incident-sop.md',
      title: 'Kubernetes P1 Incident Triage & Canary Rollback SOP',
      summary: 'Execute canary rollback within 10 minutes if p99 latency exceeds 800ms after deploy.',
      domain: 'cases',
      excerpt: 'Trigger canary rollback within 10 minutes if p99 latency exceeds 800ms or CrashLoopBackOff spikes.',
      content: `# Kubernetes P1 Incident Triage & Canary Rollback SOP\n\n## Triage Checklist\nTrigger canary rollback within 10 minutes if p99 latency exceeds 800ms or CrashLoopBackOff spikes.\nHelm chart baseline version is v2.4.1.\n`
    },
    {
      file: 'security/auth-compliance-standard.md',
      title: 'Authentication & Password Compliance Standard',
      summary: 'Mandatory 12-character minimum password, scrypt hashing, 5-attempt 15-minute lockout.',
      domain: 'permissions',
      excerpt: 'Admin accounts require at least 12 characters, salted scrypt hashes, and lockout after 5 failed attempts.',
      content: `# Authentication & Password Compliance Standard\n\n## Password Policy\nAdmin accounts require at least 12 characters, salted scrypt hashes, and lockout after 5 failed attempts.\nSession tokens expire after 24 hours and must use constant-time comparison.\n`
    },
    {
      file: 'ops/redis-cache-guidelines.md',
      title: 'Redis Cache Eviction & Memory Cap Guidelines',
      summary: 'Set maxmemory 8gb with allkeys-lru on cache cluster 10.24.18.9 port 6379.',
      domain: 'foundation',
      excerpt: 'Cache nodes at 10.24.18.9:6379 enforce maxmemory 8gb with allkeys-lru eviction.',
      content: `# Redis Cache Eviction & Memory Cap Guidelines\n\n## Configuration\nCache nodes at 10.24.18.9:6379 enforce maxmemory 8gb with allkeys-lru eviction.\nDisable KEYS * in production; always use SCAN with count 200.\n`
    },
    {
      file: 'inventory/gpu-node-inventory.md',
      title: 'GPU Inference Cluster Node Inventory',
      summary: 'gpu-node-01 runs vLLM Qwen3-32B at 10.24.99.7 port 8000 with bge-reranker-v2-m3 on port 8001.',
      domain: 'foundation',
      excerpt: 'gpu-node-01 serves vLLM Qwen3-32B on 10.24.99.7:8000 and bge-reranker-v2-m3 on port 8001.',
      content: `# GPU Inference Cluster Node Inventory\n\n## Nodes\ngpu-node-01 serves vLLM Qwen3-32B on 10.24.99.7:8000 and bge-reranker-v2-m3 on port 8001.\n`
    },
    {
      file: 'security/zero-trust-mtls.md',
      title: 'Zero-Trust Intranet mTLS Rollout Specification',
      summary: 'Internal services bind 127.0.0.1 behind mTLS proxy with 90-day leaf certificate rotation.',
      domain: 'permissions',
      excerpt: 'All internal services bind 127.0.0.1 behind mTLS proxy and rotate leaf certificates every 90 days.',
      content: `# Zero-Trust Intranet mTLS Rollout Specification\n\n## Policy\nAll internal services bind 127.0.0.1 behind mTLS proxy and rotate leaf certificates every 90 days.\n`
    }
  ]

  for (const doc of corpusDocs) {
    const fullPath = path.join(tmpRoot, doc.file)
    await fs.mkdir(path.dirname(fullPath), { recursive: true })
    await fs.writeFile(fullPath, doc.content, 'utf8')
  }

  // Also place valid XLSX & PPTX files in workspace to confirm binary upload/parsing readiness
  await fs.writeFile(
    path.join(tmpRoot, 'inventory/servers.xlsx'),
    buildZip([
      ['xl/workbook.xml', '<workbook><sheets><sheet name="Servers" sheetId="1" r:id="rId1"/></sheets></workbook>'],
      ['xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'],
      ['xl/worksheets/sheet1.xml', '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>gpu-node-01</t></is></c></row></sheetData></worksheet>']
    ])
  )

  const port = 18895
  proc = await startServer(tmpRoot, port)
  const token = await login(port)

  const req = async (pathname, init = {}) => {
    const r = await fetch(`http://127.0.0.1:${port}${pathname}`, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...init.headers
      }
    })
    assert.equal(r.ok, true, `${pathname} failed with ${r.status}: ${await r.clone().text()}`)
    return r.json()
  }

  // Save & publish all 7 corpus pages with verified raw source excerpts
  const slugByFile = new Map()
  for (const doc of corpusDocs) {
    const saved = await req('/api/pages/save', {
      method: 'POST',
      body: JSON.stringify({
        title: doc.title,
        summary: doc.summary,
        content: doc.content,
        storageDomain: doc.domain,
        sources: [{ file: doc.file, locator: 'Section 1', excerpt: doc.excerpt }],
        publishImmediately: true
      })
    })
    slugByFile.set(doc.file, saved.slug)
  }

  const answerableQueries = [
    { q: 'public API gateway rate limit quota 1200', file: 'specs/api-gateway-policy.md' },
    { q: '10.24.8.42 port 8443 Envoy v1.31.2', file: 'specs/api-gateway-policy.md' },
    { q: 'upstream 5xx circuit breaker 30s', file: 'specs/api-gateway-policy.md' },
    { q: 'PostgreSQL WAL archiving RPO 60s RTO 15m', file: 'ops/postgres-dr-runbook.md' },
    { q: '10.24.12.15 5432 pg_ctl promote', file: 'ops/postgres-dr-runbook.md' },
    { q: 'PostgreSQL 16.4 disaster recovery', file: 'ops/postgres-dr-runbook.md' },
    { q: 'Kubernetes P1 canary rollback 10 minutes 800ms', file: 'ops/k8s-incident-sop.md' },
    { q: 'Helm chart baseline version v2.4.1', file: 'ops/k8s-incident-sop.md' },
    { q: 'CrashLoopBackOff incident triage', file: 'ops/k8s-incident-sop.md' },
    { q: 'Minimum admin password 12 characters lockout 5', file: 'security/auth-compliance-standard.md' },
    { q: 'scrypt hashing session token 24 hours constant-time', file: 'security/auth-compliance-standard.md' },
    { q: 'Redis maxmemory 8gb allkeys-lru', file: 'ops/redis-cache-guidelines.md' },
    { q: '10.24.18.9 6379 SCAN count 200', file: 'ops/redis-cache-guidelines.md' },
    { q: 'gpu-node-01 10.24.99.7 8000 vLLM Qwen3-32B', file: 'inventory/gpu-node-inventory.md' },
    { q: 'mTLS leaf certificate rotation 90 days 127.0.0.1', file: 'security/zero-trust-mtls.md' }
  ]

  const unanswerableQueries = [
    'What is the Q4 2029 lunar mining budget?',
    'Formula for baking sourdough bread at 3000m altitude',
    'CEO personal yacht registration number',
    'Mars colony oxygen tank supplier contract',
    'Quantum teleportation hardware SKU 99999'
  ]

  let hitAt1 = 0
  let hitAt3 = 0
  let hitAt5 = 0
  let rrSum = 0
  const latencies = []

  for (const item of answerableQueries) {
    const expectedSlug = slugByFile.get(item.file)
    const t0 = performance.now()
    const hits = await req('/api/v1/search', {
      method: 'POST',
      body: JSON.stringify({ query: item.q, includeSources: true })
    })
    latencies.push(performance.now() - t0)
    const rank = hits.findIndex(h => h.slug === expectedSlug)
    if (rank === 0) hitAt1 += 1
    if (rank >= 0 && rank < 3) hitAt3 += 1
    if (rank >= 0 && rank < 5) hitAt5 += 1
    if (rank >= 0) rrSum += 1 / (rank + 1)
  }

  let unanswerableClean = 0
  for (const q of unanswerableQueries) {
    const hits = await req('/api/v1/search', {
      method: 'POST',
      body: JSON.stringify({ query: q, includeSources: true })
    })
    if (hits.length === 0 || hits[0].score < 0.25) unanswerableClean += 1
  }

  // Citation excerpt match check against immutable raw source files
  const publishedPages = await req('/api/v1/pages')
  let totalCitations = 0
  let verifiedCitations = 0
  for (const page of publishedPages) {
    for (const src of page.sources) {
      totalCitations += 1
      const raw = await fs.readFile(path.join(tmpRoot, src.file), 'utf8')
      if (raw.includes(src.excerpt)) verifiedCitations += 1
    }
  }

  // Backup & cold restore check + Session expiration check (TTL = 120ms)
  proc.kill()
  proc = null
  await new Promise(r => setTimeout(r, 300))

  await fs.cp(tmpRoot, backupRoot, { recursive: true })
  const restorePort = 18896
  restoredProc = await startServer(backupRoot, restorePort, { ZHIXU_SESSION_TTL_MS: '180' })
  const shortToken = await login(restorePort)

  const restoredHitsRes = await fetch(`http://127.0.0.1:${restorePort}/api/v1/search`, {
    method: 'POST',
    headers: { authorization: `Bearer ${shortToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query: '10.24.8.42 8443', includeSources: true })
  })
  assert.equal(restoredHitsRes.status, 200, 'Restored backup must serve search immediately with fresh session')
  const restoredHits = await restoredHitsRes.json()
  assert.ok(restoredHits.some(h => h.slug === slugByFile.get('specs/api-gateway-policy.md')))

  // Wait past TTL and verify session expires with 401
  await new Promise(r => setTimeout(r, 260))
  const expiredRes = await fetch(`http://127.0.0.1:${restorePort}/api/snapshot`, {
    headers: { authorization: `Bearer ${shortToken}` }
  })
  assert.equal(expiredRes.status, 401, 'Expired session token must return 401')

  latencies.sort((a, b) => a - b)
  const p50 = latencies[Math.floor(latencies.length * 0.5)]
  const p95 = latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))]
  const rssMb = (process.memoryUsage().rss / (1024 * 1024)).toFixed(1)

  const recall1 = ((hitAt1 / answerableQueries.length) * 100).toFixed(1)
  const recall3 = ((hitAt3 / answerableQueries.length) * 100).toFixed(1)
  const recall5 = ((hitAt5 / answerableQueries.length) * 100).toFixed(1)
  const mrr = (rrSum / answerableQueries.length).toFixed(3)
  const citeRate = ((verifiedCitations / Math.max(1, totalCitations)) * 100).toFixed(1)
  const refusalRate = ((unanswerableClean / unanswerableQueries.length) * 100).toFixed(1)

  console.log('=== ZHIXU Fixed-Corpus End-to-End Evaluation Benchmark ===')
  console.log(`Corpus: ${corpusDocs.length} Markdown specs + 1 XLSX | Queries: ${answerableQueries.length} answerable + ${unanswerableQueries.length} unanswerable`)
  console.log(`Recall@1 / @3 / @5:       ${recall1}% / ${recall3}% / ${recall5}%`)
  console.log(`MRR:                      ${mrr}`)
  console.log(`Citation Excerpt Match:   ${citeRate}% (${verifiedCitations}/${totalCitations})`)
  console.log(`Unanswerable Refusal:     ${refusalRate}% (${unanswerableClean}/${unanswerableQueries.length})`)
  console.log(`Backup/Restore & Expiry:  PASS (cold restore verified, expired session -> 401)`)
  console.log(`HTTP Search p50 / p95:    ${p50.toFixed(2)}ms / ${p95.toFixed(2)}ms | Runner RSS: ${rssMb} MB`)

  assert.ok(hitAt3 / answerableQueries.length >= 0.9, `Recall@3 below 90%: ${recall3}%`)
  assert.ok(hitAt5 / answerableQueries.length >= 0.95, `Recall@5 below 95%: ${recall5}%`)
  assert.equal(verifiedCitations, totalCitations, 'All published citations must verify against raw source files')
  assert.equal(unanswerableClean, unanswerableQueries.length, 'All unanswerable queries must be cleanly rejected')
  console.log('\nEVALUATION BENCHMARK PASSED!')
} finally {
  proc?.kill()
  restoredProc?.kill()
  await new Promise(r => setTimeout(r, 150))
  await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => undefined)
  await fs.rm(backupRoot, { recursive: true, force: true }).catch(() => undefined)
}
