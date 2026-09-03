import type {
  TerminalAttachResult,
  TerminalId,
  TerminalKey,
  TerminalOpenInput,
  TerminalOwnerKey,
} from '@shared/types/terminal'
import { Context } from 'effect'
import type { Effect as EffectType } from 'effect/Effect'

export type TerminalServiceError = Error

/**
 * Owns every Session terminal's shell process and its persisted scrollback
 * (ADR 0030). Opening is idempotent: a live shell with the same launch
 * context is reused, a dead shell respawns on demand, a changed launch
 * context restarts the shell so the terminal always reflects its session's
 * Working path.
 */
export interface TerminalServiceShape {
  /** Idempotently open (or re-attach to) one terminal and return its snapshot. */
  readonly open: (
    input: TerminalOpenInput,
  ) => EffectType<TerminalAttachResult, TerminalServiceError>
  /** Write user input to a live terminal. Unknown terminals are ignored. */
  readonly write: (
    ownerKey: TerminalOwnerKey,
    terminalId: TerminalId,
    data: string,
  ) => EffectType<void, never>
  /** Resize a live terminal. Unknown or dead terminals are ignored. */
  readonly resize: (
    ownerKey: TerminalOwnerKey,
    terminalId: TerminalId,
    cols: number,
    rows: number,
  ) => EffectType<void, never>
  /** Clear the live terminal's screen and its persisted scrollback. */
  readonly clear: (
    ownerKey: TerminalOwnerKey,
    terminalId: TerminalId,
  ) => EffectType<void, TerminalServiceError>
  /** Kill and respawn the shell with the given launch context; scrollback resets. */
  readonly restart: (
    input: TerminalOpenInput,
  ) => EffectType<TerminalAttachResult, TerminalServiceError>
  /** Kill one terminal, optionally deleting its persisted scrollback. */
  readonly close: (
    ownerKey: TerminalOwnerKey,
    terminalId: TerminalId,
    deleteHistory: boolean,
  ) => EffectType<void, never>
  /** Kill and clean up every terminal owned by one session or draft. */
  readonly closeAllForOwner: (
    ownerKey: TerminalOwnerKey,
    deleteHistory: boolean,
  ) => EffectType<void, never>
  /** Kill terminals whose shell lives under one path (Session worktree removal). */
  readonly closeAllUnderPath: (
    directoryPath: string,
    deleteHistory: boolean,
  ) => EffectType<void, never>
  /** Register the calling surface (window) as watching one terminal's events. */
  readonly attachSurface: (terminalKey: TerminalKey, surfaceId: number) => EffectType<void, never>
  /** Drop one surface's attachment to exactly one terminal (pane unmount). */
  readonly detachTerminal: (
    ownerKey: TerminalOwnerKey,
    terminalId: TerminalId,
    surfaceId: number,
  ) => EffectType<void, never>
  /** Drop every event attachment held by one surface (window closed/reloaded). */
  readonly detachSurface: (surfaceId: number) => EffectType<void, never>
  /** Kill every terminal; used on app shutdown. */
  readonly closeAll: () => EffectType<void, never>
}

export class TerminalService extends Context.Tag('@openwaggle/TerminalService')<
  TerminalService,
  TerminalServiceShape
>() {}
