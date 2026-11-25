/**
 * Hardened Admin Authentication & Account Management for 知序 ZHIXU.
 *
 * Security properties:
 * - No hardcoded universal default password.
 *   * On non-loopback binds (e.g. 0.0.0.0), startup refuses unless a strong
 *     ZHIXU_ADMIN_PASSWORD (>= 12 chars, non-weak) is provided or accounts already exist.
 *   * On desktop / loopback first run without ZHIXU_ADMIN_PASSWORD, enters `needsSetup`
 *     mode requiring interactive superadmin initialization before login.
 * - Minimum password length: 12 characters with weak-password rejection.
 * - Passwords stored exclusively as salted scrypt hashes with timingSafeEqual verification.
 * - Per-IP and per-account login rate limiting with progressive backoff, lockout (429),
 *   and structured failure logging (never logging plaintext secrets).
 */

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { AdminAuthState, AdminRole, AdminUserRecord } from '../shared/types'
import { atomicWriteText } from './safe-write'

export const MIN_PASSWORD_LENGTH = 12

const BANNED_WEAK_PASSWORDS = new Set([
  '123456789',
  '1234567890',
  '123456789012',
  '1234567890123',
  'password',
  'password1234',
  'password123456',
  'admin1234567',
  'admin12345678',
  'zhixu1234567',
  'zhixu12345678',
  'qwertyuiop12',
  'changeme1234',
  'change-me-to-a-strong-password'
])

export class AuthHttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly retryAfterSec?: number
  ) {
    super(message)
    this.name = 'AuthHttpError'
  }
}

type StoredAdminUser = {
  username: string
  role: AdminRole
  salt: string
  passwordHash: string
  createdAt: string
  lastLoginAt: string | null
}

type StoredAdminFile = {
  users: StoredAdminUser[]
}

type SessionEntry = {
  token: string
  username: string
  createdAt: number
  expiresAt: number
}

type FailureBucket = {
  timestamps: number[]
  lockedUntil: number
}

export type LoginFailureLog = {
  at: string
  ip: string
  username: string
  attemptsInWindow: number
  locked: boolean
}

export type AdminAuthOptions = {
  sessionTtlMs?: number
  rateLimitWindowMs?: number
  maxFailedAttempts?: number
  lockoutMs?: number
  progressiveDelayBaseMs?: number
}

export type AdminInitializeOptions = {
  bindHost?: string
  requireSeedPasswordOnNetwork?: boolean
  envAdminUser?: string
  envAdminPassword?: string
}

const DEFAULT_SESSION_TTL_MS = 24 * 60 * 60 * 1000
const DEFAULT_RATE_WINDOW_MS = 15 * 60 * 1000
const DEFAULT_MAX_FAILED_ATTEMPTS = 5
const DEFAULT_LOCKOUT_MS = 15 * 60 * 1000
const DEFAULT_PROGRESSIVE_DELAY_MS = 350

export function isLoopbackHost(host: string | undefined): boolean {
  const normalized = (host ?? '127.0.0.1').trim().toLowerCase()
  return normalized === '127.0.0.1' || normalized === 'localhost' || normalized === '::1'
}

export function validatePasswordStrength(password: string): string | null {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return `密码长度至少 ${MIN_PASSWORD_LENGTH} 位（Password must be at least ${MIN_PASSWORD_LENGTH} characters）`
  }
  const lowered = password.trim().toLowerCase()
  if (BANNED_WEAK_PASSWORDS.has(lowered)) {
    return '禁止使用常见弱口令或旧默认密码，请设置高强度密码'
  }
  const classes = [
    /[a-z]/.test(password),
    /[A-Z]/.test(password),
    /[0-9]/.test(password),
    /[^a-zA-Z0-9]/.test(password)
  ].filter(Boolean).length
  if (password.length < 16 && classes < 2) {
    return '12~15 位密码须包含字母、数字或符号中的至少两类（或使用 16 位以上口令）'
  }
  return null
}

function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, 64).toString('hex')
}

function verifyPassword(password: string, salt: string, expectedHex: string): boolean {
  const actual = Buffer.from(hashPassword(password, salt), 'hex')
  const expected = Buffer.from(expectedHex, 'hex')
  if (actual.length !== expected.length) return false
  return timingSafeEqual(actual, expected)
}

export class AdminAuthManager {
  private users: StoredAdminUser[] = []
  private sessions = new Map<string, SessionEntry>()
  private desktopActiveUser: string | null = null
  private localPasswordlessActive = false
  private failureBuckets = new Map<string, FailureBucket>()
  private failureLogs: LoginFailureLog[] = []

  private readonly sessionTtlMs: number
  private readonly rateLimitWindowMs: number
  private readonly maxFailedAttempts: number
  private readonly lockoutMs: number
  private readonly progressiveDelayBaseMs: number

