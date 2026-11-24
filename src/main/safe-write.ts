/**
 * Zhixu Crash-Resilient Atomic I/O, Cooperative Reentrant Locking & Code-Safe Wikilink Repair (v2).
 *
 * Key engineering upgrades:
 * - Dead-PID detection on `.localwiki/ingest.lock`: recovers orphaned locks from crashed processes
 *   in milliseconds instead of waiting 120 seconds.
 * - Windows-hardened `atomicWriteText`: exponential backoff on transient `EPERM`/`EBUSY`/`EACCES`
 *   file-replace contention caused by antivirus or search indexers.
 * - Markdown-aware `stripGhostWikilinks`: preserves fenced code blocks and inline code spans intact.
 */

import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'

const processLocks = new Map<string, Promise<void>>()
const heldLocksContext = new AsyncLocalStorage<Set<string>>()

const LOCK_RETRY_MS = 50
const LOCK_TIMEOUT_MS = 20_000
const STALE_LOCK_AGE_MS = 120_000
const RENAME_RETRY_DELAYS_MS = [25, 60, 120, 240]

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code
    // EPERM means the process exists but belongs to another privilege context
    return code === 'EPERM'
  }
}

async function isLockFileOrphaned(lockPath: string): Promise<boolean> {
  try {
    const [stat, raw] = await Promise.all([fs.stat(lockPath), fs.readFile(lockPath, 'utf8').catch(() => '')])
    if (Date.now() - stat.mtimeMs > STALE_LOCK_AGE_MS) return true
    if (raw.trim()) {
      const parsed = JSON.parse(raw) as { pid?: number }
      if (typeof parsed.pid === 'number' && parsed.pid !== process.pid && !isProcessAlive(parsed.pid)) {
        return true
      }
    }
    return false
  } catch {
    return false
  }
}

/**
 * Acquire an exclusive, async-context reentrant write lock (in-process queue + cross-process lockfile
 * with dead-PID self-healing).
 */
export async function withKbWriteLock<T>(root: string, fn: () => Promise<T>): Promise<T> {
  const lockDir = path.join(root, '.localwiki')
  const lockPath = path.join(lockDir, 'ingest.lock')
  const key = path.resolve(lockPath)

  const currentHeld = heldLocksContext.getStore()
  if (currentHeld?.has(key)) {
    return await fn()
  }

  const previous = processLocks.get(key) ?? Promise.resolve()
  let releaseQueue!: () => void
  const current = new Promise<void>(resolve => {
    releaseQueue = resolve
  })
  const queued = previous.then(() => current)
  processLocks.set(key, queued)

  await previous
  await fs.mkdir(lockDir, { recursive: true })

  let handle: fs.FileHandle | null = null
  const deadline = Date.now() + LOCK_TIMEOUT_MS

  try {
    while (!handle) {
      try {
        handle = await fs.open(lockPath, 'wx')
        await handle.writeFile(
          JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }) + '\n',
          'utf8'
        )
      } catch (error) {
        const code = (error as NodeJS.ErrnoException)?.code
        if (code !== 'EEXIST') throw error
        if (await isLockFileOrphaned(lockPath)) {
          await fs.rm(lockPath, { force: true }).catch(() => undefined)
          continue
        }
        if (Date.now() > deadline) {
          throw new Error('知识库写入锁等待超时，请稍后重试')
        }
        await new Promise(resolve => setTimeout(resolve, LOCK_RETRY_MS))
      }
    }

    const nextHeld = new Set(currentHeld ?? [])
    nextHeld.add(key)
    return await heldLocksContext.run(nextHeld, fn)
  } finally {
    if (handle) {
      try {
        await handle.close()
      } catch {
        // Ignore close errors.
      }
      await fs.rm(lockPath, { force: true }).catch(() => undefined)
    }
    releaseQueue()
    if (processLocks.get(key) === queued) {
      processLocks.delete(key)
    }
  }
}

/**
 * Windows-hardened atomic file replacement: write temp -> fsync -> atomic rename with retry backoff.
 */
