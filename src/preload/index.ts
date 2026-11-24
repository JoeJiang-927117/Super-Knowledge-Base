import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { AdminRole, ProgressEvent, WorkspaceApi } from '../shared/types'

const api: WorkspaceApi = {
  windowControls: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('window:toggle-maximize'),
    close: () => ipcRenderer.invoke('window:close')
  },
  getSnapshot: () => ipcRenderer.invoke('workspace:snapshot'),
  selectWorkspace: () => ipcRenderer.invoke('workspace:select'),
  importDroppedFiles: (files: File[]) => {
    const paths = files.map(file => webUtils.getPathForFile(file)).filter(Boolean)
    return ipcRenderer.invoke('workspace:import-files', paths)
  },
  removeSource: file => ipcRenderer.invoke('workspace:remove-source', file),
  organize: () => ipcRenderer.invoke('workspace:organize'),
  cancelOrganize: () => ipcRenderer.invoke('workspace:cancel'),
  undoRun: runId => ipcRenderer.invoke('workspace:undo', runId),
  saveManualPage: input => ipcRenderer.invoke('workspace:save-page', input),
  publishPage: slug => ipcRenderer.invoke('workspace:publish-page', slug),
  publishAllDrafts: () => ipcRenderer.invoke('workspace:publish-all'),
  transitionWorkflow: (slug, action, note) => ipcRenderer.invoke('workspace:transition-workflow', slug, action, note),
  purgeDeletedPage: slug => ipcRenderer.invoke('workspace:purge-deleted', slug),
  listPageVersions: slug => ipcRenderer.invoke('workspace:list-versions', slug),
  rollbackPageVersion: (slug, versionLabel) => ipcRenderer.invoke('workspace:rollback-version', slug, versionLabel),
  getPageDiff: slug => ipcRenderer.invoke('workspace:page-diff', slug),
  runLint: () => ipcRenderer.invoke('workspace:lint'),
  fixLint: () => ipcRenderer.invoke('workspace:lint-fix'),
  getSchemaOverview: () => ipcRenderer.invoke('workspace:schema-overview'),
  searchKnowledge: (query, options) => ipcRenderer.invoke('workspace:search', query, options),
  askKnowledge: (question, options) => ipcRenderer.invoke('workspace:ask', question, options),
  submitFeedback: entry => ipcRenderer.invoke('workspace:feedback', entry),
  setModel: model => ipcRenderer.invoke('workspace:set-model', model),
  refreshModels: () => ipcRenderer.invoke('workspace:refresh-models'),
  openSource: file => ipcRenderer.invoke('workspace:open-source', file),
  adminLogin: (username: string, password: string) => ipcRenderer.invoke('admin:login', username, password),
  adminLogout: () => ipcRenderer.invoke('admin:logout'),
  adminChangePassword: (oldPassword: string, newPassword: string) =>
    ipcRenderer.invoke('admin:change-password', oldPassword, newPassword),
  adminCreateUser: (username: string, password: string, role: AdminRole) =>
    ipcRenderer.invoke('admin:create-user', username, password, role),
  adminDeleteUser: (username: string) => ipcRenderer.invoke('admin:delete-user', username),
  onProgress: listener => {
    const handler = (_event: Electron.IpcRendererEvent, progress: ProgressEvent) => listener(progress)
    ipcRenderer.on('workspace:progress', handler)
    return () => ipcRenderer.removeListener('workspace:progress', handler)
  }
}

contextBridge.exposeInMainWorld('localWiki', api)
