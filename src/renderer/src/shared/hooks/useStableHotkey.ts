import {
  detectPlatform,
  getHotkeyManager,
  type Hotkey,
  type HotkeyCallback,
  normalizeRegisterableHotkey,
  useDefaultHotkeysOptions,
} from '@tanstack/react-hotkeys'
import { useLayoutEffect, useRef } from 'react'

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
 *
 * Like `useHotkey`, it applies the provider's default options and the platform's spelling of the
 * key (`Mod+K` is Meta on macOS, Control elsewhere), read when it registers. Options reach the
 * manager in a layout effect, before the browser paints the commit that changed them: a key pressed
 * right after an overlay opens sees the options of that render, not the one before it.
 */
export function useStableHotkey(
  /** A hotkey string; an object would register again on every render. */
  hotkey: Hotkey,
  callback: HotkeyCallback,
  options: StableHotkeyOptions,
): void {
  const callbackRef = useRef(callback)
  const handleRef = useRef<ReturnType<ReturnType<typeof getHotkeyManager>['register']> | null>(null)
  const optionsRef = useRef(options)
  const defaults = useDefaultHotkeysOptions().hotkey
  const defaultsRef = useRef(defaults)
  const { enabled, preventDefault, stopPropagation, ignoreInputs, conflictBehavior } = options

  useLayoutEffect(() => {
    callbackRef.current = callback
  })

  useLayoutEffect(() => {
    const { target: _target, ...defaultOptions } = defaultsRef.current ?? {}
    const handle = getHotkeyManager().register(
      normalizeRegisterableHotkey(hotkey, defaultOptions.platform ?? detectPlatform()),
      (event, context) => callbackRef.current(event, context),
      { ...defaultOptions, ...optionsRef.current, target: document },
    )
    handleRef.current = handle
    return () => {
      handleRef.current = null
      handle.unregister()
    }
  }, [hotkey])

  useLayoutEffect(() => {
    const next = { enabled, preventDefault, stopPropagation, ignoreInputs, conflictBehavior }
    const { target: _target, ...defaultOptions } = defaults ?? {}
    optionsRef.current = next
    defaultsRef.current = defaults
    handleRef.current?.setOptions({ ...defaultOptions, ...next })
  }, [defaults, enabled, preventDefault, stopPropagation, ignoreInputs, conflictBehavior])
}
