/**
 * localStorage persistence is the point of this suite, so it needs a DOM: the store
 * deliberately falls back to in-memory storage when `window` is absent.
 *
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_SESSION_SORT_MODE,
  isProjectExpanded,
  useSidebarViewStore,
} from '../sidebar-view-store'

const STORAGE_KEY = 'openwaggle:sidebar-view:v1'
/** Longer than the store's write delay, so a drain always completes. */
const WRITE_DRAIN_MS = 600
const PROJECT_A = '/Users/dev/alpha'
const PROJECT_B = '/Users/dev/beta'

/** Field names the store actually wrote, read without asserting the payload's shape. */
function persistedStateKeys(): readonly string[] {
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (raw === null) return []
  const parsed: unknown = JSON.parse(raw)
  if (parsed === null || typeof parsed !== 'object') return []
  const state: unknown = Reflect.get(parsed, 'state')
  if (state === null || typeof state !== 'object') return []
  return Object.keys(state).sort()
}

/** Reload from storage the way a relaunch does. */
async function relaunch() {
  await useSidebarViewStore.persist.rehydrate()
}

/**
 * Fake timers for the whole suite, because the store defers writes. Resetting state also
 * schedules a write, so each test drains that pending write and clears storage before it
 * starts. Without the drain, the queued reset shadows every later read.
 */
describe('sidebar view store', () => {
  beforeEach(async () => {
    vi.useFakeTimers()
    useSidebarViewStore.setState({
      sessionSortMode: DEFAULT_SESSION_SORT_MODE,
      projectExpandedByPath: {},
    })
    await vi.advanceTimersByTimeAsync(WRITE_DRAIN_MS)
    window.localStorage.clear()
  })

  /**
   * Drain before handing timers back. Switching to real timers discards a pending fake
   * timer while the store still believes a write is scheduled, and it then never schedules
   * another, so every later test in the file would see no writes at all.
   */
  afterEach(async () => {
    await vi.runOnlyPendingTimersAsync()
    vi.useRealTimers()
  })

  it('treats an unseen project as expanded', () => {
    expect(isProjectExpanded({}, PROJECT_A)).toBe(true)
    expect(isProjectExpanded({ [PROJECT_A]: false }, PROJECT_A)).toBe(false)
  })

  it('toggles a project and remembers it', () => {
    useSidebarViewStore.getState().toggleProjectExpanded(PROJECT_A)

    expect(isProjectExpanded(useSidebarViewStore.getState().projectExpandedByPath, PROJECT_A)).toBe(
      false,
    )
  })

  /**
   * The bug this store exists to fix: collapsing nine projects to focus on one was work,
   * and a restart threw it away.
   *
   * A relaunch is a fresh process, so the pending write queue starts empty. The test
   * captures what the previous run left on disk and restores that before rehydrating,
   * because reading through the live store would return its own queued writes.
   */
  it('restores sort mode and collapsed projects after a relaunch', async () => {
    useSidebarViewStore.getState().setSessionSortMode('name')
    useSidebarViewStore.getState().setProjectExpanded(PROJECT_A, false)
    await vi.advanceTimersByTimeAsync(WRITE_DRAIN_MS)
    const onDisk = window.localStorage.getItem(STORAGE_KEY)

    useSidebarViewStore.setState({
      sessionSortMode: DEFAULT_SESSION_SORT_MODE,
      projectExpandedByPath: {},
    })
    await vi.advanceTimersByTimeAsync(WRITE_DRAIN_MS)
    window.localStorage.setItem(STORAGE_KEY, onDisk ?? '')
    await relaunch()

    const state = useSidebarViewStore.getState()
    expect(state.sessionSortMode).toBe('name')
    expect(isProjectExpanded(state.projectExpandedByPath, PROJECT_A)).toBe(false)
    expect(isProjectExpanded(state.projectExpandedByPath, PROJECT_B)).toBe(true)
  })

  /**
   * localStorage.setItem is synchronous, so writing per click puts JSON serialising in the
   * interaction path. Four quick collapses must cost one write.
   */
  it('coalesces rapid changes into a single write', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')

    const store = useSidebarViewStore.getState()
    store.setProjectExpanded(PROJECT_A, false)
    store.setProjectExpanded(PROJECT_B, false)
    store.setSessionSortMode('oldest')

    expect(setItem).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(WRITE_DRAIN_MS)
    expect(setItem).toHaveBeenCalledTimes(1)

    setItem.mockRestore()
  })

  /**
   * zustand's persist middleware writes after every `setState`, including calls where the
   * mutator returned the identical object. Comparing the serialised payload in the storage
   * wrapper is what makes an unchanged click cost nothing.
   */
  it('does not write when a mutation changes nothing', async () => {
    await vi.advanceTimersByTimeAsync(WRITE_DRAIN_MS)
    const setItem = vi.spyOn(Storage.prototype, 'setItem')

    useSidebarViewStore.getState().setSessionSortMode(DEFAULT_SESSION_SORT_MODE)
    useSidebarViewStore.getState().setProjectExpanded(PROJECT_A, true)
    await vi.advanceTimersByTimeAsync(WRITE_DRAIN_MS)

    expect(setItem).not.toHaveBeenCalled()
    setItem.mockRestore()
  })

  it('keeps state identity stable for a no-op mutation', () => {
    const before = useSidebarViewStore.getState().projectExpandedByPath
    useSidebarViewStore.getState().setProjectExpanded(PROJECT_A, true)

    expect(useSidebarViewStore.getState().projectExpandedByPath).toBe(before)
  })

  it('falls back to defaults when the payload is malformed', async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        state: { sessionSortMode: 'sideways', projectExpandedByPath: 'not-an-object' },
        version: 1,
      }),
    )

    await relaunch()

    const state = useSidebarViewStore.getState()
    expect(state.sessionSortMode).toBe(DEFAULT_SESSION_SORT_MODE)
    expect(state.projectExpandedByPath).toEqual({})
  })

  it('drops corrupt entries without discarding sound ones', async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        state: {
          sessionSortMode: 'oldest',
          projectExpandedByPath: { [PROJECT_A]: false, [PROJECT_B]: 'yes', '': true },
        },
        version: 1,
      }),
    )

    await relaunch()

    const state = useSidebarViewStore.getState()
    expect(state.sessionSortMode).toBe('oldest')
    expect(state.projectExpandedByPath).toEqual({ [PROJECT_A]: false })
  })

  it('survives unreadable storage rather than blocking the sidebar', async () => {
    window.localStorage.setItem(STORAGE_KEY, '{ not json')

    await relaunch()

    expect(useSidebarViewStore.getState().sessionSortMode).toBe(DEFAULT_SESSION_SORT_MODE)
  })

  it('forgets a removed project instead of leaving a dangling entry', () => {
    useSidebarViewStore.getState().setProjectExpanded(PROJECT_A, false)
    useSidebarViewStore.getState().forgetProject(PROJECT_A)

    expect(useSidebarViewStore.getState().projectExpandedByPath).toEqual({})
  })

  it('persists only the whitelisted fields', async () => {
    useSidebarViewStore.getState().setSessionSortMode('name')
    await vi.advanceTimersByTimeAsync(WRITE_DRAIN_MS)

    expect(persistedStateKeys()).toEqual(['projectExpandedByPath', 'sessionSortMode'])
  })
})
