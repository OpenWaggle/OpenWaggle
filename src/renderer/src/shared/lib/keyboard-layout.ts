/**
 * The character each physical key types on the current keyboard layout, from Chromium's
 * Keyboard API (`navigator.keyboard.getLayoutMap()`), or nothing where it is unavailable. It
 * tells an AltGr character (`ł` on KeyL) from a remapped layout's own letter (AZERTY's `a` on
 * KeyQ).
 *
 * Chromium fires no `layoutchange` event, so the map is checked against plain key presses
 * instead: a letter or digit typed without modifiers that disagrees with the map means the user
 * switched layouts. The map is then dropped and read again, and until it arrives callers use
 * their layout-free rule rather than a stale map. Focusing the window reads it again too.
 */
let layout: ReadonlyMap<string, string> = new Map()
let tracking = false
let reading = false

function keyboardApi(): object | null {
  const keyboard: unknown = Reflect.get(navigator, 'keyboard')
  return typeof keyboard === 'object' && keyboard !== null ? keyboard : null
}

function layoutEntries(map: object) {
  const entries = new Map<string, string>()
  const forEach: unknown = Reflect.get(map, 'forEach')
  if (typeof forEach !== 'function') return entries
  Reflect.apply(forEach, map, [
    (value: unknown, code: unknown) => {
      if (typeof value === 'string' && typeof code === 'string') entries.set(code, value)
    },
  ])
  return entries
}

function readLayout() {
  const keyboard = keyboardApi()
  const getLayoutMap: unknown = keyboard === null ? null : Reflect.get(keyboard, 'getLayoutMap')
  if (keyboard === null || typeof getLayoutMap !== 'function' || reading) return
  reading = true
  void Promise.resolve(Reflect.apply(getLayoutMap, keyboard, []))
    .then((map: unknown) => {
      if (typeof map === 'object' && map !== null) layout = layoutEntries(map)
    })
    .catch(() => {
      // Without a layout map, shortcut matching falls back to its layout-free rule.
    })
    .finally(() => {
      reading = false
    })
}

/** Start following the keyboard layout; later calls do nothing. */
export function trackKeyboardLayout() {
  if (tracking) return
  tracking = true
  readLayout()
  window.addEventListener('focus', readLayout)
}

/** Read the layout again when a plain key press shows the map no longer matches it. */
export function noteKeyboardLayoutKeyPress(event: {
  readonly key: string
  readonly code: string
  readonly ctrlKey: boolean
  readonly altKey: boolean
  readonly metaKey: boolean
  readonly shiftKey: boolean
}) {
  if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return
  if (!/^[A-Za-z0-9]$/.test(event.key)) return
  const expected = layout.get(event.code)
  if (expected === undefined || expected.toLowerCase() === event.key.toLowerCase()) return
  layout = new Map()
  readLayout()
}

/** The character a physical key types on the current layout, when known. */
export function keyboardLayoutKey(code: string) {
  return layout.get(code) ?? null
}
