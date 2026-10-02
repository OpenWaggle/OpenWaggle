import { Schema, safeDecodeUnknown } from '@shared/schema'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { createRendererLogger } from '@/shared/lib/logger'
import {
  type ActionOutputRunSummary,
  type ActionOutputView,
  followReplacementRuns,
  MAX_FOLLOWED_ACTION_RUNS,
  withFollowedRun,
} from '../lib/action-output-view-model'
import { resolveTerminalStorage } from './terminal-store-persistence'

export const ACTION_OUTPUT_VIEW_STORAGE_KEY = 'openwaggle:terminal-action-output-views:v1'
const ACTION_OUTPUT_VIEW_PERSISTENCE_VERSION = 1
/** Views per owner; the oldest is dropped first. */
export const MAX_ACTION_OUTPUT_VIEWS_PER_OWNER = 12
/** Owners whose views survive a restart; least recently used owners are dropped first. */
export const MAX_ACTION_OUTPUT_VIEW_OWNERS = 32
const logger = createRendererLogger('action-output-views')

export interface OpenActionOutputViewInput {
  readonly ownerKey: string
  readonly projectPath: string
  readonly actionId: string
  readonly runId: string
  readonly label: string
}

/** The view covering the drawer, and the terminal tab that was active when it was chosen. */
interface ActiveActionOutputView {
  readonly actionId: string
  readonly coveredTabId: string | null
}

interface ActionOutputViewState {
  /** Views by owner key (Session id), in tab order. */
  readonly views: Readonly<Record<string, readonly ActionOutputView[]>>
  readonly active: Readonly<Record<string, ActiveActionOutputView>>
  /** Opens or focuses the one view for this action and owner; never starts a run. */
  open: (input: OpenActionOutputViewInput, coveredTabId: string | null) => ActionOutputView | null
  activate: (ownerKey: string, actionId: string, coveredTabId: string | null) => void
  /** Shows the owner's terminal tabs again, keeping every view open. */
  deactivate: (ownerKey: string) => void
  /** Closes only the view. The Project action run keeps running. */
  close: (ownerKey: string, actionId: string) => void
  /** Follows restarts reported by the owner's run list. */
  syncRuns: (ownerKey: string, runs: readonly ActionOutputRunSummary[]) => void
  removeOwner: (ownerKey: string) => void
}

const storedViewSchema = Schema.Struct({
  ownerKey: Schema.String.pipe(Schema.minLength(1)),
  projectPath: Schema.String.pipe(Schema.minLength(1)),
  actionId: Schema.String.pipe(Schema.minLength(1)),
  label: Schema.String,
  runIds: Schema.Array(Schema.String.pipe(Schema.minLength(1))).pipe(Schema.minItems(1)),
})

function sanitizeStoredViews(value: unknown): Record<string, readonly ActionOutputView[]> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {}
  const views: Record<string, readonly ActionOutputView[]> = {}
  for (const [ownerKey, candidates] of Object.entries(value).slice(
    -MAX_ACTION_OUTPUT_VIEW_OWNERS,
  )) {
    if (!Array.isArray(candidates)) continue
    const owned: ActionOutputView[] = []
    for (const candidate of candidates) {
      const decoded = safeDecodeUnknown(storedViewSchema, candidate)
      if (!decoded.success) {
        logger.warn('Dropped an unreadable action output view', {
          ownerKey,
          issues: decoded.issues,
        })
        continue
      }
      const view = decoded.data
      if (view.ownerKey !== ownerKey || owned.some((entry) => entry.actionId === view.actionId))
        continue
      owned.push({ ...view, runIds: view.runIds.slice(-MAX_FOLLOWED_ACTION_RUNS) })
    }
    if (owned.length > 0) views[ownerKey] = owned.slice(-MAX_ACTION_OUTPUT_VIEWS_PER_OWNER)
  }
  return views
}

/** Re-inserts an owner last so the least recently used owner is the first one dropped. */
function withOwnerViews(
  views: Readonly<Record<string, readonly ActionOutputView[]>>,
  ownerKey: string,
  owned: readonly ActionOutputView[],
) {
  const next = { ...views }
  delete next[ownerKey]
  if (owned.length > 0) next[ownerKey] = owned.slice(-MAX_ACTION_OUTPUT_VIEWS_PER_OWNER)
  const owners = Object.keys(next)
  for (const stale of owners.slice(0, Math.max(0, owners.length - MAX_ACTION_OUTPUT_VIEW_OWNERS)))
    delete next[stale]
  return next
}

