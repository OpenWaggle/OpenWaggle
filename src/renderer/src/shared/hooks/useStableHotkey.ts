import { getHotkeyManager, type Hotkey, type HotkeyCallback } from '@tanstack/react-hotkeys'
import { useEffect, useLayoutEffect, useRef } from 'react'

export interface StableHotkeyOptions {
  readonly enabled: boolean
  readonly preventDefault: boolean
  readonly stopPropagation: boolean
  readonly ignoreInputs: boolean
  readonly conflictBehavior: 'allow'
}

/**
 * `useHotkey` for components that render often, such as the composer while a Run streams.
 *
 * `@tanstack/react-hotkeys` re-reads the platform and calls `setOptions` on every render, and each
 * `setOptions` copies the manager's whole registration map and notifies its store. This registers
 * once per key, reads the latest callback through a ref, and passes options to the manager only
 * when one of them changes; a disabled hotkey stays registered, as with `useHotkey`.
 */
export function useStableHotkey(
  hotkey: Hotkey,
  callback: HotkeyCallback,
  options: StableHotkeyOptions,
): void {
  const callbackRef = useRef(callback)
  const handleRef = useRef<ReturnType<ReturnType<typeof getHotkeyManager>['register']> | null>(null)
  const optionsRef = useRef(options)
  const { enabled, preventDefault, stopPropagation, ignoreInputs, conflictBehavior } = options

  useLayoutEffect(() => {
    callbackRef.current = callback
  })

  useEffect(() => {
    const handle = getHotkeyManager().register(
      hotkey,
      (event, context) => callbackRef.current(event, context),
      { ...optionsRef.current, target: document },
    )
    handleRef.current = handle
    return () => {
      handleRef.current = null
      handle.unregister()
    }
  }, [hotkey])

  useEffect(() => {
    const next = { enabled, preventDefault, stopPropagation, ignoreInputs, conflictBehavior }
    optionsRef.current = next
    handleRef.current?.setOptions(next)
  }, [enabled, preventDefault, stopPropagation, ignoreInputs, conflictBehavior])
}
