interface ProfileBackgroundWork {
  readonly controller?: AbortController
}

interface ProfileBackgroundWorkState {
  fenced: boolean
  readonly active: Set<ProfileBackgroundWork>
  readonly drainWaiters: Set<() => void>
}

export interface LocalSessionProfileBackgroundWorkLease {
  readonly signal?: AbortSignal
  readonly release: () => void
}

const profileWork = new Map<string, ProfileBackgroundWorkState>()

function stateFor(profileId: string) {
  const existing = profileWork.get(profileId)
  if (existing) return existing
  const created: ProfileBackgroundWorkState = {
    fenced: false,
    active: new Set(),
    drainWaiters: new Set(),
  }
  profileWork.set(profileId, created)
  return created
}

function finishDrain(profileId: string, state: ProfileBackgroundWorkState) {
  if (state.active.size !== 0) return
  for (const resolve of state.drainWaiters) resolve()
  state.drainWaiters.clear()
  if (!state.fenced && profileWork.get(profileId) === state) profileWork.delete(profileId)
}

export function acquireLocalSessionProfileBackgroundWork(
  profileId: string,
  options: { readonly cancelOnFence: boolean },
): LocalSessionProfileBackgroundWorkLease | undefined {
  const state = stateFor(profileId)
  if (state.fenced) return undefined
  const work: ProfileBackgroundWork = options.cancelOnFence
    ? { controller: new AbortController() }
    : {}
  state.active.add(work)
  let released = false
  return {
    ...(work.controller ? { signal: work.controller.signal } : {}),
    release: () => {
      if (released) return
      released = true
      state.active.delete(work)
      finishDrain(profileId, state)
    },
  }
}

export async function fenceLocalSessionProfileBackgroundWork(profileId: string) {
  const state = stateFor(profileId)
  state.fenced = true
  for (const work of state.active) work.controller?.abort(new Error('Profile authority changed.'))
  if (state.active.size === 0) return
  await new Promise<void>((resolve) => state.drainWaiters.add(resolve))
}

export function releaseLocalSessionProfileBackgroundWorkFence(profileId: string) {
  const state = profileWork.get(profileId)
  if (!state) return
  state.fenced = false
  finishDrain(profileId, state)
}
