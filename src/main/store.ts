import { randomUUID } from 'node:crypto'
import nodeFs, { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { structuredPatch } from 'diff'
import matter from 'gray-matter'
import git from 'isomorphic-git'
import type {
  AccessLevel,
  DocumentChunkRecord,
  EvidenceLevel,
  KnowledgeGraphData,
  KnowledgeGraphEdge,
  KnowledgeGraphNode,
  ModelCallRecord,
  OrganizeRun,
  PageDiffResult,
  PageVersionSnapshot,
  QaFeedbackEntry,
  RunChange,
  SchemaEntityRecord,
  SchemaOverview,
  SourceReference,
  SpgTypeKind,
  StorageDomain,
  WikiPage,
  WikiPageStatus,
  WikiPageType,
  WorkflowAction
} from '../shared/types'
import { atomicWriteText, withKbWriteLock } from './safe-write'
import {
  buildMutualIndex,
  classifyPageStorageDomain,
  inferAccessLevel,
  type MutualIndexLink
} from './schema'
import { nextSemanticVersion, resolveWorkflowTransition, WORKFLOW_STATUS_LABELS } from './workflow'

export type DocumentKeyPoint = {
  point: string
  excerpt: string
}

export type DocumentNotes = {
  summaries: string[]
  topics: string[]
  keyPoints: DocumentKeyPoint[]
}

export type FileRecord = {
  path: string
  hash: string
  size: number
  mtime: number
  notes: DocumentNotes
}

export type StoredChange = {
  slug: string
  action: 'create' | 'update' | 'delete'
  before: WikiPage | null
  after: WikiPage | null
}

export type CachedEmbeddingEntry = {
  docKey: string
  model: string
  contentHash: string
  vector: number[]
}

type PageRow = {
  slug: string
  title: string
  summary: string
  content: string
  sources: string
  links: string
  updated_at: string
  page_type: string | null
  status: string | null
  evidence_level: string | null
  applicability: string | null
  model_version: string | null
  reviewed_by: string | null
  reviewed_at: string | null
  published_json: string | null
  storage_domain: string | null
  access_level: string | null
  version_label: string | null
  workflow_note: string | null
  schema_entities: string | null
}

type FileRow = {
  path: string
  hash: string
  size: number
  mtime: number
  notes: string
}

export class WikiStore {
  readonly databasePath: string
  readonly wikiDir: string
  private database!: DatabaseSync
  private revision = 1

  constructor(readonly root: string) {
    const stateDirectory = path.join(root, '.localwiki')
    this.databasePath = path.join(stateDirectory, 'index.db')
    this.wikiDir = path.join(root, 'wiki')
  }

  getRevision(): number {
    return this.revision
  }

  private bumpRevision(): void {
    this.revision += 1
  }

  async initialize(): Promise<void> {
    await fs.mkdir(path.dirname(this.databasePath), { recursive: true })
    await fs.mkdir(this.wikiDir, { recursive: true })
    await this.ensureGitRepo()

    this.database = new DatabaseSync(this.databasePath)
    this.database.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS files (
        path TEXT PRIMARY KEY,
        hash TEXT NOT NULL,
        size INTEGER NOT NULL,
        mtime REAL NOT NULL,
        notes TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS pages (
        slug TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        content TEXT NOT NULL,
        sources TEXT NOT NULL,
        links TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        page_type TEXT NOT NULL DEFAULT 'concept',
        status TEXT NOT NULL DEFAULT 'published',
        evidence_level TEXT NOT NULL DEFAULT 'operational_doc',
        applicability TEXT NOT NULL DEFAULT '',
        model_version TEXT NOT NULL DEFAULT '',
        reviewed_by TEXT,
        reviewed_at TEXT,
        published_json TEXT,
        storage_domain TEXT NOT NULL DEFAULT 'foundation',
        access_level TEXT NOT NULL DEFAULT 'internal',
        version_label TEXT NOT NULL DEFAULT 'V1.0',
        workflow_note TEXT,
        schema_entities TEXT NOT NULL DEFAULT '[]'
      );
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        summary TEXT NOT NULL,
        model TEXT NOT NULL,
        files_changed INTEGER NOT NULL,
        changes_count INTEGER NOT NULL,
        undone INTEGER NOT NULL DEFAULT 0,
        files_before_json TEXT,
        git_commit TEXT
      );
      CREATE TABLE IF NOT EXISTS changes (
        run_id TEXT NOT NULL,
        position INTEGER NOT NULL,
        slug TEXT NOT NULL,
        action TEXT NOT NULL,
        before_json TEXT,
        after_json TEXT,
        PRIMARY KEY (run_id, position),
        FOREIGN KEY (run_id) REFERENCES runs(id)
      );
      CREATE TABLE IF NOT EXISTS model_calls (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        task_type TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        duration_ms INTEGER NOT NULL,
        status TEXT NOT NULL,
        detail TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS chunks (
        chunk_id TEXT PRIMARY KEY,
        file_path TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        locator TEXT NOT NULL,
        heading_path TEXT NOT NULL,
        block_kind TEXT NOT NULL DEFAULT 'text',
        content TEXT NOT NULL,
        char_count INTEGER NOT NULL,
        storage_domain TEXT NOT NULL DEFAULT 'foundation'
      );
      CREATE INDEX IF NOT EXISTS idx_chunks_file ON chunks(file_path);
      CREATE TABLE IF NOT EXISTS schema_entities (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        spg_type TEXT NOT NULL,
        storage_domain TEXT NOT NULL,
        description TEXT NOT NULL,
        chunk_count INTEGER NOT NULL DEFAULT 0,
        wiki_slugs TEXT NOT NULL DEFAULT '[]'
      );
      CREATE TABLE IF NOT EXISTS mutual_index_links (
        entity_id TEXT NOT NULL,
        target_kind TEXT NOT NULL,
        target_id TEXT NOT NULL,
        relation TEXT NOT NULL,
        weight REAL NOT NULL DEFAULT 1.0,
        PRIMARY KEY (entity_id, target_kind, target_id, relation)
      );
      CREATE INDEX IF NOT EXISTS idx_mutual_target ON mutual_index_links(target_kind, target_id);
      CREATE TABLE IF NOT EXISTS page_versions (
        id TEXT PRIMARY KEY,
        slug TEXT NOT NULL,
        version_label TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        created_by TEXT NOT NULL,
        note TEXT NOT NULL DEFAULT '',
        eval_score REAL,
        eval_note TEXT,
        page_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_versions_slug ON page_versions(slug, created_at DESC);
      CREATE TABLE IF NOT EXISTS qa_feedback (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        question TEXT NOT NULL,
        rating TEXT NOT NULL,
        comment TEXT NOT NULL,
        cited_slugs TEXT NOT NULL DEFAULT '[]'
      );
      CREATE TABLE IF NOT EXISTS embeddings (
        doc_key TEXT PRIMARY KEY,
        model TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        dim INTEGER NOT NULL,
        vector_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_embeddings_model ON embeddings(model);
    `)

    this.ensureColumns('runs', [
      ['files_before_json', 'TEXT'],
      ['git_commit', 'TEXT']
    ])
    this.ensureColumns('pages', [
      ['page_type', "TEXT NOT NULL DEFAULT 'concept'"],
      ['status', "TEXT NOT NULL DEFAULT 'published'"],
      ['evidence_level', "TEXT NOT NULL DEFAULT 'operational_doc'"],
      ['applicability', "TEXT NOT NULL DEFAULT ''"],
      ['model_version', "TEXT NOT NULL DEFAULT ''"],
      ['reviewed_by', 'TEXT'],
      ['reviewed_at', 'TEXT'],
      ['published_json', 'TEXT'],
      ['storage_domain', "TEXT NOT NULL DEFAULT 'foundation'"],
      ['access_level', "TEXT NOT NULL DEFAULT 'internal'"],
      ['version_label', "TEXT NOT NULL DEFAULT 'V1.0'"],
      ['workflow_note', 'TEXT'],
      ['schema_entities', "TEXT NOT NULL DEFAULT '[]'"]
    ])
  }

  private ensureColumns(table: string, definitions: [string, string][]): void {
    const columns = this.database.prepare(`PRAGMA table_info(${table})`).all() as unknown as { name: string }[]
    const existing = new Set(columns.map(col => col.name))
    for (const [name, ddl] of definitions) {
      if (!existing.has(name)) {
        this.database.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${ddl};`)
      }
    }
  }

  private async ensureGitRepo(): Promise<void> {
    try {
      if (!existsSync(path.join(this.wikiDir, '.git'))) {
        await git.init({ fs: nodeFs, dir: this.wikiDir, defaultBranch: 'main' })
      }
    } catch {
      // Git tracking is best-effort.
    }
  }

  async commitWikiGit(message: string): Promise<string | null> {
    try {
      await this.ensureGitRepo()
      const matrix = await git.statusMatrix({ fs: nodeFs, dir: this.wikiDir })
      let stagedAny = false
      for (const [filepath, headStatus, workdirStatus, stageStatus] of matrix) {
        if (filepath.startsWith('.')) continue
        if (workdirStatus === 0 && headStatus !== 0) {
          await git.remove({ fs: nodeFs, dir: this.wikiDir, filepath })
          stagedAny = true
        } else if (workdirStatus !== headStatus || stageStatus !== headStatus) {
          await git.add({ fs: nodeFs, dir: this.wikiDir, filepath })
          stagedAny = true
        }
      }
      if (!stagedAny) return null
      const sha = await git.commit({
        fs: nodeFs,
        dir: this.wikiDir,
        message,
        author: { name: '知序 ZHIXU', email: 'local@zhixu.ai' }
      })
      return sha
    } catch {
      return null
    }
  }

  close(): void {
    this.database.close()
  }

  // ===== Persistent SQLite Vector Embedding Cache =====

  getCachedEmbeddings(model: string): Map<string, { contentHash: string; vector: number[] }> {
    const rows = this.database
      .prepare('SELECT doc_key, content_hash, vector_json FROM embeddings WHERE model = ?')
      .all(model) as unknown as { doc_key: string; content_hash: string; vector_json: string }[]
    const map = new Map<string, { contentHash: string; vector: number[] }>()
    for (const row of rows) {
      const vec = safeJsonParse<number[]>(row.vector_json, [])
      if (vec.length) {
        map.set(row.doc_key, { contentHash: row.content_hash, vector: vec })
      }
    }
    return map
  }

  upsertCachedEmbeddings(entries: CachedEmbeddingEntry[]): void {
    if (!entries.length) return
    const now = new Date().toISOString()
    this.database.exec('BEGIN IMMEDIATE')
    try {
      const stmt = this.database.prepare(
        `INSERT INTO embeddings (doc_key, model, content_hash, dim, vector_json, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(doc_key) DO UPDATE SET
           model = excluded.model,
           content_hash = excluded.content_hash,
           dim = excluded.dim,
           vector_json = excluded.vector_json,
           updated_at = excluded.updated_at`
      )
      for (const entry of entries) {
        stmt.run(
          entry.docKey,
          entry.model,
          entry.contentHash,
          entry.vector.length,
          JSON.stringify(entry.vector),
          now
        )
      }
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  getCachedEmbeddingCount(): number {
    const row = this.database.prepare('SELECT COUNT(*) AS cnt FROM embeddings').get() as { cnt: number }
    return row?.cnt ?? 0
  }

  getFiles(): FileRecord[] {
    const rows = this.database.prepare('SELECT * FROM files ORDER BY path').all() as unknown as FileRow[]
    return rows.map(row => ({
      path: row.path,
      hash: row.hash,
      size: row.size,
      mtime: row.mtime,
      notes: JSON.parse(row.notes) as DocumentNotes
    }))
  }

  getChunks(filePath?: string): DocumentChunkRecord[] {
    const rows = (
      filePath
        ? this.database.prepare('SELECT * FROM chunks WHERE file_path = ? ORDER BY chunk_index').all(filePath)
        : this.database.prepare('SELECT * FROM chunks ORDER BY file_path, chunk_index').all()
    ) as unknown as {
      chunk_id: string
      file_path: string
      chunk_index: number
      locator: string
      heading_path: string
      block_kind: 'text' | 'table' | 'visual'
      content: string
      char_count: number
      storage_domain: StorageDomain
    }[]
    return rows.map(row => ({
      chunkId: row.chunk_id,
      file: row.file_path,
      chunkIndex: row.chunk_index,
      locator: row.locator,
      headingPath: safeJsonParse<string[]>(row.heading_path, []),
      blockKind: row.block_kind || 'text',
      content: row.content,
      charCount: row.char_count,
      storageDomain: row.storage_domain || 'foundation'
    }))
  }

  replaceFileChunks(filePath: string, chunks: DocumentChunkRecord[]): void {
    this.database.exec('BEGIN IMMEDIATE')
    try {
      this.database.prepare('DELETE FROM chunks WHERE file_path = ?').run(filePath)
      const stmt = this.database.prepare(
        `INSERT INTO chunks (chunk_id, file_path, chunk_index, locator, heading_path, block_kind, content, char_count, storage_domain)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      for (const chunk of chunks) {
        stmt.run(
          chunk.chunkId,
          chunk.file,
          chunk.chunkIndex,
          chunk.locator,
          JSON.stringify(chunk.headingPath),
          chunk.blockKind,
          chunk.content,
          chunk.charCount,
          chunk.storageDomain
        )
      }
      this.database.exec('COMMIT')
      this.bumpRevision()
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  deleteFileChunks(filePath: string): void {
    this.database.prepare('DELETE FROM chunks WHERE file_path = ?').run(filePath)
    this.bumpRevision()
  }

  pruneChunksForMissingFiles(liveFilePaths: Set<string>): void {
    const existing = this.database.prepare('SELECT DISTINCT file_path FROM chunks').all() as unknown as {
      file_path: string
    }[]
    const del = this.database.prepare('DELETE FROM chunks WHERE file_path = ?')
    for (const row of existing) {
      if (!liveFilePaths.has(row.file_path)) {
        del.run(row.file_path)
      }
    }
    this.bumpRevision()
  }

  rebuildMutualIndex(): SchemaOverview {
    const pages = this.getPages().filter(p => p.status !== 'deleted')
    const chunks = this.getChunks()
    const files = this.getFiles()
    const fileTopics = new Map<string, string[]>(files.map(f => [f.path, f.notes.topics]))
    const result = buildMutualIndex(pages, chunks, fileTopics)

    this.database.exec('BEGIN IMMEDIATE')
    try {
      this.database.prepare('DELETE FROM schema_entities').run()
      this.database.prepare('DELETE FROM mutual_index_links').run()

      const insEnt = this.database.prepare(
        'INSERT INTO schema_entities (id, name, spg_type, storage_domain, description, chunk_count, wiki_slugs) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      for (const ent of result.entities) {
        insEnt.run(
          ent.id,
          ent.name,
          ent.spgType,
          ent.storageDomain,
          ent.description,
          ent.chunkCount,
          JSON.stringify(ent.wikiSlugs)
        )
      }

      const insLink = this.database.prepare(
        'INSERT OR REPLACE INTO mutual_index_links (entity_id, target_kind, target_id, relation, weight) VALUES (?, ?, ?, ?, ?)'
      )
      for (const link of result.links) {
        insLink.run(link.entityId, link.targetKind, link.targetId, link.relation, link.weight)
      }

      const updPage = this.database.prepare('UPDATE pages SET schema_entities = ? WHERE slug = ?')
      for (const [slug, entNames] of result.pageEntitiesMap.entries()) {
        updPage.run(JSON.stringify(entNames), slug)
      }
      this.database.exec('COMMIT')
      this.bumpRevision()
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }

    return this.getSchemaOverview()
  }

  getSchemaEntities(): SchemaEntityRecord[] {
    const rows = this.database
      .prepare('SELECT * FROM schema_entities ORDER BY chunk_count DESC, name COLLATE NOCASE')
      .all() as unknown as {
      id: string
      name: string
      spg_type: SpgTypeKind
      storage_domain: StorageDomain
      description: string
      chunk_count: number
      wiki_slugs: string
    }[]
    return rows.map(row => ({
      id: row.id,
      name: row.name,
      spgType: row.spg_type,
      storageDomain: row.storage_domain,
      description: row.description,
      chunkCount: row.chunk_count,
      wikiSlugs: safeJsonParse<string[]>(row.wiki_slugs, [])
    }))
  }

  getMutualIndexLinks(): MutualIndexLink[] {
    const rows = this.database.prepare('SELECT * FROM mutual_index_links').all() as unknown as {
      entity_id: string
      target_kind: 'chunk' | 'wiki'
      target_id: string
      relation: 'mentions' | 'defines' | 'belongs_to'
      weight: number
    }[]
    return rows.map(row => ({
      entityId: row.entity_id,
      targetKind: row.target_kind,
      targetId: row.target_id,
      relation: row.relation,
      weight: row.weight
    }))
  }

  getSchemaOverview(): SchemaOverview {
    const pages = this.getPages().filter(p => p.slug !== 'index' && p.status !== 'deleted')
    const chunks = this.getChunks()
    const entities = this.getSchemaEntities()
    const versionCount = (
      this.database.prepare('SELECT COUNT(*) AS cnt FROM page_versions').get() as { cnt: number }
    ).cnt
    const mutualLinkCount = (
      this.database.prepare('SELECT COUNT(*) AS cnt FROM mutual_index_links').get() as { cnt: number }
    ).cnt

    const domainCounts: Record<StorageDomain, number> = {
      permissions: 0,
      foundation: 0,
      cases: 0,
      concrete_media: 0,
      domain_knowledge: 0,
      versions: versionCount
    }
    for (const page of pages) {
      const domain = page.storageDomain ?? classifyPageStorageDomain(page)
      domainCounts[domain] = (domainCounts[domain] ?? 0) + 1
    }
    for (const chunk of chunks) {
      if (chunk.blockKind === 'visual') {
        domainCounts.concrete_media += 1
      }
    }

    return {
      domainCounts,
      chunkCount: chunks.length,
      entityCount: entities.length,
      mutualLinkCount,
      entities: entities.slice(0, 80)
    }
  }

  getKnowledgeGraph(maxEntities = 90): KnowledgeGraphData {
    const overview = this.getSchemaOverview()
    const pages = this.getPages().filter(p => p.status !== 'deleted')
    const entities = this.getSchemaEntities()
    const mutualLinks = this.getMutualIndexLinks()

    const nodeMap = new Map<string, KnowledgeGraphNode>()
    const slugSet = new Set<string>()

    for (const page of pages) {
      const id = `wiki:${page.slug}`
      slugSet.add(page.slug)
      nodeMap.set(id, {
        id,
        label: page.title,
        kind: 'wiki',
        storageDomain: page.storageDomain ?? classifyPageStorageDomain(page),
        slug: page.slug,
        status: page.status,
        summary: page.summary,
        chunkCount: page.sources.length,
        degree: 0
      })
    }

    // Prioritize entities connected to Wiki pages and with highest chunk counts
    const rankedEntities = [...entities]
      .sort((a, b) => {
        const aWiki = a.wikiSlugs.filter(s => slugSet.has(s)).length
        const bWiki = b.wikiSlugs.filter(s => slugSet.has(s)).length
        if (bWiki !== aWiki) return bWiki - aWiki
        return b.chunkCount - a.chunkCount
      })
      .slice(0, Math.max(10, Math.min(200, maxEntities)))

    const includedEntityIds = new Set<string>()
    for (const ent of rankedEntities) {
      const id = `ent:${ent.id}`
      includedEntityIds.add(ent.id)
      nodeMap.set(id, {
        id,
        label: ent.name,
        kind: 'entity',
        storageDomain: ent.storageDomain,
        slug: ent.wikiSlugs.find(s => slugSet.has(s)),
        summary: ent.description,
        chunkCount: ent.chunkCount,
        degree: 0
      })
    }

    const edgeSet = new Set<string>()
    const edges: KnowledgeGraphEdge[] = []
    const pushEdge = (
      source: string,
      target: string,
      relation: KnowledgeGraphEdge['relation'],
      weight: number
    ) => {
      if (source === target || !nodeMap.has(source) || !nodeMap.has(target)) return
      const key = `${source}|${target}|${relation}`
      if (edgeSet.has(key)) return
      edgeSet.add(key)
      edges.push({ source, target, relation, weight })
      nodeMap.get(source)!.degree += 1
      nodeMap.get(target)!.degree += 1
    }

    // 1. Wiki-to-wiki explicit links
    for (const page of pages) {
      const fromId = `wiki:${page.slug}`
      for (const targetSlug of page.links) {
        if (!slugSet.has(targetSlug)) continue
        pushEdge(fromId, `wiki:${targetSlug}`, 'wikilink', 1.2)
      }
    }

    // 2. Mutual index links (entity <-> wiki page)
    for (const link of mutualLinks) {
      if (link.targetKind !== 'wiki') continue
      if (!includedEntityIds.has(link.entityId)) continue
      if (!slugSet.has(link.targetId)) continue
      pushEdge(`ent:${link.entityId}`, `wiki:${link.targetId}`, link.relation, Number(link.weight.toFixed(2)))
    }

    // Also link included entities via their wikiSlugs if mutual_index_links didn't emit a wiki edge
    for (const ent of rankedEntities) {
      for (const s of ent.wikiSlugs) {
        if (slugSet.has(s)) {
          pushEdge(`ent:${ent.id}`, `wiki:${s}`, 'defines', 1.0)
        }
      }
    }

    return {
      nodes: [...nodeMap.values()],
      edges,
      domainCounts: overview.domainCounts,
      totalWikiPages: pages.length,
      totalEntities: entities.length,
      totalMutualLinks: overview.mutualLinkCount
    }
  }

  getPages(): WikiPage[] {
    const rows = this.database.prepare('SELECT * FROM pages ORDER BY title COLLATE NOCASE').all() as unknown as PageRow[]
    return rows.map(pageFromRow).sort((a, b) => {
      if (a.slug === 'index') return -1
      if (b.slug === 'index') return 1
      return a.title.localeCompare(b.title, 'zh-CN')
    })
  }

  getPublishedPages(): WikiPage[] {
    const all = this.getPages()
    const published: WikiPage[] = []
    for (const page of all) {
      if (page.status === 'published') {
        published.push(page)
        continue
      }
      if (page.status === 'archived' || page.status === 'deleted') continue
      // Draft / moderating / validating / pending_delete pages keep serving their last published baseline!
      const baseline = this.getPublishedBaseline(page.slug)
      if (baseline) published.push(baseline)
    }
    return published
  }

  getPublishedBaseline(slug: string): WikiPage | null {
    const row = this.database
      .prepare('SELECT published_json, status FROM pages WHERE slug = ?')
      .get(slug) as { published_json: string | null; status: string | null } | undefined
    if (!row) return null
    if (row.published_json) {
      try {
        return normalizeWikiPage(JSON.parse(row.published_json) as WikiPage)
      } catch {
        return null
      }
    }
    return null
  }

  listPageVersions(slug: string): PageVersionSnapshot[] {
    const rows = this.database
      .prepare(
        'SELECT id, slug, version_label, status, created_at, created_by, note, eval_score, eval_note, page_json FROM page_versions WHERE slug = ? ORDER BY created_at DESC'
      )
      .all(slug) as unknown as {
      id: string
      slug: string
      version_label: string
      status: 'candidate' | 'published' | 'archived'
      created_at: string
      created_by: string
      note: string
      eval_score: number | null
      eval_note: string | null
      page_json: string
    }[]
    return rows.map(row => {
      const page = safeJsonParse<Partial<WikiPage>>(row.page_json, {})
      return {
        id: row.id,
        slug: row.slug,
        versionLabel: row.version_label,
        status: row.status,
        createdAt: row.created_at,
        createdBy: row.created_by,
        note: row.note,
        evalScore: row.eval_score,
        evalNote: row.eval_note,
        title: page.title ?? row.slug,
        summary: page.summary ?? ''
      }
    })
  }

  listAllCandidateVersions(limit = 50): PageVersionSnapshot[] {
    const rows = this.database
      .prepare(
        "SELECT id, slug, version_label, status, created_at, created_by, note, eval_score, eval_note, page_json FROM page_versions WHERE status = 'candidate' ORDER BY created_at DESC LIMIT ?"
      )
      .all(limit) as unknown as {
      id: string
      slug: string
      version_label: string
      status: 'candidate' | 'published' | 'archived'
      created_at: string
      created_by: string
      note: string
      eval_score: number | null
      eval_note: string | null
      page_json: string
    }[]
    return rows.map(row => {
      const page = safeJsonParse<Partial<WikiPage>>(row.page_json, {})
      return {
        id: row.id,
        slug: row.slug,
        versionLabel: row.version_label,
        status: row.status,
        createdAt: row.created_at,
        createdBy: row.created_by,
        note: row.note,
        evalScore: row.eval_score,
        evalNote: row.eval_note,
        title: page.title ?? row.slug,
        summary: page.summary ?? ''
      }
    })
  }

  recordPageVersion(
    page: WikiPage,
    kind: 'candidate' | 'published' | 'archived',
    createdBy: string,
    note = ''
  ): string {
    const existingLabels = this.listPageVersions(page.slug).map(v => v.versionLabel)
    const versionLabel = nextSemanticVersion(existingLabels, kind)
    const stamped: WikiPage = { ...page, versionLabel }
    this.database
      .prepare(
        `INSERT INTO page_versions (id, slug, version_label, status, created_at, created_by, note, page_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        randomUUID(),
        page.slug,
        versionLabel,
        kind,
        new Date().toISOString(),
        createdBy,
        note.slice(0, 400),
        JSON.stringify(stamped)
      )
    return versionLabel
  }

  evaluateVersionCandidate(slug: string, versionLabel: string, score: number, note: string): PageVersionSnapshot {
    const clamped = Math.max(0, Math.min(100, Number(score)))
    const res = this.database
      .prepare('UPDATE page_versions SET eval_score = ?, eval_note = ? WHERE slug = ? AND version_label = ?')
      .run(clamped, note.slice(0, 500), slug, versionLabel)
    if (!res.changes) throw new Error(`找不到版本 ${slug}@${versionLabel}`)
    const found = this.listPageVersions(slug).find(v => v.versionLabel === versionLabel)
    if (!found) throw new Error(`找不到版本 ${slug}@${versionLabel}`)
    return found
  }

  async rollbackPageVersion(slug: string, versionLabel: string, reviewer = 'zhixu'): Promise<void> {
    await withKbWriteLock(this.root, async () => {
      const row = this.database
        .prepare('SELECT page_json, status FROM page_versions WHERE slug = ? AND version_label = ? ORDER BY created_at DESC LIMIT 1')
        .get(slug, versionLabel) as { page_json: string; status: string } | undefined
      if (!row) throw new Error(`找不到版本 ${versionLabel}`)
      const target = normalizeWikiPage(JSON.parse(row.page_json) as WikiPage)
      const now = new Date().toISOString()
      const current = this.getPages().find(p => p.slug === slug)
      if (current) {
        this.recordPageVersion(current, 'archived', reviewer, `回滚至 ${versionLabel} 前自动备份`)
      }
      const restored: WikiPage = {
        ...target,
        status: 'published',
        versionLabel,
        reviewedBy: reviewer,
        reviewedAt: now,
        updatedAt: now,
        workflowNote: `已回滚至历史版本 ${versionLabel}`,
        hasPublishedVersion: true
      }
      await writePage(this.root, slug, restored)
      this.upsertPage(restored, JSON.stringify(restored))
      await this.refreshIndexPageStatuses(now)
      this.bumpRevision()
      await this.commitWikiGit(`rollback: ${restored.title} (${slug}) -> ${versionLabel}`)
    })
  }

  getPageDiff(slug: string): PageDiffResult {
    const current = this.getPages().find(p => p.slug === slug) ?? null
    const baseline = this.getPublishedBaseline(slug)
    const oldText = baseline ? formatPageBodyForDiff(baseline) : ''
    const newText = current ? formatPageBodyForDiff(current) : ''
    const patch = structuredPatch(
      baseline ? `${slug}.md (已发布基线 ${baseline.versionLabel ?? 'V1.0'})` : `${slug}.md (无基线)`,
      `${slug}.md (当前版本 ${current?.versionLabel ?? '草稿'})`,
      oldText,
      newText,
      '',
      '',
      { context: 3 }
    )
    let addedLines = 0
    let removedLines = 0
    for (const hunk of patch.hunks) {
      for (const line of hunk.lines) {
        if (line.startsWith('+')) addedLines += 1
        else if (line.startsWith('-')) removedLines += 1
      }
    }
    return {
      slug,
      hasBaseline: Boolean(baseline),
      hunks: patch.hunks,
      addedLines,
      removedLines
    }
  }

  /**
   * XWiki Publication & Deletion Approval Workflow transition with cooperative lock,
   * version snapshot retention, and validated full-page atomic overwrite.
   */
  async transitionWorkflow(
    slug: string,
    action: WorkflowAction,
    reviewer = 'zhixu',
    note = ''
  ): Promise<void> {
    await withKbWriteLock(this.root, async () => {
      const page = this.getPages().find(p => p.slug === slug)
      if (!page) throw new Error('找不到指定知识页面')
      const existingBaseline = this.getPublishedBaseline(slug)
      const transition = resolveWorkflowTransition(page.status, action, Boolean(existingBaseline))
      const now = new Date().toISOString()

      let nextVersionLabel = page.versionLabel || 'V1.0'
      if (transition.createsVersionStatus) {
        nextVersionLabel = this.recordPageVersion(
          page,
          transition.createsVersionStatus,
          reviewer,
          note || `审批流：${WORKFLOW_STATUS_LABELS[page.status]} → ${WORKFLOW_STATUS_LABELS[transition.nextStatus]}`
        )
      }

      const updated: WikiPage = {
        ...page,
        status: transition.nextStatus,
        versionLabel: nextVersionLabel,
        reviewedBy: transition.updatesPublishedBaseline || action === 'confirm_delete' ? reviewer : page.reviewedBy,
        reviewedAt: transition.updatesPublishedBaseline || action === 'confirm_delete' ? now : page.reviewedAt,
        workflowNote: note.trim() || null,
        updatedAt: now,
        hasPublishedVersion: transition.clearsPublishedBaseline
          ? false
          : transition.updatesPublishedBaseline
            ? true
            : page.hasPublishedVersion
      }

      let publishedJson: string | null = null
      if (transition.clearsPublishedBaseline) {
        publishedJson = null
      } else if (transition.updatesPublishedBaseline) {
        publishedJson = JSON.stringify(updated)
      } else if (transition.nextStatus !== 'archived') {
        publishedJson = existingBaseline ? JSON.stringify(existingBaseline) : null
      }

      // Soft-deleted pages stay in DB recycle bin while removing active wiki/<slug>.md file
      await writePage(this.root, slug, transition.nextStatus === 'deleted' ? null : updated)
      this.upsertPage(updated, publishedJson)
      await this.refreshIndexPageStatuses(now)
      this.rebuildMutualIndex()
      await this.commitWikiGit(`${transition.gitPrefix}: ${updated.title} (${slug}) [${nextVersionLabel}]`)
    })
  }

  /**
   * Permanently purge a page that is already in the recycle bin (`deleted`).
   */
  async purgeDeletedPage(slug: string, reviewer = 'zhixu'): Promise<void> {
    await withKbWriteLock(this.root, async () => {
      const page = this.getPages().find(p => p.slug === slug)
      if (!page) throw new Error('找不到指定知识页面')
      if (page.status !== 'deleted') {
        throw new Error('只能彻底清理已移入回收站的页面')
      }
      this.recordPageVersion(page, 'archived', reviewer, '彻底清理前最终归档快照')
      await writePage(this.root, slug, null)
      this.database.prepare('DELETE FROM pages WHERE slug = ?').run(slug)
      this.database.prepare('DELETE FROM embeddings WHERE doc_key LIKE ?').run(`%:${slug}`)
      await this.refreshIndexPageStatuses(new Date().toISOString())
      this.rebuildMutualIndex()
      await this.commitWikiGit(`purge: ${page.title} (${slug})`)
    })
  }

  async publishPage(slug: string, reviewer = 'zhixu'): Promise<void> {
    await this.transitionWorkflow(slug, 'publish', reviewer, '人工审核通过并发布')
  }

  async publishAllDrafts(reviewer = 'zhixu'): Promise<number> {
    return await withKbWriteLock(this.root, async () => {
      const pending = this.getPages().filter(
        page =>
          page.slug !== 'index' &&
          (page.status === 'draft' || page.status === 'moderating' || page.status === 'validating')
      )
      if (!pending.length) return 0
      const now = new Date().toISOString()
      for (const draft of pending) {
        const versionLabel = this.recordPageVersion(draft, 'published', reviewer, '批量审批发布')
        const published: WikiPage = {
          ...draft,
          status: 'published',
          versionLabel,
          reviewedBy: reviewer,
          reviewedAt: now,
          workflowNote: null,
          hasPublishedVersion: true
        }
        await writePage(this.root, draft.slug, published)
        this.upsertPage(published, JSON.stringify(published))
      }
      await this.refreshIndexPageStatuses(now)
      this.bumpRevision()
      await this.commitWikiGit(`publish: 批量发布 ${pending.length} 篇待审页面`)
      return pending.length
    })
  }

  async updatePageSafely(page: WikiPage, gitMessage?: string): Promise<void> {
    await withKbWriteLock(this.root, async () => {
      const baseline = this.getPublishedBaseline(page.slug)
      await writePage(this.root, page.slug, page.status === 'deleted' ? null : page)
      const publishedJson =
        page.status === 'published' ? JSON.stringify(page) : baseline ? JSON.stringify(baseline) : null
      this.upsertPage(page, publishedJson)
      this.bumpRevision()
      if (gitMessage) {
        await this.commitWikiGit(gitMessage)
      }
    })
  }

  async saveManualPage(
    input: {
      slug?: string
      title: string
      summary: string
      content: string
      applicability?: string
      pageType?: WikiPage['pageType']
      storageDomain?: StorageDomain
      sources?: WikiPage['sources']
      publishImmediately?: boolean
      note?: string
    },
    author = 'zhixu'
  ): Promise<WikiPage> {
    const cleanTitle = input.title.trim()
    const cleanContent = input.content.trim()
    if (!cleanTitle) throw new Error('页面标题不能为空')
    if (!cleanContent) throw new Error('页面正文不能为空')

    return await withKbWriteLock(this.root, async () => {
      const now = new Date().toISOString()
      const existing = input.slug ? this.getPages().find(p => p.slug === input.slug) ?? null : null
      const slug =
        existing?.slug ??
        (() => {
          const ascii = cleanTitle
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 32)
          const base = ascii || `note-${randomUUID().slice(0, 8)}`
          const existingSlugs = new Set(this.getPages().map(p => p.slug))
          return existingSlugs.has(base) ? `${base}-${randomUUID().slice(0, 4)}` : base
        })()

      // Extract explicit [[slug]] or (wiki:slug) links from manual Markdown
      const extractedLinks = new Set<string>(existing?.links ?? [])
      for (const m of cleanContent.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)) {
        const target = m[1].trim()
        if (target && target !== slug) extractedLinks.add(target)
      }
      for (const m of cleanContent.matchAll(/\(wiki:([^)\s]+)\)/g)) {
        const target = m[1].trim()
        if (target && target !== slug) extractedLinks.add(target)
      }

      const pageType = input.pageType ?? existing?.pageType ?? 'concept'
      const summary = input.summary.trim() || cleanContent.replace(/[#>*`\n]+/g, ' ').trim().slice(0, 120)
      const storageDomain =
        input.storageDomain ??
        existing?.storageDomain ??
        classifyPageStorageDomain({ pageType, title: cleanTitle, summary, content: cleanContent })
      const nextStatus: WikiPage['status'] = input.publishImmediately ? 'published' : 'draft'
      const baseline = existing ? this.getPublishedBaseline(slug) : null

      const draftPage: WikiPage = {
        slug,
        title: cleanTitle,
        summary,
        content: cleanContent,
        sources: input.sources?.length ? input.sources : existing?.sources ?? [],
        links: [...extractedLinks],
        updatedAt: now,
        pageType,
        status: nextStatus,
        evidenceLevel: existing?.evidenceLevel ?? (input.sources?.length ? 'operational_doc' : 'field_record'),
        applicability: input.applicability?.trim() ?? existing?.applicability ?? '人工维护',
        modelVersion: `manual:${author}`,
        reviewedBy: input.publishImmediately ? author : existing?.reviewedBy ?? null,
        reviewedAt: input.publishImmediately ? now : existing?.reviewedAt ?? null,
        hasPublishedVersion: input.publishImmediately || Boolean(baseline),
        storageDomain,
        accessLevel: existing?.accessLevel ?? inferAccessLevel({ storageDomain, title: cleanTitle, summary }),
        workflowNote: input.note?.trim() || (existing ? `人工编辑（${author}）` : `人工创建（${author}）`),
        schemaEntities: existing?.schemaEntities ?? []
      }

      const versionLabel = this.recordPageVersion(
        draftPage,
        input.publishImmediately ? 'published' : 'candidate',
        author,
        draftPage.workflowNote ?? '人工保存'
      )
      const finalPage: WikiPage = { ...draftPage, versionLabel }

      await writePage(this.root, slug, finalPage)
      const publishedJson = input.publishImmediately
        ? JSON.stringify(finalPage)
        : baseline
          ? JSON.stringify(baseline)
          : null
      this.upsertPage(finalPage, publishedJson)
      await this.refreshIndexPageStatuses(now)
      this.rebuildMutualIndex()
      this.bumpRevision()
      await this.commitWikiGit(`${existing ? 'edit' : 'create'}: ${cleanTitle} (${versionLabel})`)
      return finalPage
    })
  }

  setRunGitCommit(runId: string, gitCommit: string | null): void {
    if (!gitCommit) return
    this.database.prepare('UPDATE runs SET git_commit = ? WHERE id = ?').run(gitCommit, runId)
  }

  private async refreshIndexPageStatuses(now: string): Promise<void> {
    const pages = this.getPages().filter(p => p.status !== 'deleted')
    const indexPage = pages.find(p => p.slug === 'index')
    if (!indexPage) return
    const marker = '\n\n## 知识入口'
    const idx = indexPage.content.indexOf(marker)
    const overview = idx >= 0 ? indexPage.content.slice(0, idx).trim() : indexPage.content.trim()
    const entries = pages
      .filter(p => p.slug !== 'index')
      .sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'))
      .map(p => {
        const tag = p.status === 'published' ? '' : ` *(${WORKFLOW_STATUS_LABELS[p.status]})*`
        return `- [${p.title}](wiki:${p.slug})${tag} — ${p.summary}`
      })
      .join('\n')
    const updatedIndex: WikiPage = {
      ...indexPage,
      content: `${overview}\n\n## 知识入口\n\n${entries || '暂无主题页面'}`,
      links: pages.filter(p => p.slug !== 'index').map(p => p.slug),
      updatedAt: now
    }
    await writePage(this.root, 'index', updatedIndex)
    this.upsertPage(updatedIndex, JSON.stringify(updatedIndex))
  }

  recordFeedback(entry: {
    question: string
    rating: 'helpful' | 'needs_fix'
    comment: string
    citedSlugs: string[]
  }): QaFeedbackEntry {
    const item: QaFeedbackEntry = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      question: entry.question.trim().slice(0, 500),
      rating: entry.rating === 'needs_fix' ? 'needs_fix' : 'helpful',
      comment: entry.comment.trim().slice(0, 1000),
      citedSlugs: entry.citedSlugs.slice(0, 20)
    }
    this.database
      .prepare(
        'INSERT INTO qa_feedback (id, created_at, question, rating, comment, cited_slugs) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(item.id, item.createdAt, item.question, item.rating, item.comment, JSON.stringify(item.citedSlugs))
    return item
  }

  getFeedbacks(limit = 30): QaFeedbackEntry[] {
    const rows = this.database
      .prepare('SELECT * FROM qa_feedback ORDER BY created_at DESC LIMIT ?')
      .all(limit) as unknown as {
      id: string
      created_at: string
      question: string
      rating: 'helpful' | 'needs_fix'
      comment: string
      cited_slugs: string
    }[]
    return rows.map(row => ({
      id: row.id,
      createdAt: row.created_at,
      question: row.question,
      rating: row.rating,
      comment: row.comment,
      citedSlugs: safeJsonParse<string[]>(row.cited_slugs, [])
    }))
  }

  recordModelCall(entry: Omit<ModelCallRecord, 'id' | 'createdAt'>): void {
    try {
      this.database
        .prepare(
          'INSERT INTO model_calls (id, created_at, task_type, provider, model, duration_ms, status, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        )
        .run(
          randomUUID(),
          new Date().toISOString(),
          entry.taskType,
          entry.provider,
          entry.model,
          Math.max(0, Math.round(entry.durationMs)),
          entry.status,
          entry.detail.slice(0, 500)
        )
    } catch {
      // Telemetry failures must never interrupt core workflow.
    }
  }

  getModelCalls(limit = 30): ModelCallRecord[] {
    const rows = this.database
      .prepare('SELECT * FROM model_calls ORDER BY created_at DESC LIMIT ?')
      .all(limit) as unknown as {
      id: string
      created_at: string
      task_type: string
      provider: string
      model: string
      duration_ms: number
      status: 'ok' | 'error'
      detail: string
    }[]
    return rows.map(row => ({
      id: row.id,
      createdAt: row.created_at,
      taskType: row.task_type,
      provider: row.provider,
      model: row.model,
      durationMs: row.duration_ms,
      status: row.status,
      detail: row.detail
    }))
  }

  getRuns(): OrganizeRun[] {
    const rows = this.database.prepare('SELECT * FROM runs ORDER BY created_at DESC').all() as unknown as {
      id: string
      created_at: string
      summary: string
      model: string
      files_changed: number
      changes_count: number
      undone: number
      git_commit: string | null
    }[]
    return rows.map(row => ({
      id: row.id,
      createdAt: row.created_at,
      summary: row.summary,
      model: row.model,
      filesChanged: row.files_changed,
      changesCount: row.changes_count,
      undone: Boolean(row.undone),
      gitCommit: row.git_commit ?? null,
      changes: this.getChanges(row.id).map(change => ({
        slug: change.slug,
        action: change.action,
        title: (change.after ?? change.before)?.title ?? change.slug
      }))
    }))
  }

  getChanges(runId: string): StoredChange[] {
    const rows = this.database.prepare('SELECT * FROM changes WHERE run_id = ? ORDER BY position').all(runId) as unknown as {
      slug: string
      action: 'create' | 'update' | 'delete'
      before_json: string | null
      after_json: string | null
    }[]
    return rows.map(row => ({
      slug: row.slug,
      action: row.action,
      before: row.before_json ? normalizeWikiPage(JSON.parse(row.before_json) as WikiPage) : null,
      after: row.after_json ? normalizeWikiPage(JSON.parse(row.after_json) as WikiPage) : null
    }))
  }

  createRun(summary: string, model: string, filesChanged: number, changesCount: number, gitCommit?: string | null): OrganizeRun {
    return {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      summary,
      model,
      filesChanged,
      changesCount,
      undone: false,
      gitCommit: gitCommit ?? null,
      changes: [] as RunChange[]
    }
  }

  commit(run: OrganizeRun, changes: StoredChange[], files: FileRecord[]): void {
    const previousFiles = this.getFiles()
    this.database.exec('BEGIN IMMEDIATE')
    try {
      this.database.prepare('DELETE FROM files').run()
      const insertFile = this.database.prepare('INSERT INTO files (path, hash, size, mtime, notes) VALUES (?, ?, ?, ?, ?)')
      for (const file of files) {
        insertFile.run(file.path, file.hash, file.size, file.mtime, JSON.stringify(file.notes))
      }
      this.database
        .prepare(
          'INSERT INTO runs (id, created_at, summary, model, files_changed, changes_count, undone, files_before_json, git_commit) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)'
        )
        .run(
          run.id,
          run.createdAt,
          run.summary,
          run.model,
          run.filesChanged,
          changes.length,
          JSON.stringify(previousFiles),
          run.gitCommit ?? null
        )
      const insertChange = this.database.prepare(
        'INSERT INTO changes (run_id, position, slug, action, before_json, after_json) VALUES (?, ?, ?, ?, ?, ?)'
      )
      changes.forEach((change, index) => {
        if (change.after && change.slug !== 'index') {
          const existingLabels = this.listPageVersions(change.slug).map(v => v.versionLabel)
          const label = nextSemanticVersion(existingLabels, 'candidate')
          change.after.versionLabel = label
          this.database
            .prepare(
              `INSERT INTO page_versions (id, slug, version_label, status, created_at, created_by, note, page_json)
               VALUES (?, ?, ?, 'candidate', ?, ?, ?, ?)`
            )
            .run(
              randomUUID(),
              change.slug,
              label,
              run.createdAt,
              run.model,
              change.after.status === 'pending_delete'
                ? 'AI 建议删除（待管理员审批）'
                : `LLM-Wiki 自动整理候补 (${change.action})`,
              JSON.stringify(change.after)
            )
        }
        this.applyPageChange(change)
        insertChange.run(
          run.id,
          index,
          change.slug,
          change.action,
          change.before ? JSON.stringify(change.before) : null,
          change.after ? JSON.stringify(change.after) : null
        )
      })
      this.database.exec('COMMIT')
      this.bumpRevision()
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  async undo(runId: string): Promise<void> {
    await withKbWriteLock(this.root, async () => {
      const run = this.database
        .prepare('SELECT undone, files_before_json, summary FROM runs WHERE id = ?')
        .get(runId) as { undone: number; files_before_json: string | null; summary: string } | undefined
      if (!run) throw new Error('找不到这次整理记录')
      if (run.undone) throw new Error('这次整理已经撤销')
      const newer = this.database
        .prepare('SELECT COUNT(*) AS count FROM runs WHERE undone = 0 AND created_at > (SELECT created_at FROM runs WHERE id = ?)')
        .get(runId) as { count: number }
      if (newer.count > 0) throw new Error('请先撤销之后的整理记录')

      const changes = this.getChanges(runId)
      for (const change of [...changes].reverse()) {
        await writePage(this.root, change.slug, change.before && change.before.status !== 'deleted' ? change.before : null)
      }

      const restoredFiles: FileRecord[] = run.files_before_json ? (JSON.parse(run.files_before_json) as FileRecord[]) : []

      this.database.exec('BEGIN IMMEDIATE')
      try {
        for (const change of [...changes].reverse()) {
          if (change.before) {
            const baseline =
              change.before.status === 'published'
                ? JSON.stringify(change.before)
                : (this.getPublishedBaseline(change.slug) ? JSON.stringify(this.getPublishedBaseline(change.slug)) : null)
            this.upsertPage(change.before, baseline)
          } else {
            this.database.prepare('DELETE FROM pages WHERE slug = ?').run(change.slug)
          }
        }
        this.database.prepare('DELETE FROM files').run()
        if (restoredFiles.length) {
          const insertFile = this.database.prepare('INSERT INTO files (path, hash, size, mtime, notes) VALUES (?, ?, ?, ?, ?)')
          for (const file of restoredFiles) {
            insertFile.run(file.path, file.hash, file.size, file.mtime, JSON.stringify(file.notes))
          }
        }
        this.database.prepare('UPDATE runs SET undone = 1 WHERE id = ?').run(runId)
        this.database.exec('COMMIT')
        this.bumpRevision()
      } catch (error) {
        this.database.exec('ROLLBACK')
        throw error
      }
      this.rebuildMutualIndex()
      await this.commitWikiGit(`undo: ${run.summary.split('\n')[0]}`)
    })
  }

  private applyPageChange(change: StoredChange): void {
    if (change.after) {
      let publishedJson: string | null = null
      if (change.after.status === 'published') {
        publishedJson = JSON.stringify(change.after)
      } else {
        const existingBaseline = this.getPublishedBaseline(change.slug)
        if (existingBaseline) {
          publishedJson = JSON.stringify(existingBaseline)
        } else if (change.before?.status === 'published') {
          publishedJson = JSON.stringify(change.before)
        }
      }
      this.upsertPage(change.after, publishedJson)
    } else {
      this.database.prepare('DELETE FROM pages WHERE slug = ?').run(change.slug)
    }
  }

  private upsertPage(page: WikiPage, publishedJson: string | null): void {
    const storageDomain = page.storageDomain ?? classifyPageStorageDomain(page)
    const accessLevel = page.accessLevel ?? inferAccessLevel({ ...page, storageDomain })
    this.database
      .prepare(
        `
      INSERT INTO pages (
        slug, title, summary, content, sources, links, updated_at,
        page_type, status, evidence_level, applicability, model_version,
        reviewed_by, reviewed_at, published_json,
        storage_domain, access_level, version_label, workflow_note, schema_entities
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(slug) DO UPDATE SET
        title = excluded.title,
        summary = excluded.summary,
        content = excluded.content,
        sources = excluded.sources,
        links = excluded.links,
        updated_at = excluded.updated_at,
        page_type = excluded.page_type,
        status = excluded.status,
        evidence_level = excluded.evidence_level,
        applicability = excluded.applicability,
        model_version = excluded.model_version,
        reviewed_by = excluded.reviewed_by,
        reviewed_at = excluded.reviewed_at,
        published_json = excluded.published_json,
        storage_domain = excluded.storage_domain,
        access_level = excluded.access_level,
        version_label = excluded.version_label,
        workflow_note = excluded.workflow_note,
        schema_entities = excluded.schema_entities
    `
      )
      .run(
        page.slug,
        page.title,
        page.summary,
        page.content,
        JSON.stringify(page.sources),
        JSON.stringify(page.links),
        page.updatedAt,
        page.pageType,
        page.status,
        page.evidenceLevel,
        page.applicability,
        page.modelVersion,
        page.reviewedBy,
        page.reviewedAt,
        publishedJson,
        storageDomain,
        accessLevel,
        page.versionLabel || 'V1.0',
        page.workflowNote ?? null,
        JSON.stringify(page.schemaEntities ?? [])
      )
  }
}

function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function normalizeStatus(status: string | null | undefined): WikiPageStatus {
  if (
    status === 'draft' ||
    status === 'moderating' ||
    status === 'validating' ||
    status === 'published' ||
    status === 'archived' ||
    status === 'pending_delete' ||
    status === 'deleted'
  ) {
    return status
  }
  return 'published'
}

export function normalizeWikiPage(
  page: Partial<WikiPage> & Pick<WikiPage, 'slug' | 'title' | 'summary' | 'content' | 'sources' | 'links' | 'updatedAt'>
): WikiPage {
  const pageType = (page.pageType as WikiPageType) || (page.slug === 'index' ? 'index' : 'concept')
  const storageDomain =
    page.storageDomain ?? classifyPageStorageDomain({ pageType, title: page.title, summary: page.summary, content: page.content })
  const status = normalizeStatus(page.status)
  return {
    slug: page.slug,
    title: page.title,
    summary: page.summary,
    content: page.content,
    sources: page.sources,
    links: page.links,
    updatedAt: page.updatedAt,
    pageType,
    status,
    evidenceLevel: (page.evidenceLevel as EvidenceLevel) || 'operational_doc',
    applicability: page.applicability ?? '',
    modelVersion: page.modelVersion ?? '',
    reviewedBy: page.reviewedBy ?? null,
    reviewedAt: page.reviewedAt ?? null,
    hasPublishedVersion: page.hasPublishedVersion ?? status === 'published',
    storageDomain,
    accessLevel: (page.accessLevel as AccessLevel) || inferAccessLevel({ storageDomain, title: page.title, summary: page.summary }),
    versionLabel: page.versionLabel || 'V1.0',
    workflowNote: page.workflowNote ?? null,
    schemaEntities: Array.isArray(page.schemaEntities) ? page.schemaEntities : []
  }
}

function pageFromRow(row: PageRow): WikiPage {
  const status = normalizeStatus(row.status)
  const pageType = (row.page_type as WikiPageType) || (row.slug === 'index' ? 'index' : 'concept')
  const storageDomain =
    (row.storage_domain as StorageDomain) ||
    classifyPageStorageDomain({ pageType, title: row.title, summary: row.summary, content: row.content })
  return {
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    content: row.content,
    sources: safeJsonParse<SourceReference[]>(row.sources, []),
    links: safeJsonParse<string[]>(row.links, []),
    updatedAt: row.updated_at,
    pageType,
    status,
    evidenceLevel: (row.evidence_level as EvidenceLevel) || 'operational_doc',
    applicability: row.applicability ?? '',
    modelVersion: row.model_version ?? '',
    reviewedBy: row.reviewed_by ?? null,
    reviewedAt: row.reviewed_at ?? null,
    hasPublishedVersion: Boolean(row.published_json) || status === 'published',
    storageDomain,
    accessLevel: (row.access_level as AccessLevel) || 'internal',
    versionLabel: row.version_label || 'V1.0',
    workflowNote: row.workflow_note ?? null,
    schemaEntities: safeJsonParse<string[]>(row.schema_entities, [])
  }
}

function formatPageBodyForDiff(page: WikiPage): string {
  const sources = page.sources.map(s => `- ${s.file} (${s.locator}): ${s.excerpt}`).join('\n')
  return [
    `标题: ${page.title}`,
    `类型: ${page.pageType} | 存储域: ${page.storageDomain ?? 'foundation'} | 权限: ${page.accessLevel ?? 'internal'} | 版本: ${page.versionLabel ?? 'V1.0'}`,
    `证据等级: ${page.evidenceLevel} | 适用条件: ${page.applicability || '通用'}`,
    `摘要: ${page.summary}`,
    '',
    page.content.trim(),
    sources ? `\n## 来源\n${sources}` : '',
    page.links.length ? `\n## 相关页面\n${page.links.join(', ')}` : ''
  ]
    .filter(Boolean)
    .join('\n')
}

export async function writePage(root: string, slug: string, page: WikiPage | null): Promise<void> {
  const filename = path.join(root, 'wiki', `${slug}.md`)
  if (!page) {
    await fs.rm(filename, { force: true })
    return
  }
  if (!page.title.trim()) throw new Error(`拒绝写入无效页面（${slug}）：缺少标题`)

  const exportedBody = page.content.trim().replace(/\]\(wiki:([^\s)]+)\)/g, '](./$1.md)')
  const sourceSection = page.sources.length
    ? `\n\n## 来源\n\n${page.sources.map(source => `- **${source.file} · ${source.locator}**\n  > ${source.excerpt}`).join('\n')}`
    : ''
  const linkSection = page.links.length
    ? `\n\n## 相关页面\n\n${page.links.map(link => `- [[${link}]]`).join('\n')}`
    : ''
  const body = `# ${page.title}\n\n> ${page.summary}\n\n${exportedBody}${sourceSection}${linkSection}\n`
  const storageDomain = page.storageDomain ?? classifyPageStorageDomain(page)
  const frontmatter: Record<string, unknown> = {
    page_id: page.slug,
    type: page.pageType,
    storage_domain: storageDomain,
    access_level: page.accessLevel ?? 'internal',
    version: page.versionLabel ?? 'V1.0',
    title: page.title,
    status: page.status,
    evidence_level: page.evidenceLevel,
    applicability: page.applicability || '通用',
    schema_entities: page.schemaEntities ?? [],
    source_refs: page.sources.map(s => `${s.file}#${s.locator}`),
    model_version: page.modelVersion || 'external-api',
    reviewed_by: page.reviewedBy,
    reviewed_at: page.reviewedAt,
    updated_at: page.updatedAt
  }
  const markdown = matter.stringify(body, frontmatter)
  const verified = matter(markdown)
  if (!verified.data || verified.data.page_id !== page.slug) {
    throw new Error(`YAML Frontmatter 校验失败，已中止覆盖写入：${slug}`)
  }
  await atomicWriteText(filename, markdown)
}