function withoutActive(
  active: Readonly<Record<string, ActiveActionOutputView>>,
  ownerKey: string,
): Record<string, ActiveActionOutputView> {
  const next = { ...active }
  delete next[ownerKey]
  return next
}

export const useActionOutputViewStore = create<ActionOutputViewState>()(
  persist(
    (set, get) => ({
      views: {},
      active: {},
      open: (input, coveredTabId) => {
        if (input.ownerKey.length === 0 || input.actionId.length === 0 || input.runId.length === 0)
          return null
        const owned = get().views[input.ownerKey] ?? []
        const existing = owned.find((view) => view.actionId === input.actionId)
        const view: ActionOutputView = existing
          ? {
              ...existing,
              label: input.label,
              runIds: withFollowedRun(existing.runIds, input.runId),
            }
          : {
              ownerKey: input.ownerKey,
              projectPath: input.projectPath,
              actionId: input.actionId,
              label: input.label,
              runIds: [input.runId],
            }
        const nextOwned = existing
          ? owned.map((entry) => (entry === existing ? view : entry))
          : [...owned, view]
        set((state) => ({
          views: withOwnerViews(state.views, input.ownerKey, nextOwned),
          active: {
            ...state.active,
            [input.ownerKey]: { actionId: input.actionId, coveredTabId },
          },
        }))
        return view
      },
      activate: (ownerKey, actionId, coveredTabId) => {
        if (!get().views[ownerKey]?.some((view) => view.actionId === actionId)) return
        set((state) => ({ active: { ...state.active, [ownerKey]: { actionId, coveredTabId } } }))
      },
      deactivate: (ownerKey) => {
        if (get().active[ownerKey] === undefined) return
        set((state) => ({ active: withoutActive(state.active, ownerKey) }))
      },
      close: (ownerKey, actionId) => {
        const owned = get().views[ownerKey]
        if (!owned?.some((view) => view.actionId === actionId)) return
        set((state) => ({
          views: withOwnerViews(
            state.views,
            ownerKey,
            owned.filter((view) => view.actionId !== actionId),
          ),
          active:
            state.active[ownerKey]?.actionId === actionId
              ? withoutActive(state.active, ownerKey)
              : state.active,
        }))
      },
      syncRuns: (ownerKey, runs) => {
        const owned = get().views[ownerKey]
        if (owned === undefined || runs.length === 0) return
        let changed = false
        const nextOwned = owned.map((view) => {
          const runIds = followReplacementRuns(view, runs)
          if (runIds === view.runIds) return view
          changed = true
          return { ...view, runIds }
        })
        if (!changed) return
        set((state) => ({ views: { ...state.views, [ownerKey]: nextOwned } }))
      },
      removeOwner: (ownerKey) => {
        set((state) => {
          const views = { ...state.views }
          delete views[ownerKey]
          return { views, active: withoutActive(state.active, ownerKey) }
        })
      },
    }),
    {
      name: ACTION_OUTPUT_VIEW_STORAGE_KEY,
      version: ACTION_OUTPUT_VIEW_PERSISTENCE_VERSION,
      storage: createJSONStorage(resolveTerminalStorage),
      // Which view covered the drawer is a moment's choice; restored drawers show terminals.
      partialize: (state) => ({ views: state.views }),
      merge: (persisted, current) => ({
        ...current,
        views: sanitizeStoredViews(
          persisted !== null && typeof persisted === 'object'
            ? Reflect.get(persisted, 'views')
            : undefined,
        ),
      }),
    },
  ),
)

/** The view shown in an owner's drawer, while the terminal tab it covered is still selected. */
export function shownActionOutputView(
  state: Pick<ActionOutputViewState, 'views' | 'active'>,
  ownerKey: string,
  activeTabId: string | null,
): ActionOutputView | null {
  const active = state.active[ownerKey]
  if (active === undefined || active.coveredTabId !== activeTabId) return null
  return state.views[ownerKey]?.find((view) => view.actionId === active.actionId) ?? null
}

export function hasActionOutputViews(ownerKey: string) {
  return (useActionOutputViewStore.getState().views[ownerKey]?.length ?? 0) > 0
}
