import type { Terminal } from '@xterm/xterm'

/**
 * DOM events in which xterm turns a user action into PTY input: keys, text
 * input and IME composition, paste, mouse and wheel reports, and focus reports.
 */
const USER_INPUT_EVENT_TYPES = [
  'keydown',
  'keypress',
  'keyup',
  'beforeinput',
  'input',
  'compositionstart',
  'compositionupdate',
  'compositionend',
  'paste',
  'mousedown',
  'mouseup',
  'mousemove',
  'wheel',
  'touchstart',
  'touchmove',
  'touchend',
  'focus',
  'blur',
  'focusin',
  'focusout',
] as const
/** Events nested inside one dispatch (a key handler that moves focus) stay recognisable. */
const MAX_TRACKED_USER_EVENTS = 8
const REPORT_INTRODUCERS = ['\x1b', '\x90', '\x9b', '\x9d'] as const

/** Terminal reports (DA, DSR/CPR, DECRPM, OSC colour answers, focus reports) all start with ESC. */
function isTerminalReport(data: string) {
  return REPORT_INTRODUCERS.some((introducer) => data.startsWith(introducer))
}

/**
 * Forwards xterm's `onData` to the PTY, except the reports xterm generates
 * while it parses replayed history (issue #385).
 *
 * xterm answers terminal queries and mode changes as it parses, outside any
 * DOM event, and `onData` does not say whether data came from the user. While
 * a replay is in flight, an ESC-introduced chunk is therefore forwarded only
 * when it is emitted during the dispatch of a user-input event (an arrow key,
 * Alt+key, a mouse report, bracketed paste). Plain text is always forwarded,
 * including IME text that xterm emits from a timer after composition ends.
 * Outside the replay window everything is forwarded, so live queries are
 * answered as before.
 */
export function connectTerminalInput(
  terminal: Pick<Terminal, 'element' | 'onData'>,
  /** True while xterm may still be parsing replayed history. */
  isReplaying: () => boolean,
  forward: (data: string) => void,
) {
  // User-input events are observed in the capture phase of the document xterm is mounted in.
  const eventRoot = terminal.element?.ownerDocument ?? document
  const recentUserEvents: Event[] = []
  const trackUserEvent = (event: Event) => {
    recentUserEvents.push(event)
    if (recentUserEvents.length > MAX_TRACKED_USER_EVENTS) recentUserEvents.shift()
  }
  // A dispatched event keeps a phase other than NONE only until its dispatch completes.
  const isDispatchingUserEvent = () =>
    recentUserEvents.some((event) => event.eventPhase !== Event.NONE)

  for (const type of USER_INPUT_EVENT_TYPES) {
    eventRoot.addEventListener(type, trackUserEvent, { capture: true })
  }
  const subscription = terminal.onData((data) => {
    if (isReplaying() && isTerminalReport(data) && !isDispatchingUserEvent()) return
    forward(data)
  })

  return () => {
    subscription.dispose()
    for (const type of USER_INPUT_EVENT_TYPES) {
      eventRoot.removeEventListener(type, trackUserEvent, { capture: true })
    }
    recentUserEvents.length = 0
  }
}
