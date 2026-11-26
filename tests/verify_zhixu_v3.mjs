/**
 * ZHIXU v0.3.0 Automated Verification Suite:
 * 1. Standard MCP Server (`out/main/mcp.js`) JSON-RPC 2.0 over stdio
 *    - initialize / ping / tools/list / resources/list / resources/read
 *    - zhixu_propose_draft (verifies strict draft-only governance)
 *    - zhixu_list_pages / zhixu_read_page / zhixu_search / zhixu_get_graph
 * 2. Pure-JS Scanned PDF Vision-OCR PNG encoder & 1-bit bitmap extractor (`src/main/pdf-ocr.ts`)
 */

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'
import { encodeRawImageToPng, extractScannedPdfPagePng } from '../src/main/pdf-ocr.ts'

async function verifyPdfOcrEncoder() {
  // 1. RGB 4x3 PNG verification
  const rgb = new Uint8Array(4 * 3 * 3).fill(128)
  const pngRgb = encodeRawImageToPng(4, 3, rgb, 3)
  assert.equal(pngRgb.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'RGB PNG signature valid')
  assert.equal(pngRgb.readUInt32BE(16), 4, 'RGB PNG width')
  assert.equal(pngRgb.readUInt32BE(20), 3, 'RGB PNG height')

  // 2. Oversized scanned page downscaling (2400x1600 -> maxDim 800 -> 800x533)
  const hugeGray = new Uint8Array(2400 * 1600).fill(240)
  const pngScaled = encodeRawImageToPng(2400, 1600, hugeGray, 1, 800)
  assert.equal(pngScaled.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'Scaled PNG signature valid')
  assert.equal(pngScaled.readUInt32BE(16), 800, 'Downscaled width == 800')
  assert.equal(pngScaled.readUInt32BE(20), 533, 'Downscaled height == 533')

  // 3. Mock scanned PDF page with 1-bit monochrome scan bitmap (200x150)
  const width = 200
  const height = 150
  const packed = new Uint8Array(Math.ceil(width / 8) * height).fill(0xaa)
  const OPS = { paintImageXObject: 85, paintInlineImageXObject: 86, paintJpegXObject: 82 }
  const mockPage = {
    getOperatorList: async () => ({ fnArray: [85], argsArray: [['img_p0_1']] }),
    objs: {
      has: (id) => id === 'img_p0_1',
      get: () => ({ width, height, data: packed, kind: 1 })
    }
  }
  const extracted = await extractScannedPdfPagePng(mockPage, OPS)
  assert.ok(extracted && extracted.length > 64, 'Extracted scanned PDF page PNG')
  assert.equal(extracted.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'Extracted PNG magic header')
  assert.equal(extracted.readUInt32BE(16), width, 'Extracted width matches')
  assert.equal(extracted.readUInt32BE(20), height, 'Extracted height matches')
  console.log('✓ v0.3.0 Scanned PDF Vision-OCR PNG encoder & extractor verified')
}

