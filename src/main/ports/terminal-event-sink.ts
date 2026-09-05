import type { TerminalEventPayload, TerminalKey } from '@shared/types/terminal'
import { Context } from 'effect'
import type { Effect as EffectType } from 'effect/Effect'

/**
 * Delivery boundary for live terminal runtime events.
 *
 * The terminal service owns shells and scrollback; this port owns who is
 * watching. Adapters decide how events reach attached surfaces (Electron
 * windows today) and prune watchers that disappeared.
 */
export interface TerminalEventSinkShape {
  /** Deliver one runtime event to every surface attached to the terminal. */
  readonly emit: (payload: TerminalEventPayload) => EffectType<void, never>
  /** Register a surface (e.g. a WebContents id) as watching one terminal. */
  readonly attach: (terminalKey: TerminalKey, surfaceId: number) => EffectType<void, never>
  /** Drop one surface's attachment to exactly one terminal (pane unmount). */
  readonly detach: (terminalKey: TerminalKey, surfaceId: number) => EffectType<void, never>
  /** Drop every attachment held by one surface (window closed/reloaded). */
  readonly detachSurface: (surfaceId: number) => EffectType<void, never>
}

export class TerminalEventSink extends Context.Tag('@openwaggle/TerminalEventSink')<
  TerminalEventSink,
  TerminalEventSinkShape
>() {}