export async function atomicWriteText(targetPath: string, content: string): Promise<void> {
  const dir = path.dirname(targetPath)
  await fs.mkdir(dir, { recursive: true })
  const tmpPath = path.join(dir, `.${path.basename(targetPath)}.${randomUUID().slice(0, 8)}.tmp`)
  let fh: fs.FileHandle | null = null
  try {
    fh = await fs.open(tmpPath, 'w')
    await fh.writeFile(content, 'utf8')
    await fh.sync()
    await fh.close()
    fh = null

    let lastErr: unknown = null
    for (let attempt = 0; attempt <= RENAME_RETRY_DELAYS_MS.length; attempt += 1) {
      try {
        await fs.rename(tmpPath, targetPath)
        lastErr = null
        break
      } catch (err) {
        const code = (err as NodeJS.ErrnoException)?.code
        const retryable = code === 'EPERM' || code === 'EBUSY' || code === 'EACCES'
        if (!retryable || attempt === RENAME_RETRY_DELAYS_MS.length) {
          lastErr = err
          break
        }
        await new Promise(resolve => setTimeout(resolve, RENAME_RETRY_DELAYS_MS[attempt]))
      }
    }
    if (lastErr) throw lastErr
  } catch (error) {
    if (fh) {
      await fh.close().catch(() => undefined)
    }
    await fs.rm(tmpPath, { force: true }).catch(() => undefined)
    throw error
  }
}

export function normalizeWikiLinkTarget(target: string): string {
  const normalized = target.normalize('NFKC').toLowerCase().replaceAll('_', '-')
  return normalized
    .split('/')
    .map(part => part.replace(/-+/g, '-').replace(/^-+|-+$/g, ''))
    .join('/')
}

export function buildNormLinkIndex(knownTargets: Iterable<string>): Map<string, string> {
  const index = new Map<string, string>()
  for (const target of knownTargets) {
    index.set(normalizeWikiLinkTarget(target), target)
  }
  return index
}

const WIKILINK_RE = /\[\[([^\]]+)\]\]/g
// Matches fenced code blocks or inline code spans so wikilinks inside code are never mutated
const PROTECTED_CODE_RE = /(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]+`)/g

/**
 * Code-safe wikilink canonicalizer & ghost-link stripper:
 * - Preserves fenced code blocks and inline code untouched
 * - Exact match -> keep
 * - Fuzzy normalized match -> rewrite to canonical slug
 * - Non-existent ghost link -> unwrap to readable display text
 */
export function stripGhostWikilinks(
  content: string,
  knownTargets: Set<string>,
  normIndex?: Map<string, string>
): { cleaned: string; ghosts: string[]; canonicalized: number } {
  const resolvedIndex = normIndex ?? buildNormLinkIndex(knownTargets)
  const ghosts: string[] = []
  let canonicalized = 0

  const segments = content.split(PROTECTED_CODE_RE)
  const rebuilt = segments.map((seg, idx) => {
    // Odd indices correspond to captured protected code regions
    if (idx % 2 === 1) return seg
    return seg.replace(WIKILINK_RE, (fullMatch, rawInner: string) => {
      let target: string
      let alias: string | null = null
      const pipeIdx = rawInner.indexOf('|')
      if (pipeIdx >= 0) {
        target = rawInner.slice(0, pipeIdx).trim()
        alias = rawInner.slice(pipeIdx + 1).trim()
      } else {
        target = rawInner.trim()
      }

      if (knownTargets.has(target)) return fullMatch

      const canonical = resolvedIndex.get(normalizeWikiLinkTarget(target))
      if (canonical) {
        canonicalized += 1
        return alias ? `[[${canonical}|${alias}]]` : `[[${canonical}]]`
      }

      ghosts.push(target)
      if (alias) return alias
      const stem = target.split('/').pop() ?? target
      return stem.replace(/[-_]+/g, ' ').trim()
    })
  })

  return { cleaned: rebuilt.join(''), ghosts, canonicalized }
}
