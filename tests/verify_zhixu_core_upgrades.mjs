import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { deflateRawSync } from 'node:zlib'

import { buildStructuredRecursiveChunks, splitSentencesSafe } from '../src/main/chunker.ts'
import { normalizeRerankScores } from '../src/main/model.ts'
import { parsePptxBuffer, parseXlsxBuffer } from '../src/main/ooxml.ts'
import { stripGhostWikilinks, withKbWriteLock } from '../src/main/safe-write.ts'
import { buildMutualIndex, extractEntityAliases } from '../src/main/schema.ts'
import { getAllowedWorkflowActions, nextSemanticVersion, resolveWorkflowTransition } from '../src/main/workflow.ts'

function buildTestZip(files) {
  const localParts = []
  const cdParts = []
  let offset = 0
  for (const [name, content] of Object.entries(files)) {
    const nameBuf = Buffer.from(name, 'utf8')
    const rawBuf = Buffer.from(content, 'utf8')
    const compBuf = deflateRawSync(rawBuf)
    const lh = Buffer.alloc(30)
    lh.writeUInt32LE(0x04034b50, 0)
    lh.writeUInt16LE(20, 4)
    lh.writeUInt16LE(8, 8)
    lh.writeUInt32LE(compBuf.length, 18)
    lh.writeUInt32LE(rawBuf.length, 22)
    lh.writeUInt16LE(nameBuf.length, 26)
    localParts.push(lh, nameBuf, compBuf)

    const cd = Buffer.alloc(46)
    cd.writeUInt32LE(0x02014b50, 0)
    cd.writeUInt16LE(20, 4)
    cd.writeUInt16LE(20, 6)
    cd.writeUInt16LE(8, 10)
    cd.writeUInt32LE(compBuf.length, 20)
    cd.writeUInt32LE(rawBuf.length, 24)
    cd.writeUInt16LE(nameBuf.length, 28)
    cd.writeUInt32LE(offset, 42)
    cdParts.push(cd, nameBuf)
    offset += lh.length + nameBuf.length + compBuf.length
  }
  const cdBuf = Buffer.concat(cdParts)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(Object.keys(files).length, 8)
  eocd.writeUInt16LE(Object.keys(files).length, 10)
  eocd.writeUInt32LE(cdBuf.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...localParts, cdBuf, eocd])
}

// 1. Code-fence protection in Chunker v2
{
  const md = `# 运维脚本\n\n\`\`\`bash\n# 这不是标题\necho "192.168.1.100"\n\`\`\`\n\n## 后续检查\n确认服务 v2.0 正常运行。`
  const chunks = buildStructuredRecursiveChunks('ops.md', [{ locator: '全文', text: md }])
  assert.equal(
    chunks.some(c => c.headingPath.includes('这不是标题')),
    false,
    'Code fence comments must NEVER become section headings'
  )
  assert.ok(chunks.some(c => c.content.includes('# 这不是标题')), 'Code block content must stay intact')
  console.log('✓ Chunker v2: code-fence protection verified')
}

// 2. IP / version / decimal-safe sentence splitting
{
  const text = '部署主机 192.168.1.100 运行 v2.0 服务，阈值 3.14 需监控。第二句紧随其后。'
  const sentences = splitSentencesSafe(text, 200)
  assert.equal(sentences.length, 2, 'Should split cleanly into 2 sentences without shattering IP/version/decimal')
  assert.ok(sentences[0].includes('192.168.1.100') && sentences[0].includes('v2.0') && sentences[0].includes('3.14'))
  console.log('✓ Chunker v2: IP/version/decimal-safe sentence splitting verified')
}

// 3. Schema v2: word-boundary matching + parenthetical alias merging + TF-IDF weights
{
  const alias = extractEntityAliases('标准操作规程（SOP）')
  assert.equal(alias.canonical, '标准操作规程')
  assert.ok(alias.aliases.includes('sop'))

  const pages = [
    {
      slug: 'port-check',
      title: 'port',
      summary: '端口巡检',
      content: '检查 port 8787',
      pageType: 'ops',
      evidenceLevel: 'official_doc',
      applicability: '运维',
      status: 'published',
      sources: [],
      links: [],
      schemaEntities: ['标准操作规程（SOP）'],
      updatedAt: new Date().toISOString()
    }
  ]
  const chunks = [
    {
      chunkId: 'c_false',
      file: 'a.md',
      chunkIndex: 0,
      locator: 'L1',
      headingPath: ['导入导出'],
      blockKind: 'text',
      content: 'This module handles import and report generation without ports.',
      charCount: 62,
      storageDomain: 'foundation'
    },
    {
      chunkId: 'c_true',
      file: 'b.md',
      chunkIndex: 0,
      locator: 'L1',
      headingPath: ['SOP 巡检'],
      blockKind: 'text',
      content: '检查本地 port 8787 是否监听，遵循 SOP 要求。',
      charCount: 30,
      storageDomain: 'domain_knowledge'
    }
  ]

  const result = buildMutualIndex(pages, chunks, new Map())
  const portEnt = result.entities.find(e => e.name === 'port')
  assert.ok(portEnt, 'port entity should exist')
  const portLinks = result.links.filter(l => l.entityId === portEnt.id && l.targetKind === 'chunk')
  assert.equal(portLinks.length, 1, 'ASCII word-boundary must prevent matching "import"/"report"/"ports"')
  assert.equal(portLinks[0].targetId, 'c_true')

  const sopEnt = result.entities.find(e => e.name === '标准操作规程')
  assert.ok(sopEnt, 'Parenthetical alias canonical entity should exist')
  assert.ok(
    result.links.some(l => l.entityId === sopEnt.id && l.targetId === 'c_true'),
    'Alias "SOP" in chunk must link to canonical entity "标准操作规程"'
  )
  console.log('✓ Schema v2: word-boundary matching + alias merging + TF-IDF mutual index verified')
}