  constructor(private readonly filePath: string, options: AdminAuthOptions = {}) {
    this.sessionTtlMs = options.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS
    this.rateLimitWindowMs = options.rateLimitWindowMs ?? DEFAULT_RATE_WINDOW_MS
    this.maxFailedAttempts = options.maxFailedAttempts ?? DEFAULT_MAX_FAILED_ATTEMPTS
    this.lockoutMs = options.lockoutMs ?? DEFAULT_LOCKOUT_MS
    this.progressiveDelayBaseMs = options.progressiveDelayBaseMs ?? DEFAULT_PROGRESSIVE_DELAY_MS
  }

  needsSetup(): boolean {
    return this.users.length === 0
  }

  getRecentLoginFailures(): LoginFailureLog[] {
    return [...this.failureLogs]
  }

  async initialize(options: AdminInitializeOptions = {}): Promise<void> {
    const bindHost = options.bindHost ?? process.env.ZHIXU_HOST ?? '127.0.0.1'
    const nonLoopback = !isLoopbackHost(bindHost)
    const envUser = (options.envAdminUser ?? process.env.ZHIXU_ADMIN_USER ?? '').trim() || 'zhixu'
    const envPass = options.envAdminPassword !== undefined ? options.envAdminPassword : (process.env.ZHIXU_ADMIN_PASSWORD ?? '')

    try {
      const raw = JSON.parse(await fs.readFile(this.filePath, 'utf8')) as StoredAdminFile
      if (Array.isArray(raw.users) && raw.users.length > 0) {
        this.users = raw.users
        if (nonLoopback && options.requireSeedPasswordOnNetwork) {
          // Refuse network exposure if a persisted account still uses the legacy weak default password.
          const legacyWeak = this.users.some(u => verifyPassword('123456789', u.salt, u.passwordHash))
          if (legacyWeak) {
            throw new Error(
              `安全拦截：检测到管理员账号仍使用旧默认密码，拒绝在非本机地址 (${bindHost}) 启动。请先在本机修改为至少 ${MIN_PASSWORD_LENGTH} 位强密码。`
            )
          }
        }
        return
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('安全拦截：')) {
        throw error
      }
      // File missing or empty -> first run.
    }

    if (envPass) {
      const strengthError = validatePasswordStrength(envPass)
      if (strengthError) {
        throw new Error(`初始化失败：ZHIXU_ADMIN_PASSWORD 不符合安全要求：${strengthError}`)
      }
      const salt = randomBytes(16).toString('hex')
      this.users = [
        {
          username: envUser,
          role: 'superadmin',
          salt,
          passwordHash: hashPassword(envPass, salt),
          createdAt: new Date().toISOString(),
          lastLoginAt: null
        }
      ]
      await this.persist()
      return
    }

    if (nonLoopback && options.requireSeedPasswordOnNetwork) {
      throw new Error(
        `安全拦截：非本机监听 (${bindHost}) 首次启动必须设置强密码环境变量 ZHIXU_ADMIN_PASSWORD（至少 ${MIN_PASSWORD_LENGTH} 位），禁止无初始密码启动。`
      )
    }

    // Loopback / desktop first run: no hardcoded default password; require interactive setup.
    this.users = []
  }

  async setupInitialAdmin(username: string, password: string): Promise<{ token: string; user: AdminUserRecord }> {
    if (!this.needsSetup()) {
      throw new AuthHttpError(409, '管理员账号已完成初始化，请直接登录')
    }
    const cleanName = username.trim() || 'zhixu'
    if (!/^[a-zA-Z0-9_-]{3,32}$/.test(cleanName)) {
      throw new AuthHttpError(400, '账号需为 3~32 位字母、数字、下划线或连字符')
    }
    const strengthError = validatePasswordStrength(password)
    if (strengthError) {
      throw new AuthHttpError(400, strengthError)
    }
    const salt = randomBytes(16).toString('hex')
    const nowIso = new Date().toISOString()
    const created: StoredAdminUser = {
      username: cleanName,
      role: 'superadmin',
      salt,
      passwordHash: hashPassword(password, salt),
      createdAt: nowIso,
      lastLoginAt: nowIso
    }
    this.users = [created]
    await this.persist()
    return this.issueSession(created)
  }

  private async persist(): Promise<void> {
    await atomicWriteText(this.filePath, JSON.stringify({ users: this.users }, null, 2))
  }

  private toPublicUser(user: StoredAdminUser): AdminUserRecord {
    return {
      username: user.username,
      role: user.role,
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt
    }
  }

