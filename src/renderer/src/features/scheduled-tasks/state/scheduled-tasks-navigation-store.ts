import type { ScheduledTaskKind } from '@shared/types/scheduled-task'
import { create } from 'zustand'

/** What a new task opened from somewhere starts with. */
export interface ScheduledTaskNewDefaults {
  readonly kind?: ScheduledTaskKind
  readonly sessionId?: string
  readonly projectPath?: string
}

/**
 * Where a Scheduled tasks container is: its list, one task's detail, or the editor in place of
 * the detail. The Right panel and the Settings tab each keep one (CONTEXT.md, Scheduled tasks).
 */
export type ScheduledTasksView =
  | { readonly kind: 'list' }
  | { readonly kind: 'task'; readonly taskId: string }
  | { readonly kind: 'edit'; readonly taskId: string }
  | { readonly kind: 'new'; readonly defaults: ScheduledTaskNewDefaults }

export type ScheduledTasksContainer = 'panel' | 'settings'

interface ScheduledTasksNavigationState {
  readonly panel: ScheduledTasksView
  readonly settings: ScheduledTasksView
  readonly show: (container: ScheduledTasksContainer, view: ScheduledTasksView) => void
}

const LIST: ScheduledTasksView = { kind: 'list' }

export const useScheduledTasksNavigationStore = create<ScheduledTasksNavigationState>((set) => ({
  panel: LIST,
  settings: LIST,
  show: (container, view) => set({ [container]: view }),
}))

export function showScheduledTasksView(
  container: ScheduledTasksContainer,
  view: ScheduledTasksView,
) {
  useScheduledTasksNavigationStore.getState().show(container, view)
}