async function verifyMcpServer() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'zhixu-mcp-test-'))
  const mcpEntry = path.resolve('out/main/mcp.js')
  const child = spawn(process.execPath, [mcpEntry, '--root', tempRoot], {
    stdio: ['pipe', 'pipe', 'pipe']
  })

  const pending = new Map()
  const rl = readline.createInterface({ input: child.stdout })
  rl.on('line', line => {
    const trimmed = line.trim()
    if (!trimmed) return
    const msg = JSON.parse(trimmed)
    if (msg.id !== undefined && pending.has(msg.id)) {
      const { resolve } = pending.get(msg.id)
      pending.delete(msg.id)
      resolve(msg)
    }
  })

  let nextId = 1
  const callRpc = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`MCP RPC timeout: ${method}`))
      }, 15_000)
      pending.set(id, {
        resolve: msg => {
          clearTimeout(timer)
          resolve(msg)
        }
      })
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
    })

  try {
    // 1. Initialize handshake
    const init = await callRpc('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'verify-test', version: '1.0.0' }
    })
    assert.equal(init.result?.serverInfo?.name, 'zhixu-mcp', 'MCP server name')
    assert.equal(init.result?.serverInfo?.version, '0.3.0', 'MCP server version')

    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`)
    const pong = await callRpc('ping')
    assert.ok(pong.result !== undefined, 'MCP ping ok')

    // 2. List tools
    const toolsRes = await callRpc('tools/list')
    const toolNames = (toolsRes.result?.tools ?? []).map(t => t.name)
    for (const expected of [
      'zhixu_search',
      'zhixu_ask',
      'zhixu_list_pages',
      'zhixu_read_page',
      'zhixu_propose_draft',
      'zhixu_get_graph'
    ]) {
      assert.ok(toolNames.includes(expected), `MCP tool registered: ${expected}`)
    }

    // 3. Governance-safe draft proposal (must stay draft!)
    const proposeRes = await callRpc('tools/call', {
      name: 'zhixu_propose_draft',
      arguments: {
        title: 'Kubernetes Canary Rollback Guide',
        summary: 'Zero-downtime canary rollback checklist for edge gateways.',
        content: '## Canary Rollback Steps\n\n1. Check error ratio above 5%.\n2. Run `kubectl rollout undo deployment/edge-gateway`.',
        pageType: 'protocol',
        storageDomain: 'domain_knowledge',
        note: 'Proposed in MCP test'
      }
    })
    const proposePayload = JSON.parse(proposeRes.result.content[0].text)
    assert.equal(proposePayload.ok, true, 'Draft proposal succeeded')
    assert.equal(proposePayload.status, 'draft', 'MCP agent writes MUST stay draft (never auto-publish)')
    const draftSlug = proposePayload.slug

    // 4. List & read page
    const listRes = await callRpc('tools/call', { name: 'zhixu_list_pages', arguments: {} })
    const listPayload = JSON.parse(listRes.result.content[0].text)
    assert.ok(listPayload.pages.some(p => p.slug === draftSlug), 'Proposed page appears in zhixu_list_pages')

    const readRes = await callRpc('tools/call', { name: 'zhixu_read_page', arguments: { slug: draftSlug } })
    const readPayload = JSON.parse(readRes.result.content[0].text)
    assert.equal(readPayload.title, 'Kubernetes Canary Rollback Guide')

    // 5. Search draft with includeDrafts: true
    const searchRes = await callRpc('tools/call', {
      name: 'zhixu_search',
      arguments: { query: 'Canary Rollback', includeDrafts: true, limit: 5 }
    })
    const searchPayload = JSON.parse(searchRes.result.content[0].text)
    assert.ok(searchPayload.totalHits >= 1, 'MCP search finds proposed draft when includeDrafts=true')

    // 6. Knowledge Graph tool
    const graphRes = await callRpc('tools/call', { name: 'zhixu_get_graph', arguments: { maxEntities: 50 } })
    const graphPayload = JSON.parse(graphRes.result.content[0].text)
    assert.ok(graphPayload.totalWikiPages >= 1, 'Graph reports Wiki nodes')
    assert.ok(graphPayload.nodes.some(n => n.id === `wiki:${draftSlug}`), 'Graph contains proposed Wiki node')

    // 7. MCP Resources list & read
    const resList = await callRpc('resources/list')
    assert.ok(resList.result.resources.some(r => r.uri === 'zhixu://schema'), 'zhixu://schema resource exposed')
    assert.ok(resList.result.resources.some(r => r.uri === `zhixu://wiki/${draftSlug}`), 'Wiki resource exposed')

    const resRead = await callRpc('resources/read', { uri: `zhixu://wiki/${draftSlug}` })
    assert.ok(resRead.result.contents[0].text.includes('kubectl rollout undo'), 'Wiki resource readable')

    console.log('✓ v0.3.0 Standard MCP Server (stdio JSON-RPC 2.0 + draft governance + graph + resources) verified')
  } finally {
    child.kill()
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {})
  }
}

await verifyPdfOcrEncoder()
await verifyMcpServer()
console.log('\nALL ZHIXU V3 (MCP + GRAPH + PDF-OCR) CHECKS PASSED!')