  private issueSession(user: StoredAdminUser): { token: string; user: AdminUserRecord } {
    const token = `zhixu_adm_${randomBytes(24).toString('hex')}`
    const now = Date.now()
    this.sessions.set(token, {
      token,
      username: user.username,
      createdAt: now,
      expiresAt: now + this.sessionTtlMs
    })
    this.desktopActiveUser = user.username
    return { token, user: this.toPublicUser(user) }
  }

  private pruneBucket(key: string, now: number): FailureBucket {
    const existing = this.failureBuckets.get(key) ?? { timestamps: [], lockedUntil: 0 }
    existing.timestamps = existing.timestamps.filter(ts => now - ts <= this.rateLimitWindowMs)
    if (existing.lockedUntil <= now) existing.lockedUntil = 0
    this.failureBuckets.set(key, existing)
    return existing
  }

  private checkRateLimit(ip: string, username: string, now: number): void {
    const keys = [`ip:${ip}`, `acct:${ip}:${username}`]
    for (const key of keys) {
      const bucket = this.pruneBucket(key, now)
      if (bucket.lockedUntil > now) {
        const retryAfterSec = Math.max(1, Math.ceil((bucket.lockedUntil - now) / 1000))
        throw new AuthHttpError(
          429,
          `登录失败次数过多，已触发安全锁定，请在 ${retryAfterSec} 秒后重试`,
          retryAfterSec
        )
      }
    }
  }

  private recordFailure(ip: string, username: string, now: number): { attempts: number; locked: boolean } {
    const acctKey = `acct:${ip}:${username}`
    const ipKey = `ip:${ip}`
    const acctBucket = this.pruneBucket(acctKey, now)
    const ipBucket = this.pruneBucket(ipKey, now)
    acctBucket.timestamps.push(now)
    ipBucket.timestamps.push(now)

    let locked = false
    if (acctBucket.timestamps.length >= this.maxFailedAttempts) {
      acctBucket.lockedUntil = now + this.lockoutMs
      locked = true
    }
    if (ipBucket.timestamps.length >= this.maxFailedAttempts * 2) {
      ipBucket.lockedUntil = now + this.lockoutMs
      locked = true
    }

    const attempts = Math.max(acctBucket.timestamps.length, ipBucket.timestamps.length)
    const entry: LoginFailureLog = {
      at: new Date(now).toISOString(),
      ip,
      username,
      attemptsInWindow: attempts,
      locked
    }
    this.failureLogs.push(entry)
    if (this.failureLogs.length > 200) this.failureLogs.shift()
    console.warn(
      `[zhixu-auth] login_failed ip=${ip} user=${username || '<empty>'} attempts=${attempts} locked=${locked}`
    )
    return { attempts, locked }
  }

  private clearFailures(ip: string, username: string): void {
    this.failureBuckets.delete(`acct:${ip}:${username}`)
  }

  async login(
    username: string,
    password: string,
    clientIp = 'local'
  ): Promise<{ token: string; user: AdminUserRecord }> {
    if (this.needsSetup()) {
      throw new AuthHttpError(409, '尚未初始化超级管理员，请先设置初始密码')
    }
    const cleanName = username.trim()
    const ip = clientIp.trim() || 'local'
    const now = Date.now()

    this.checkRateLimit(ip, cleanName, now)

    const found = this.users.find(u => u.username === cleanName)
    const passwordOk = Boolean(found && verifyPassword(password, found.salt, found.passwordHash))

    if (!found || !passwordOk) {
      const { attempts, locked } = this.recordFailure(ip, cleanName, now)
      if (this.progressiveDelayBaseMs > 0 && attempts >= 2) {
        const delayMs = Math.min(3000, this.progressiveDelayBaseMs * Math.pow(2, attempts - 2))
        await new Promise(resolve => setTimeout(resolve, delayMs))
      }
      if (locked) {
        const retryAfterSec = Math.max(1, Math.ceil(this.lockoutMs / 1000))
        throw new AuthHttpError(
          429,
          `登录失败次数过多，已触发安全锁定，请在 ${retryAfterSec} 秒后重试`,
          retryAfterSec
        )
      }
      throw new AuthHttpError(401, '管理员账号或密码错误')
    }

    this.clearFailures(ip, cleanName)
    found.lastLoginAt = new Date().toISOString()
    await this.persist()
    return this.issueSession(found)
  }

  passwordRequired(): boolean {
    return this.users.length > 0
  }

  enterLocalPasswordless(): { token: string; user: AdminUserRecord } {
    if (this.passwordRequired()) {
      throw new AuthHttpError(403, '已启用账密保护，请输入管理员账号与密码登录')
    }
    const localUser: AdminUserRecord = {
      username: 'zhixu',
      role: 'superadmin',
      createdAt: new Date().toISOString(),
      lastLoginAt: new Date().toISOString()
    }
    this.localPasswordlessActive = true
    this.desktopActiveUser = localUser.username
    const token = `zhixu_loc_${randomBytes(24).toString('hex')}`
    const now = Date.now()
    this.sessions.set(token, {
      token,
      username: localUser.username,
      createdAt: now,
      expiresAt: now + this.sessionTtlMs
    })
    return { token, user: localUser }
  }

