/**
 * Admin Authentication & Account Management for 知序 ZHIXU.
 *
 * - Default seeded superadmin: `zhixu` / `123456789` (override via ZHIXU_ADMIN_USER / ZHIXU_ADMIN_PASSWORD)
 * - Passwords stored exclusively as salted scrypt hashes (never plaintext)
 * - Supports login, logout, session token verification, password change, and user CRUD
 */

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { AdminAuthState, AdminRole, AdminUserRecord } from '../shared/types'
import { atomicWriteText } from './safe-write'

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

const DEFAULT_ADMIN_USER = process.env.ZHIXU_ADMIN_USER?.trim() || 'zhixu'
const DEFAULT_ADMIN_PASS = process.env.ZHIXU_ADMIN_PASSWORD || '123456789'
const SESSION_TTL_MS = 24 * 60 * 60 * 1000

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

  constructor(private readonly filePath: string) {}

  async initialize(): Promise<void> {
    try {
      const raw = JSON.parse(await fs.readFile(this.filePath, 'utf8')) as StoredAdminFile
      if (Array.isArray(raw.users) && raw.users.length > 0) {
        this.users = raw.users
        return
      }
    } catch {
      // Seed default admin on first run.
    }
    const salt = randomBytes(16).toString('hex')
    this.users = [
      {
        username: DEFAULT_ADMIN_USER,
        role: 'superadmin',
        salt,
        passwordHash: hashPassword(DEFAULT_ADMIN_PASS, salt),
        createdAt: new Date().toISOString(),
        lastLoginAt: null
      }
    ]
    await this.persist()
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

  async login(username: string, password: string): Promise<{ token: string; user: AdminUserRecord }> {
    const cleanName = username.trim()
    const found = this.users.find(u => u.username === cleanName)
    if (!found || !verifyPassword(password, found.salt, found.passwordHash)) {
      throw new Error('管理员账号或密码错误')
    }
    found.lastLoginAt = new Date().toISOString()
    await this.persist()

    const token = `zhixu_adm_${randomBytes(24).toString('hex')}`
    const now = Date.now()
    this.sessions.set(token, {
      token,
      username: found.username,
      createdAt: now,
      expiresAt: now + SESSION_TTL_MS
    })
    this.desktopActiveUser = found.username
    return { token, user: this.toPublicUser(found) }
  }

  logout(token?: string): void {
    if (token) {
      this.sessions.delete(token)
    } else {
      this.desktopActiveUser = null
    }
  }

  verifySessionToken(token: string | null | undefined): AdminUserRecord | null {
    if (!token) return null
    const session = this.sessions.get(token)
    if (!session) return null
    if (Date.now() > session.expiresAt) {
      this.sessions.delete(token)
      return null
    }
    const user = this.users.find(u => u.username === session.username)
    return user ? this.toPublicUser(user) : null
  }

  getDesktopUser(): AdminUserRecord | null {
    if (!this.desktopActiveUser) return null
    const user = this.users.find(u => u.username === this.desktopActiveUser)
    return user ? this.toPublicUser(user) : null
  }

  getState(activeUser: AdminUserRecord | null, serverAuthEnforced: boolean): AdminAuthState {
    return {
      authenticated: Boolean(activeUser),
      user: activeUser,
      users: activeUser ? this.users.map(u => this.toPublicUser(u)) : [],
      serverAuthEnforced
    }
  }

  async changePassword(username: string, oldPassword: string, newPassword: string): Promise<void> {
    const found = this.users.find(u => u.username === username)
    if (!found) throw new Error('管理员账号不存在')
    if (!verifyPassword(oldPassword, found.salt, found.passwordHash)) {
      throw new Error('原密码不正确')
    }
    if (newPassword.length < 6) {
      throw new Error('新密码长度至少 6 位')
    }
    const salt = randomBytes(16).toString('hex')
    found.salt = salt
    found.passwordHash = hashPassword(newPassword, salt)
    await this.persist()
  }

  async createUser(operator: AdminUserRecord | null, username: string, password: string, role: AdminRole): Promise<AdminUserRecord> {
    if (!operator || operator.role !== 'superadmin') {
      throw new Error('仅超级管理员可创建后台账号')
    }
    const cleanName = username.trim()
    if (!/^[a-zA-Z0-9_-]{3,32}$/.test(cleanName)) {
      throw new Error('账号需为 3~32 位字母、数字、下划线或连字符')
    }
    if (password.length < 6) {
      throw new Error('密码长度至少 6 位')
    }
    if (this.users.some(u => u.username === cleanName)) {
      throw new Error(`账号 ${cleanName} 已存在`)
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
      throw new Error('仅超级管理员可删除后台账号')
    }
    if (operator.username === username) {
      throw new Error('不能删除当前登录的管理员账号')
    }
    const idx = this.users.findIndex(u => u.username === username)
    if (idx < 0) throw new Error('找不到指定账号')
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
