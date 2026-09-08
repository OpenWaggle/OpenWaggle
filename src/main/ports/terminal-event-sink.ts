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
  /** Deliver one runtime event and return the number of surfaces reached. */
  readonly emit: (payload: TerminalEventPayload) => EffectType<number, never>
  /** Register a surface (e.g. a WebContents id) as watching one terminal. */
  readonly attach: (terminalKey: TerminalKey, surfaceId: number) => EffectType<void, never>
  /** Drop one watcher and report whether the terminal has no watchers left. */
  readonly detach: (terminalKey: TerminalKey, surfaceId: number) => EffectType<boolean, never>
  /** Move every watcher to a rekeyed terminal, merging with destination watchers. */
  readonly move: (fromKey: TerminalKey, toKey: TerminalKey) => EffectType<void, never>
  /** Drop a dead window and return terminal keys that lost their last watcher. */
  readonly detachSurface: (surfaceId: number) => EffectType<readonly TerminalKey[], never>
}

export class TerminalEventSink extends Context.Tag('@openwaggle/TerminalEventSink')<
  TerminalEventSink,
  TerminalEventSinkShape
>() {}