  logout(token?: string): void {
    if (token) {
      this.sessions.delete(token)
    } else {
      this.desktopActiveUser = null
      this.localPasswordlessActive = false
    }
  }

  verifySessionToken(token: string | null | undefined, now = Date.now()): AdminUserRecord | null {
    if (!token) return null
    const session = this.sessions.get(token)
    if (!session) return null
    if (now > session.expiresAt) {
      this.sessions.delete(token)
      return null
    }
    const user = this.users.find(u => u.username === session.username)
    if (user) return this.toPublicUser(user)
    if (!this.passwordRequired() && token.startsWith('zhixu_loc_')) {
      return {
        username: session.username,
        role: 'superadmin',
        createdAt: new Date(session.createdAt).toISOString(),
        lastLoginAt: new Date(session.createdAt).toISOString()
      }
    }
    return null
  }

  getDesktopUser(): AdminUserRecord | null {
    if (!this.desktopActiveUser) return null
    const user = this.users.find(u => u.username === this.desktopActiveUser)
    if (user) return this.toPublicUser(user)
    if (this.localPasswordlessActive && !this.passwordRequired()) {
      return {
        username: this.desktopActiveUser,
        role: 'superadmin',
        createdAt: new Date().toISOString(),
        lastLoginAt: new Date().toISOString()
      }
    }
    return null
  }

  getState(activeUser: AdminUserRecord | null, serverAuthEnforced: boolean): AdminAuthState {
    return {
      authenticated: Boolean(activeUser),
      passwordRequired: this.passwordRequired(),
      needsSetup: this.needsSetup(),
      minPasswordLength: MIN_PASSWORD_LENGTH,
      user: activeUser,
      users: activeUser?.role === 'superadmin' ? this.users.map(u => this.toPublicUser(u)) : activeUser ? [activeUser] : [],
      serverAuthEnforced
    }
  }

  async changePassword(username: string, oldPassword: string, newPassword: string): Promise<void> {
    const found = this.users.find(u => u.username === username)
    if (!found) throw new AuthHttpError(404, '管理员账号不存在')
    if (!verifyPassword(oldPassword, found.salt, found.passwordHash)) {
      throw new AuthHttpError(401, '原密码不正确')
    }
    const strengthError = validatePasswordStrength(newPassword)
    if (strengthError) {
      throw new AuthHttpError(400, strengthError)
    }
    const salt = randomBytes(16).toString('hex')
    found.salt = salt
    found.passwordHash = hashPassword(newPassword, salt)
    await this.persist()
  }

  async createUser(operator: AdminUserRecord | null, username: string, password: string, role: AdminRole): Promise<AdminUserRecord> {
    if (!operator || operator.role !== 'superadmin') {
      throw new AuthHttpError(403, '仅超级管理员可创建后台账号')
    }
    const cleanName = username.trim()
    if (!/^[a-zA-Z0-9_-]{3,32}$/.test(cleanName)) {
      throw new AuthHttpError(400, '账号需为 3~32 位字母、数字、下划线或连字符')
    }
    const strengthError = validatePasswordStrength(password)
    if (strengthError) {
      throw new AuthHttpError(400, strengthError)
    }
    if (this.users.some(u => u.username === cleanName)) {
      throw new AuthHttpError(409, `账号 ${cleanName} 已存在`)
    }
    const salt = randomBytes(16).toString('hex')
    const created: StoredAdminUser = {
      username: cleanName,
      role: role === 'superadmin' ? 'superadmin' : 'reviewer',
      salt,
      passwordHash: hashPassword(password, salt),
      createdAt: new Date().toISOString(),
      lastLoginAt: null
    }
    this.users.push(created)
    await this.persist()
    return this.toPublicUser(created)
  }

  async deleteUser(operator: AdminUserRecord | null, username: string): Promise<void> {
    if (!operator || operator.role !== 'superadmin') {
      throw new AuthHttpError(403, '仅超级管理员可删除后台账号')
    }
    if (operator.username === username) {
      throw new AuthHttpError(400, '不能删除当前登录的管理员账号')
    }
    const idx = this.users.findIndex(u => u.username === username)
    if (idx < 0) throw new AuthHttpError(404, '找不到指定账号')
    this.users.splice(idx, 1)
    for (const [tok, sess] of this.sessions.entries()) {
      if (sess.username === username) this.sessions.delete(tok)
    }
    await this.persist()
  }
}

export function defaultAdminFilePath(dir: string): string {
  return path.join(dir, 'admin-users.json')
}
