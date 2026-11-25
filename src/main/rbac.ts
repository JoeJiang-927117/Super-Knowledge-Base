/**
 * Declarative Server-Side RBAC Permission Matrix for 知序 ZHIXU.
 *
 * - `reviewer`: read, search, Q&A, draft editing, review transitions, and publishing.
 * - `superadmin`: all reviewer capabilities plus high-risk operations
 *   (account management, model settings, source upload/deletion, compile/undo/lint-fix,
 *   version rollback, recycle bin confirmation/restore, and permanent purge).
 */

import type { AdminRole, WorkflowAction } from '../shared/types'

export type PermissionAction =
  | 'read'
  | 'search'
  | 'edit_draft'
  | 'review'
  | 'manage_sources'
  | 'manage_organize'
  | 'manage_models'
  | 'manage_versions_high_risk'
  | 'manage_accounts'

export const ROLE_PERMISSIONS: Record<AdminRole, ReadonlySet<PermissionAction>> = {
  reviewer: new Set<PermissionAction>(['read', 'search', 'edit_draft', 'review']),
  superadmin: new Set<PermissionAction>([
    'read',
    'search',
    'edit_draft',
    'review',
    'manage_sources',
    'manage_organize',
    'manage_models',
    'manage_versions_high_risk',
    'manage_accounts'
  ])
}

const SUPERADMIN_ONLY_WORKFLOW_ACTIONS = new Set<WorkflowAction>(['confirm_delete', 'restore_deleted'])

export class ForbiddenError extends Error {
  readonly statusCode = 403
  constructor(message: string) {
    super(message)
    this.name = 'ForbiddenError'
  }
}

export function permissionForWorkflowAction(action: WorkflowAction): PermissionAction {
  return SUPERADMIN_ONLY_WORKFLOW_ACTIONS.has(action) ? 'manage_versions_high_risk' : 'review'
}

export function hasPermission(role: AdminRole | null | undefined, action: PermissionAction): boolean {
  if (!role) return false
  return ROLE_PERMISSIONS[role]?.has(action) ?? false
}

export function assertPermission(
  role: AdminRole | null | undefined,
  action: PermissionAction,
  contextLabel?: string
): void {
  if (hasPermission(role, action)) return
  const detail = contextLabel ? `（${contextLabel}）` : ''
  throw new ForbiddenError(`权限不足：当前角色无权执行该操作${detail}，需超级管理员（superadmin）权限`)
}