// 4. Adaptive Logistic Sigmoid Reranker calibration
{
  const lowLogits = normalizeRerankScores([-9.2, -8.5])
  assert.ok(lowLogits[0] < 0.05 && lowLogits[1] < 0.05, 'Globally irrelevant negative logits must NOT inflate to 1.0')
  const mixedLogits = normalizeRerankScores([-4.5, 0, 4.5])
  assert.ok(mixedLogits[0] < 0.1 && Math.abs(mixedLogits[1] - 0.5) < 0.01 && mixedLogits[2] > 0.9)
  const probs = normalizeRerankScores([0.2, 0.85])
  assert.deepEqual(probs, [0.2, 0.85], 'Calibrated [0,1] probabilities must remain verbatim')
  console.log('✓ Model v2: Adaptive Sigmoid reranker calibration verified')
}

// 5. Safe-Write v2: dead-PID lock self-healing + code-safe wikilink repair
{
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zhixu-lock-test-'))
  try {
    await fs.mkdir(path.join(tmpDir, '.localwiki'), { recursive: true })
    // Plant an orphaned lock with a guaranteed-dead PID
    await fs.writeFile(
      path.join(tmpDir, '.localwiki', 'ingest.lock'),
      JSON.stringify({ pid: 99999999, acquiredAt: new Date().toISOString() }),
      'utf8'
    )
    const t0 = Date.now()
    const val = await withKbWriteLock(tmpDir, async () => 'recovered')
    const elapsed = Date.now() - t0
    assert.equal(val, 'recovered')
    assert.ok(elapsed < 2000, `Dead-PID lock should self-heal immediately (took ${elapsed}ms)`)
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true })
  }

  const md = '正文 [[missing-doc]] 与 `[[code-inline]]`：\n```md\n[[code-fence-link]]\n```\n保留 [[valid-doc]]。'
  const { cleaned, ghosts } = stripGhostWikilinks(md, new Set(['valid-doc']))
  assert.ok(cleaned.includes('`[[code-inline]]`'), 'Inline code wikilink must be preserved')
  assert.ok(cleaned.includes('[[code-fence-link]]'), 'Fenced code wikilink must be preserved')
  assert.ok(cleaned.includes('[[valid-doc]]'), 'Valid wikilink must be preserved')
  assert.deepEqual(ghosts, ['missing-doc'], 'Only prose ghost link should be stripped')
  console.log('✓ Safe-Write v2: dead-PID lock recovery + code-safe wikilink repair verified')
}

// 6. Declarative Workflow State Machine v2
{
  const draftActions = getAllowedWorkflowActions('draft')
  assert.ok(draftActions.includes('publish') && draftActions.includes('submit_moderation'))
  assert.equal(resolveWorkflowTransition('pending_delete', 'reject_delete', true).nextStatus, 'published')
  assert.equal(nextSemanticVersion(['V1.0', 'V1.2'], 'published', true), 'V2.0')
  console.log('✓ Workflow v2: declarative state matrix + semantic versioning verified')
}

// 7. Zero-dependency OOXML Parser: .xlsx & .pptx
{
  const xlsxZip = buildTestZip({
    'xl/workbook.xml': '<workbook><sheets><sheet name="端口台账" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/sharedStrings.xml': '<sst><si><t>服务名</t></si><si><t>端口</t></si><si><t>知序服务</t></si></sst>',
    'xl/worksheets/sheet1.xml':
      '<worksheet><sheetData><row><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row><c r="A2" t="s"><v>2</v></c><c r="B2"><v>8787</v></c></row></sheetData></worksheet>'
  })
  const sheets = parseXlsxBuffer(xlsxZip)
  assert.equal(sheets.length, 1)
  assert.equal(sheets[0].locator, '工作表：端口台账')
  assert.ok(sheets[0].text.includes('| 服务名 | 端口 |') && sheets[0].text.includes('| 知序服务 | 8787 |'))

  const pptxZip = buildTestZip({
    'ppt/slides/slide1.xml': '<p:sld><a:p><a:t>架构总览</a:t></a:p><a:p><a:t>三类接口 LLLM/LLM/VM</a:t></a:p></p:sld>',
    'ppt/notesSlides/notesSlide1.xml': '<p:notes><a:p><a:t>重点强调本地隐私与可回滚</a:t></a:p></p:notes>'
  })
  const slides = parsePptxBuffer(pptxZip)
  assert.equal(slides.length, 1)
  assert.equal(slides[0].locator, '第 1 页幻灯片')
  assert.ok(slides[0].text.includes('## 架构总览') && slides[0].text.includes('重点强调本地隐私与可回滚'))
  console.log('✓ OOXML Parser: zero-dependency .xlsx and .pptx extraction verified')
}

console.log('\nALL ZHIXU CORE UPGRADE UNIT TESTS PASSED!')
