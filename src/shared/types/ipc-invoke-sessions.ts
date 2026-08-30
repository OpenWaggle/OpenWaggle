import type { AgentAuthorizationMode } from './agent-authorization'
import type { SessionBranchId, SessionId, SessionNodeId } from './brand'
import type { SupportedModelId } from './llm'
import type {
  SessionCopyToNewResult,
  SessionDetail,
  SessionNavigateTreeOptions,
  SessionSummary,
  SessionTree,
  SessionTreeUiStatePatch,
  SessionWorkspace,
  SessionWorkspaceSelection,
  SessionWorktreePlan,
} from './session'

export interface IpcSessionInvokeChannelMap {
  'sessions:list-details': { args: [limit?: number]; return: SessionDetail[] }
  'sessions:get-detail': { args: [id: SessionId]; return: SessionDetail | null }
  'sessions:create': {
    args: [projectPath: string, worktreePlan?: SessionWorktreePlan]
    return: SessionDetail
  }
  'sessions:fork-to-new': {
    args: [sessionId: SessionId, model: SupportedModelId, targetNodeId: SessionNodeId]
    return: SessionCopyToNewResult
  }
  'sessions:clone-to-new': {
    args: [sessionId: SessionId, model: SupportedModelId, targetNodeId: SessionNodeId]
    return: SessionCopyToNewResult
  }
  'sessions:dismiss-interrupted-run': {
    args: [sessionId: SessionId, runId: string]
    return: undefined
  }
  'sessions:delete': { args: [id: SessionId]; return: undefined }
  'sessions:archive': { args: [id: SessionId]; return: undefined }
  'sessions:unarchive': { args: [id: SessionId]; return: undefined }
  'sessions:list-archived': { args: []; return: SessionSummary[] }
  'sessions:update-title': { args: [id: SessionId, title: string]; return: undefined }
  /** `null` clears the session override so the session inherits again. */
  'sessions:set-authorization-mode': {
    args: [id: SessionId, mode: AgentAuthorizationMode | null]
    return: undefined
  }
  'sessions:list': { args: [limit?: number]; return: SessionSummary[] }
  'sessions:list-archived-branches': { args: [limit?: number]; return: SessionSummary[] }
  'sessions:get-tree': { args: [sessionId: SessionId]; return: SessionTree | null }
  'sessions:get-workspace': {
    args: [sessionId: SessionId, selection?: SessionWorkspaceSelection]
    return: SessionWorkspace | null
  }
  'sessions:navigate-tree': {
    args: [
      sessionId: SessionId,
      model: SupportedModelId,
      targetNodeId: SessionNodeId,
      options?: SessionNavigateTreeOptions,
    ]
    return: { editorText?: string; cancelled: boolean }
  }
  'sessions:rename-branch': {
    args: [sessionId: SessionId, branchId: SessionBranchId, name: string]
    return: undefined
  }
  'sessions:archive-branch': {
    args: [sessionId: SessionId, branchId: SessionBranchId]
    return: undefined
  }
  'sessions:restore-branch': {
    args: [sessionId: SessionId, branchId: SessionBranchId]
    return: undefined
  }
  'sessions:update-tree-ui-state': {
    args: [sessionId: SessionId, patch: SessionTreeUiStatePatch]
    return: undefined
  }
}
