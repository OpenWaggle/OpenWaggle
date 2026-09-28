import { safeDecodeUnknown } from '@shared/schema'
import type {
  ActionCatalog,
  CommandRepairProposal,
  PreparationDefinition,
} from '@shared/types/action-definitions'
import type { ActionManagementScope } from '@shared/types/action-management'
import { create } from 'zustand'
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware'
import { createRendererLogger } from '@/shared/lib/logger'
import { useRightSidebarCoordinator } from '@/shared/lib/right-sidebar-coordinator'
import { type ActionPanelDraft, actionPanelDraftSchema } from '../lib/action-panel-drafts'

export const ACTION_PANEL_STORAGE_KEY = 'openwaggle:action-panel:v1'
const MAX_REMEMBERED_SCRIPT_COMMANDS = 500
const RECENTLY_SAVED_MS = 2_500
const logger = createRendererLogger('action-panel')

export type ActionPanelOrigin = 'session' | 'settings'

export interface PreparationReviewRequest {
  readonly entry: ActionCatalog['preparation'][number]
  readonly profileName: string
  /** Name the profile only when a project has more than one (ADR 0038). */
  readonly showProfile: boolean
  /** Opened because worktree creation or removal is waiting on this review. */
  readonly automatic: boolean
  readonly decide: (enabled: boolean) => Promise<unknown>
}

export type ActionPanelRequest =
  | {
      readonly kind: 'action'
      readonly scope: ActionManagementScope
      /** The saved action to edit; null adds a new one. */
      readonly actionId: string | null
      readonly origin: ActionPanelOrigin
      readonly proposal?: CommandRepairProposal
    }
  | {
      readonly kind: 'preparation'
      readonly scope: ActionManagementScope
      readonly phase: PreparationDefinition['phase']
      readonly profileId: string
      readonly origin: ActionPanelOrigin
    }
  | {
      readonly kind: 'review'
      readonly projectPath: string
      readonly review: PreparationReviewRequest
    }

export function actionPanelRequestProject(request: ActionPanelRequest) {
  return request.kind === 'review' ? request.projectPath : request.scope.projectPath
}

interface ActionPanelState {
  readonly request: ActionPanelRequest | null
  /** One Project action draft per project path. */
  readonly drafts: Readonly<Record<string, ActionPanelDraft>>
  /** The last command seen for each linked script, for "Use the last known command instead". */
  readonly lastSeenScriptCommands: Readonly<Record<string, string>>
  /** Briefly highlights what was just saved from Settings, so the user sees where it went. */
  readonly recentlySaved: { readonly projectPath: string; readonly id: string } | null
  markSaved: (projectPath: string, id: string) => void
  openPanel: (request: ActionPanelRequest) => void
  /** Closes the panel and gives the right side back to the sidebar it replaced. */
  closePanel: () => void
  /** Another sidebar took the right side: forget the request and keep any draft. */
  forgetRequest: () => void
  setDraft: (projectPath: string, draft: ActionPanelDraft) => void
  discardDraft: (projectPath: string) => void
  rememberScriptCommand: (scriptKey: string, command: string) => void
}

const memoryStorage = new Map<string, string>()
function resolveStorage(): StateStorage {
  if (typeof window !== 'undefined' && window.localStorage) return window.localStorage
  return {
    getItem: (key) => memoryStorage.get(key) ?? null,
    setItem: (key, value) => {
      memoryStorage.set(key, value)
    },
    removeItem: (key) => {
      memoryStorage.delete(key)
    },
  }
}

function sanitizeDrafts(value: unknown): Record<string, ActionPanelDraft> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {}
  const drafts: Record<string, ActionPanelDraft> = {}
  for (const [projectPath, candidate] of Object.entries(value)) {
    const decoded = safeDecodeUnknown(actionPanelDraftSchema, candidate)
    if (decoded.success) drafts[projectPath] = decoded.data
    else logger.warn('Dropped an unreadable action draft', { projectPath, issues: decoded.issues })
  }
  return drafts
}

function sanitizeScriptCommands(value: unknown): Record<string, string> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
      .slice(-MAX_REMEMBERED_SCRIPT_COMMANDS),
  )
}

export const useActionPanelStore = create<ActionPanelState>()(
  persist(
    (set, get) => ({
      request: null,
      drafts: {},
      lastSeenScriptCommands: {},
      recentlySaved: null,
      markSaved: (projectPath, id) => {
        set({ recentlySaved: { projectPath, id } })
        setTimeout(() => {
          if (get().recentlySaved?.id === id) set({ recentlySaved: null })
        }, RECENTLY_SAVED_MS)
      },
      openPanel: (request) => {
        useRightSidebarCoordinator.getState().claimActionPanel()
        set({ request })
      },
      closePanel: () => {
        set({ request: null })
        useRightSidebarCoordinator.getState().releaseActionPanel()
      },
      forgetRequest: () => set({ request: null }),
      setDraft: (projectPath, draft) => set({ drafts: { ...get().drafts, [projectPath]: draft } }),
      discardDraft: (projectPath) => {
        const drafts = { ...get().drafts }
        delete drafts[projectPath]
        set({ drafts })
      },
      rememberScriptCommand: (scriptKey, command) => {
        if (!command || get().lastSeenScriptCommands[scriptKey] === command) return
        const next = { ...get().lastSeenScriptCommands, [scriptKey]: command }
        set({ lastSeenScriptCommands: sanitizeScriptCommands(next) })
      },
    }),
    {
      name: ACTION_PANEL_STORAGE_KEY,
      storage: createJSONStorage(resolveStorage),
      partialize: (state) => ({
        drafts: state.drafts,
        lastSeenScriptCommands: state.lastSeenScriptCommands,
      }),
      merge: (persisted, current) => ({
        ...current,
        drafts: sanitizeDrafts(
          persisted !== null && typeof persisted === 'object'
            ? Reflect.get(persisted, 'drafts')
            : undefined,
        ),
        lastSeenScriptCommands: sanitizeScriptCommands(
          persisted !== null && typeof persisted === 'object'
            ? Reflect.get(persisted, 'lastSeenScriptCommands')
            : undefined,
        ),
      }),
    },
  ),
)
