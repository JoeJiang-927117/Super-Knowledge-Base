/**
 * Zhixu Declarative Knowledge Governance State Machine (v2).
 *
 * Table-driven finite state machine governing publication, revision, archiving,
 * deletion approval (`pending_delete`), and recycle-bin recovery (`deleted`).
 */

import type { WikiPageStatus, WorkflowAction } from '../shared/types'

export const WORKFLOW_STATUS_LABELS: Record<WikiPageStatus, string> = {
  draft: '草稿待审',
  moderating: '初审中',
  validating: '终审核验',
  published: '已发布',
  archived: '已归档',
  pending_delete: '待删审批',
  deleted: '回收站'
}

export const WORKFLOW_ACTION_LABELS: Record<WorkflowAction, string> = {
  submit_moderation: '提交初审',
  refuse_moderation: '退回草稿',
  submit_validation: '提交终审',
  refuse_validation: '驳回草稿',
  publish: '审批发布',
  unpublish: '撤回为草稿',
  archive: '归档',
  publish_from_archive: '从归档恢复发布',
  confirm_delete: '确认移入回收站',
  reject_delete: '驳回删除并保留',
  restore_deleted: '从回收站恢复'
}

export type WorkflowTransitionResult = {
  nextStatus: WikiPageStatus
  updatesPublishedBaseline: boolean
  clearsPublishedBaseline?: boolean
  createsVersionStatus: 'candidate' | 'published' | 'archived' | null
  gitPrefix: string
}

type TransitionRule = {
  allowedFrom: readonly WikiPageStatus[]
  resolve: (hasPublishedBaseline: boolean) => WorkflowTransitionResult
}

const TRANSITION_MATRIX: Record<WorkflowAction, TransitionRule> = {
  submit_moderation: {
    allowedFrom: ['draft'],
    resolve: () => ({
      nextStatus: 'moderating',
      updatesPublishedBaseline: false,
      createsVersionStatus: 'candidate',
      gitPrefix: 'moderate'
    })
  },
  refuse_moderation: {
    allowedFrom: ['moderating'],
    resolve: () => ({
      nextStatus: 'draft',
      updatesPublishedBaseline: false,
      createsVersionStatus: null,
      gitPrefix: 'refuse-moderation'
    })
  },
  submit_validation: {
    allowedFrom: ['draft', 'moderating'],
    resolve: () => ({
      nextStatus: 'validating',
      updatesPublishedBaseline: false,
      createsVersionStatus: 'candidate',
      gitPrefix: 'validate'
    })
  },
  refuse_validation: {
    allowedFrom: ['validating'],
    resolve: () => ({
      nextStatus: 'draft',
      updatesPublishedBaseline: false,
      createsVersionStatus: null,
      gitPrefix: 'refuse-validation'
    })
  },
  publish: {
    allowedFrom: ['draft', 'moderating', 'validating'],
    resolve: () => ({
      nextStatus: 'published',
      updatesPublishedBaseline: true,
      createsVersionStatus: 'published',
      gitPrefix: 'publish'
    })
  },
  unpublish: {
    allowedFrom: ['published'],
    resolve: () => ({
      nextStatus: 'draft',
      updatesPublishedBaseline: false,
      createsVersionStatus: null,
      gitPrefix: 'unpublish'
    })
  },
  archive: {
    allowedFrom: ['published'],
    resolve: () => ({
      nextStatus: 'archived',
      updatesPublishedBaseline: false,
      createsVersionStatus: 'archived',
      gitPrefix: 'archive'
    })
  },
  publish_from_archive: {
    allowedFrom: ['archived'],
    resolve: () => ({
      nextStatus: 'published',
      updatesPublishedBaseline: true,
      createsVersionStatus: 'published',
      gitPrefix: 'restore-archive'
    })
  },
  confirm_delete: {
    allowedFrom: ['draft', 'moderating', 'validating', 'published', 'archived', 'pending_delete'],
    resolve: () => ({
      nextStatus: 'deleted',
      updatesPublishedBaseline: false,
      clearsPublishedBaseline: true,
      createsVersionStatus: 'archived',
      gitPrefix: 'trash'
    })
  },
  reject_delete: {
    allowedFrom: ['pending_delete'],
    resolve: hasPublishedBaseline => ({
      nextStatus: hasPublishedBaseline ? 'published' : 'draft',
      updatesPublishedBaseline: hasPublishedBaseline,
      createsVersionStatus: null,
      gitPrefix: 'reject-delete'
    })
  },
  restore_deleted: {
    allowedFrom: ['deleted'],
    resolve: () => ({
      nextStatus: 'draft',
      updatesPublishedBaseline: false,
      createsVersionStatus: 'candidate',
      gitPrefix: 'restore-trash'
    })
  }
}

export function getAllowedWorkflowActions(status: WikiPageStatus): WorkflowAction[] {
  return (Object.keys(TRANSITION_MATRIX) as WorkflowAction[]).filter(action =>
    TRANSITION_MATRIX[action].allowedFrom.includes(status)
  )
}

export function resolveWorkflowTransition(
  currentStatus: WikiPageStatus,
  action: WorkflowAction,
  hasPublishedBaseline = false
): WorkflowTransitionResult {
  const rule = TRANSITION_MATRIX[action]
  if (!rule || !rule.allowedFrom.includes(currentStatus)) {
    throw new Error(`当前状态「${WORKFLOW_STATUS_LABELS[currentStatus]}」不支持「${WORKFLOW_ACTION_LABELS[action]}」`)
  }
  return rule.resolve(hasPublishedBaseline)
}

export function nextSemanticVersion(
  existingLabels: string[],
  kind: 'candidate' | 'published' | 'archived',
  majorBump = false
): string {
  if (!existingLabels.length) return kind === 'published' ? 'V1.0' : 'V0.1'
  let maxMajor = 0
  let maxMinor = 0
  for (const label of existingLabels) {
    const match = /^V(\d+)\.(\d+)/i.exec(label.trim())
    if (!match) continue
    const major = Number(match[1])
    const minor = Number(match[2])
    if (major > maxMajor || (major === maxMajor && minor > maxMinor)) {
      maxMajor = major
      maxMinor = minor
    }
  }
  if (kind === 'published') {
    if (maxMajor === 0) return 'V1.0'
    if (majorBump) return `V${maxMajor + 1}.0`
    return `V${maxMajor}.${maxMinor + 1}`
  }
  return `V${maxMajor}.${maxMinor + 1}`
}
