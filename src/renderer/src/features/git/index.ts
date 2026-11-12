// Components stay out of this root index: the eager shell imports it for hooks, state and
// helpers, and re-exporting components here pulled them into the initial renderer graph
// (renderer-load B8). Import components from `@/features/git/components`. Only the light Session
// context row the New session composer renders is exported here.
export { SessionContextRow } from './components/SessionContextRow'
export { useCombinedVcsStatus } from './hooks/useCombinedVcsStatus'
export { useDraftPreparationProfile } from './hooks/useDraftPreparationProfile'
export { type SessionContextRowState, useSessionContextRow } from './hooks/useSessionContextRow'
export { useStackedGitActions } from './hooks/useStackedGitActions'
export { invalidateVcsStatus } from './lib/vcs-status-invalidation'
export { WORKTREE_MISSING_REASON } from './lib/worktree-send-plan'
export { selectWorkingTreeStatus, useGitStore } from './state'
export { snapshotDraftWorktreePlan, stashDraftWorktreePlan } from './state/worktree-plan-draft'
