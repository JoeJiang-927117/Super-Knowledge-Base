import type { DeploymentMode, OrganizeRun, SearchHit, StorageDomain, WikiLintReport, WikiPage, WorkflowAction, WorkspaceSnapshot } from '../../shared/types'

export const dateFormatter = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' })

export function folderName(root: string): string {
  return root.split(/[\\/]/).filter(Boolean).pop() ?? root
}

export function deploymentModeLabel(mode: DeploymentMode): string {
  return { cloud: '外部 API', lan_gpu: '局域网 GPU', local: '本机 Ollama' }[mode] ?? '外部 API'
}

export function providerLabel(provider: WorkspaceSnapshot['modelProvider']): string {
  return `${deploymentModeLabel(provider.mode ?? 'cloud')} · ${provider.provider === 'ollama' ? 'Ollama' : 'OpenAI-API'}`
}

export function storageDomainLabel(domain: StorageDomain): string {
  return { permissions: '权限', foundation: '基础', cases: '案例', concrete_media: '图像与实体', domain_knowledge: '专业知识', versions: '版本' }[domain] ?? domain
}

export function workflowStatusLabel(status: WikiPage['status']): string {
  return {
    draft: '待审核',
    moderating: '初审中',
    validating: '终审中',
    published: '已发布',
    archived: '已归档',
    pending_delete: '待删审批',
    deleted: '回收站'
  }[status] ?? status
}

export function workflowActionLabel(action: WorkflowAction): string {
  return {
    submit_moderation: '提交初审',
    refuse_moderation: '退回草稿',
    submit_validation: '提交终审',
    refuse_validation: '驳回草稿',
    publish: '审批发布',
    unpublish: '撤回草稿',
    archive: '已归档',
    publish_from_archive: '恢复发布',
    confirm_delete: '确认移入回收站',
    reject_delete: '驳回删除',
    restore_deleted: '从回收站恢复'
  }[action]
}

export function actionName(action: OrganizeRun['changes'][number]['action']): string {
  return { create: '新建', update: '更新', delete: '建议删除' }[action]
}

export function evidenceLevelLabel(level: WikiPage['evidenceLevel']): string {
  return { official_doc: '正式文档', operational_doc: '规程文档', synthesis_draft: '综合整理', field_record: '实测记录' }[level] ?? level
}

export function statusLabel(status: SearchHit['status']): string {
  return {
    published: '已发布',
    draft: '草稿',
    moderating: '初审中',
    validating: '终审中',
    archived: '已归档',
    pending_delete: '待删审批',
    deleted: '回收站',
    raw: '原始资料'
  }[status] ?? status
}

export function severityLabel(severity: WikiLintReport['issues'][number]['severity']): string {
  return { error: '高危', warning: '警告', info: '提示' }[severity]
}

export function lintCategoryLabel(cat: WikiLintReport['issues'][number]['category']): string {
  return {
    orphan: '孤立页',
    no_sources: '缺少来源',
    broken_link: '失效链接',
    draft_backlog: '待审核流程',
    stale_source: '来源已变更',
    duplicate_title: '疑似重复',
    schema_violation: 'Schema 约束'
  }[cat]
}
