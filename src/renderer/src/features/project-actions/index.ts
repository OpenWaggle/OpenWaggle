// Heavy components stay out of this root index: the eager shell imports it for hooks, state and
// helpers, and re-exporting the settings, surfaces and editors here pulled them into the initial
// renderer graph (renderer-load B8). Import them from `@/features/project-actions/components`.
// Only light pieces are exported here: the always-mounted shell layout and effects, the
// composer's preparation choice, and the transcript's repair proposal card.

export { ActionPanelLayout } from './components/action-panel/ActionPanelLayout'
export {
  CommandRepairProposalCard,
  commandRepairProposalFrom,
} from './components/action-panel/CommandRepairProposalCard'
export { ProjectActionsBackgroundEffects } from './components/ProjectActionsBackgroundEffects'
export { WorktreePreparationChoice } from './components/WorktreePreparationChoice'
export { useHasActiveProjectActionRun } from './hooks/useHasActiveProjectActionRun'
export { useActionRuns, useActionScope, useNativeActions } from './hooks/useNativeActions'
export { useProjectActionShortcutCapture } from './hooks/useProjectActionShortcutCapture'
export {
  projectActionsQueryOptions,
  useProjectActionMutations,
  useProjectActions,
} from './hooks/useProjectActions'
export { useRunProjectAction } from './hooks/useRunProjectAction'
export { useWorkspaceActivityAvailable } from './hooks/useWorkspaceActivityAvailable'
export { actionRunLabel } from './lib/native-action-display'
export {
  selectDraftWorkspacePreparation,
  validateDraftWorkspacePreparation,
} from './lib/prepare-draft-workspace'
export { createProjectActionCommandItems } from './lib/project-action-command-items'
export {
  primaryProjectAction,
  projectActionHasShortcutConflicts,
  projectActionShortcutConflictLabels,
  projectActionShortcutSummary,
  projectActionUnknownWhenVariables,
} from './lib/project-action-model'
export { useProjectActionStore } from './state/project-action-store'
