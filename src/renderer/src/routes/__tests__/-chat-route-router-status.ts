import { useSyncExternalStore } from 'react'

type RouterStatus = 'idle' | 'pending'

/*
 * The router's navigation status for route-effect tests, as `useRouterState` selects it: a test
 * sets it to play a navigation starting and settling.
 */
let status: RouterStatus = 'idle'
const listeners = new Set<() => void>()

export const testRouterStatus = {
  set(next: RouterStatus) {
    status = next
    for (const listener of [...listeners]) listener()
  },
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useTestRouterState<T>({
  select,
}: {
  readonly select: (state: { readonly status: RouterStatus }) => T
}) {
  return select({ status: useSyncExternalStore(subscribe, () => status) })
}
