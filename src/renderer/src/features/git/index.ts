export { ComposerContextStrip } from './components/ComposerContextStrip'
export { GitQuickActionButton } from './components/GitQuickActionButton'
export { useCombinedVcsStatus } from './hooks/useCombinedVcsStatus'
export {
  type ComposerContextStripState,
  useComposerContextStrip,
} from './hooks/useComposerContextStrip'
export { useStackedGitActions } from './hooks/useStackedGitActions'
export {
  buildMenuItems,
  type GitActionMenuItem,
  type GitQuickAction,
  resolveQuickAction,
} from './lib/git-quick-action'
export {
  resolveDefaultWorktreeBaseRef,
  resolveWorktreeSendPlan,
  WORKTREE_BASE_REF_REQUIRED,
  type WorktreeSendPlan,
} from './lib/worktree-send-plan'
export { useGitStore } from './state'
