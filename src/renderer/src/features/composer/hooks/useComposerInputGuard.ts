import { useLayoutEffect, useRef } from 'react'
import { useComposerStore } from '../state/composer-store'

interface DraftInputScope {
  readonly contextKey: string | null
  readonly disabled: boolean
  active: boolean
}

/** Fence asynchronous input to the enabled draft that accepted it. */
export function useComposerInputGuard(disabled: boolean) {
  const contextKey = useComposerStore((state) => state.activeDraftContextKey)
  const scopeRef = useRef<DraftInputScope | null>(null)
  useLayoutEffect(() => {
    const scope = { contextKey, disabled, active: true }
    scopeRef.current = scope
    return () => {
      scope.active = false
    }
  }, [disabled, contextKey])

  return function captureInputGuard() {
    const scope = scopeRef.current
    return () =>
      scope !== null &&
      !scope.disabled &&
      scope.active &&
      useComposerStore.getState().activeDraftContextKey === scope.contextKey
  }
}
