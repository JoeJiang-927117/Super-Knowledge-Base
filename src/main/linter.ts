/**
 * Zhixu Knowledge Health & Code-Safe Auto-Repair Engine (v2).
 *
 * Deterministic audit covering:
 * - Source integrity (missing verified citations, stale or deleted source files)
 * - Graph integrity (broken links, orphan pages, duplicate normalized titles)
 * - Governance & Schema constraints (draft/delete backlogs, required domain fields, thin pages)
 * - Atomic code-safe link repair under reentrant KB write lock
 */

import type { WikiLintFixResult, WikiLintIssue, WikiLintReport, WikiPage } from '../shared/types'
import { listWorkspaceFiles } from './documents'
import { buildNormLinkIndex, stripGhostWikilinks, withKbWriteLock } from './safe-write'
import { validatePageAgainstSchema } from './schema'
import type { WikiStore } from './store'
import { WORKFLOW_STATUS_LABELS } from './workflow'

export async function runWikiLint(store: WikiStore): Promise<WikiLintReport> {
  const pages = store.getPages().filter(page => page.status !== 'deleted')
  const contentPages = pages.filter(page => page.slug !== 'index')
  const validSlugs = new Set(pages.map(page => page.slug))
  const liveFiles = new Set((await listWorkspaceFiles(store.root)).files.map(file => file.path))
  const indexedFiles = new Map(store.getFiles().map(file => [file.path, file]))

  const inboundCounts = new Map<string, number>()
  for (const page of contentPages) {
    for (const target of page.links) {
      if (target !== page.slug && validSlugs.has(target)) {
        inboundCounts.set(target, (inboundCounts.get(target) ?? 0) + 1)
      }
    }
  }

  const issues: WikiLintIssue[] = []
  const seenTitles = new Map<string, WikiPage>()

  for (const page of contentPages) {
    if (
      page.status === 'draft' ||
      page.status === 'moderating' ||
      page.status === 'validating' ||
      page.status === 'pending_delete'
    ) {
      issues.push({
        id: `draft-${page.slug}`,
        severity: page.status === 'pending_delete' ? 'warning' : 'info',
        category: 'draft_backlog',
        slug: page.slug,
        title: page.title,
        message:
          page.status === 'pending_delete'
            ? 'AI 建议删除，需管理员审批确认移入回收站或驳回保留。'
            : `处于「${WORKFLOW_STATUS_LABELS[page.status]}」状态，发布后纳入正式检索。`
      })
    }

    const schemaErrors = validatePageAgainstSchema(page)
    for (let idx = 0; idx < schemaErrors.length; idx += 1) {
      issues.push({
        id: `schema-${page.slug}-${idx}`,
        severity: 'warning',
        category: 'schema_violation',
        slug: page.slug,
        title: page.title,
        message: `Schema 校验：${schemaErrors[idx]}`
      })
    }

    if (page.content.trim().length < 40) {
      issues.push({
        id: `thin-${page.slug}`,
        severity: 'info',
        category: 'schema_violation',
        slug: page.slug,
        title: page.title,
        message: '页面正文内容过短（不足 40 字），建议补充上下文或合并到上级主题。'
      })
    }

    if (!page.sources.length) {
      issues.push({
        id: `nosrc-${page.slug}`,
        severity: 'error',
        category: 'no_sources',
        slug: page.slug,
        title: page.title,
        message: '缺少通过原文核验的来源引用，请对照原始资料核查。'
      })
    } else {
      const missingFiles = page.sources.map(source => source.file).filter(file => !liveFiles.has(file))
      if (missingFiles.length) {
        issues.push({
          id: `stale-${page.slug}`,
          severity: 'warning',
          category: 'stale_source',
          slug: page.slug,
          title: page.title,
          message: `引用原件已移出或删除：${[...new Set(missingFiles)].join('、')}`
        })
      } else {
        const unindexedSources = page.sources.map(source => source.file).filter(file => !indexedFiles.has(file))
        if (unindexedSources.length) {
          issues.push({
            id: `unindexed-${page.slug}`,
            severity: 'warning',
            category: 'stale_source',
            slug: page.slug,
            title: page.title,
            message: '引用资料已更新，建议重新整理核验。'
          })
        }
      }
    }

    const brokenLinks = page.links.filter(target => !validSlugs.has(target))
    if (brokenLinks.length) {
      issues.push({
        id: `broken-${page.slug}`,
        severity: 'warning',
        category: 'broken_link',
        slug: page.slug,
        title: page.title,
        message: `存在失效链接：${brokenLinks.join('、')}`
      })
    }

    const inbound = inboundCounts.get(page.slug) ?? 0
    const outbound = page.links.filter(target => target !== 'index' && validSlugs.has(target)).length
    if (contentPages.length > 1 && inbound === 0 && outbound === 0) {
      issues.push({
        id: `orphan-${page.slug}`,
        severity: 'info',
        category: 'orphan',
        slug: page.slug,
        title: page.title,
        message: '孤立页面：当前与其他页面无正向或反向关联。'
      })
    }

    const normTitle = page.title.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '')
    if (normTitle) {
      const existing = seenTitles.get(normTitle)
      if (existing) {
        issues.push({
          id: `dup-${page.slug}`,
          severity: 'warning',
          category: 'duplicate_title',
          slug: page.slug,
          title: page.title,
          message: `标题与「${existing.title}」(${existing.slug}) 重复，建议合并。`
        })
      } else {
        seenTitles.set(normTitle, page)
      }
    }
  }

  const severityOrder = { error: 0, warning: 1, info: 2 }
  issues.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity])

  return {
    checkedAt: new Date().toISOString(),
    totalPages: contentPages.length,
    publishedCount: contentPages.filter(p => p.status === 'published').length,
    draftCount: contentPages.filter(
      p => p.status === 'draft' || p.status === 'moderating' || p.status === 'validating' || p.status === 'pending_delete'
    ).length,
    issues
  }
}

