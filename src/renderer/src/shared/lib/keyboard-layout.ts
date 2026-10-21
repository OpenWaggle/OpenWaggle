/**
 * The character each physical key types on the current keyboard layout, from Chromium's
 * Keyboard API (`navigator.keyboard.getLayoutMap()`), or nothing where it is unavailable. It
 * tells an AltGr character (`ł` on KeyL) from a remapped layout's own letter (AZERTY's `a` on
 * KeyQ). The map is refreshed when the user switches layouts.
 */
let layout: ReadonlyMap<string, string> = new Map()
let tracking = false

function keyboardApi(): object | null {
  const keyboard: unknown = Reflect.get(navigator, 'keyboard')
  return typeof keyboard === 'object' && keyboard !== null ? keyboard : null
}

function readLayout(keyboard: object) {
  const getLayoutMap: unknown = Reflect.get(keyboard, 'getLayoutMap')
  if (typeof getLayoutMap !== 'function') return
  void Promise.resolve(Reflect.apply(getLayoutMap, keyboard, []))
    .then((map: unknown) => {
      if (typeof map !== 'object' || map === null) return
      const forEach: unknown = Reflect.get(map, 'forEach')
      if (typeof forEach !== 'function') return
      const next = new Map<string, string>()
      Reflect.apply(forEach, map, [
        (value: unknown, code: unknown) => {
          if (typeof value === 'string' && typeof code === 'string') next.set(code, value)
        },
      ])
      layout = next
    })
    .catch(() => {
      // Without a layout map, shortcut matching falls back to its layout-free rule.
    })
}

/** Start following the keyboard layout; later calls do nothing. */
export function trackKeyboardLayout() {
  if (tracking) return
  tracking = true
  const keyboard = keyboardApi()
  if (keyboard === null) return
  readLayout(keyboard)
  const addEventListener: unknown = Reflect.get(keyboard, 'addEventListener')
  if (typeof addEventListener === 'function') {
    Reflect.apply(addEventListener, keyboard, ['layoutchange', () => readLayout(keyboard)])
  }
}

/** The character a physical key types on the current layout, when known. */
export function keyboardLayoutKey(code: string) {
  return layout.get(code) ?? null
}
