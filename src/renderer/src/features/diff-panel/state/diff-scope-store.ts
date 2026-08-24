import { create } from 'zustand'
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware'

/** Diff scope shown for a thread: branch-vs-base, working tree, or a single turn. */
export type DiffScopeSelection =
  | { readonly kind: 'branch'; readonly baseRef: string | null }
  | { readonly kind: 'unstaged' }
  | {
      readonly kind: 'turn'
      readonly turnId: string
      readonly filePath: string | null
      readonly revealRequestId: number
    }

/** A thread with no stored scope shows its working tree. */
const DEFAULT_SELECTION: DiffScopeSelection = { kind: 'unstaged' }

interface DiffScopeState {
  byThreadKey: Record<string, DiffScopeSelection>
  branchBaseRefByThreadKey: Record<string, string | null>
  selectGitScope: (threadKey: string, scope: 'branch' | 'unstaged') => void

  selectBranchBaseRef: (threadKey: string, baseRef: string | null) => void
  selectTurn: (threadKey: string, turnId: string, filePath?: string) => void
  reconcileTurnSelection: (threadKey: string, availableTurnIds: readonly string[]) => void
  removeThread: (threadKey: string) => void
}

function normalizeBaseRef(baseRef: string | null): string | null {
  const normalized = baseRef?.trim()
  return normalized ? normalized : null
}

/** Memory-backed storage so the store is safe to construct without a DOM (tests). */
function resolveStorage(): StateStorage {
  if (typeof window !== 'undefined' && window.localStorage) return window.localStorage
  const memory = new Map<string, string>()
  return {
    getItem: (key) => memory.get(key) ?? null,
    setItem: (key, value) => {
      memory.set(key, value)
    },
    removeItem: (key) => {
      memory.delete(key)
    },
  }
}

export const useDiffScopeStore = create<DiffScopeState>()(
  persist(
    (set) => ({
      byThreadKey: {},
      branchBaseRefByThreadKey: {},
      selectGitScope: (threadKey, scope) =>
        set((state) => {
          const previous = state.byThreadKey[threadKey]
          const previousBaseRef =
            previous?.kind === 'branch'
              ? previous.baseRef
              : (state.branchBaseRefByThreadKey[threadKey] ?? null)
          return {
            byThreadKey: {
              ...state.byThreadKey,
              [threadKey]:
                scope === 'branch'
                  ? { kind: 'branch', baseRef: previousBaseRef }
                  : { kind: 'unstaged' },
            },
            branchBaseRefByThreadKey:
              previous?.kind === 'branch'
                ? { ...state.branchBaseRefByThreadKey, [threadKey]: previous.baseRef }
                : state.branchBaseRefByThreadKey,
          }
        }),
      selectBranchBaseRef: (threadKey, baseRef) =>
        set((state) => {
          const normalized = normalizeBaseRef(baseRef)
          return {
            byThreadKey: {
              ...state.byThreadKey,
              [threadKey]: { kind: 'branch', baseRef: normalized },
            },
            branchBaseRefByThreadKey: {
              ...state.branchBaseRefByThreadKey,
              [threadKey]: normalized,
            },
          }
        }),
      selectTurn: (threadKey, turnId, filePath) =>
        set((state) => {
          const previous = state.byThreadKey[threadKey]
          return {
            byThreadKey: {
              ...state.byThreadKey,
              [threadKey]: {
                kind: 'turn',
                turnId,
                filePath: filePath?.trim() || null,
                revealRequestId: previous?.kind === 'turn' ? previous.revealRequestId + 1 : 1,
              },
            },
          }
        }),
      reconcileTurnSelection: (threadKey, availableTurnIds) =>
        set((state) => {
          const previous = state.byThreadKey[threadKey]
          const latestTurnId = availableTurnIds[0]
          if (
            previous?.kind !== 'turn' ||
            latestTurnId === undefined ||
            availableTurnIds.includes(previous.turnId)
          ) {
            return state
          }
          return {
            byThreadKey: {
              ...state.byThreadKey,
              [threadKey]: { ...previous, turnId: latestTurnId },
            },
          }
        }),
      removeThread: (threadKey) =>
        set((state) => {
          if (!(threadKey in state.byThreadKey) && !(threadKey in state.branchBaseRefByThreadKey)) {
            return state
          }
          const { [threadKey]: _removed, ...byThreadKey } = state.byThreadKey
          const { [threadKey]: _removedBaseRef, ...branchBaseRefByThreadKey } =
            state.branchBaseRefByThreadKey
          return { byThreadKey, branchBaseRefByThreadKey }
        }),
    }),
    {
      name: 'openwaggle:diff-scope:v1',
      version: 1,
      storage: createJSONStorage(resolveStorage),
      partialize: (state) => ({
        byThreadKey: state.byThreadKey,
        branchBaseRefByThreadKey: state.branchBaseRefByThreadKey,
      }),
    },
  ),
)

/** Resolve the effective diff scope for a thread, defaulting sensibly. */
export function selectThreadDiffScopeSelection(
  byThreadKey: Record<string, DiffScopeSelection>,
  threadKey: string | null | undefined,
): DiffScopeSelection {
  /*
   * One default: the working tree.
   *
   * There used to be a second, Branch, chosen by a `hasWorkingTreeChanges` argument - but the only
   * caller passed a hardcoded `true`, so no real thread could ever reach it while its unit tests
   * reported it working. Deriving the flag from the asynchronously loaded status would have been
   * worse than the dead branch: the scope would start as Branch, fire a branch diff, then flip to
   * the working tree once the status arrived. Removed rather than left as a false green.
   */
  return (threadKey ? byThreadKey[threadKey] : undefined) ?? DEFAULT_SELECTION
}