export async function fixWikiLint(store: WikiStore): Promise<WikiLintFixResult> {
  let filesChanged = 0
  let ghostLinksStripped = 0
  let canonicalizedLinks = 0

  await withKbWriteLock(store.root, async () => {
    const pages = store.getPages().filter(page => page.status !== 'deleted')
    const validSlugs = new Set(pages.map(p => p.slug))
    const normIndex = buildNormLinkIndex(validSlugs)
    const now = new Date().toISOString()

    for (const page of pages) {
      if (page.slug === 'index') continue
      const { cleaned, ghosts, canonicalized } = stripGhostWikilinks(page.content, validSlugs, normIndex)
      const cleanedLinks: string[] = []
      let removedInvalidLink = 0

      for (const link of page.links) {
        if (validSlugs.has(link) && link !== page.slug) {
          cleanedLinks.push(link)
        } else {
          const canonical = normIndex.get(link.normalize('NFKC').toLowerCase().replaceAll('_', '-'))
          if (canonical && canonical !== page.slug) {
            cleanedLinks.push(canonical)
            canonicalizedLinks += 1
          } else {
            removedInvalidLink += 1
          }
        }
      }

      const uniqueLinks = [...new Set(cleanedLinks)]
      const contentChanged = cleaned !== page.content
      const linksChanged =
        uniqueLinks.length !== page.links.length || uniqueLinks.some((v, idx) => v !== page.links[idx])

      if (contentChanged || linksChanged) {
        const updated: WikiPage = {
          ...page,
          content: cleaned,
          links: uniqueLinks,
          updatedAt: now
        }
        await store.updatePageSafely(updated)
        filesChanged += 1
        ghostLinksStripped += ghosts.length + removedInvalidLink
        canonicalizedLinks += canonicalized
      }
    }
    if (filesChanged > 0) {
      store.rebuildMutualIndex()
      await store.commitWikiGit(`lint-fix: 修复 ${filesChanged} 篇页面断链（清理 ${ghostLinksStripped}，规范化 ${canonicalizedLinks}）`)
    }
  })

  const report = await runWikiLint(store)
  return {
    filesChanged,
    ghostLinksStripped,
    canonicalizedLinks,
    report
  }
}
