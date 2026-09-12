import type { TerminalOpenInput } from '@shared/types/terminal'
import { terminalKeyOf } from '@shared/types/terminal'
import { fromPartial } from '@total-typescript/shoehorn'
import type { IPty } from 'node-pty'
import { describe, expect, it } from 'vitest'
import { createTerminalHistorySanitizer } from '../terminal-history-sanitizer'
import { decideTerminalOpen } from '../terminal-open-semantics'
import type { TerminalRecord } from '../terminal-records'
import { createTerminalScrollback } from '../terminal-scrollback'

const OWNER_KEY = 'session-1'
const TERMINAL_ID = 'main'
const CWD_A = '/worktrees/session-1'
const CWD_B = '/worktrees/other'

const INPUT: TerminalOpenInput = {
  ownerKey: OWNER_KEY,
  terminalId: TERMINAL_ID,
  cwd: CWD_A,
  cols: 120,
  rows: 40,
}

function makeRecord(options: {
  readonly cwd: string
  readonly live: boolean
  readonly exitCode?: number | null
  readonly env?: Readonly<Record<string, string>>
  readonly scrollback?: string
}): TerminalRecord {
  const scrollback = createTerminalScrollback()
  if (options.scrollback !== undefined) scrollback.append(options.scrollback)
  return {
    inputIncarnation: '6fdd25b5-6b0a-4948-bd58-b3a82c8ee580',
    key: terminalKeyOf(OWNER_KEY, TERMINAL_ID),
    ownerKey: OWNER_KEY,
    terminalId: TERMINAL_ID,
    cwd: options.cwd,
    env: options.env ?? {},
    scrollback,
    sanitizer: createTerminalHistorySanitizer(),
    pendingOutput: '',
    pendingOutputBytes: 0,
    inFlightOutput: null,
    pendingInput: [],
    pendingInputBytes: 0,
    inputGeneration: null,
    lastInputReceipt: null,
    pendingStartOffset: 0,
    outputBytes: 0,
    outputGeneration: 1,
    spawnGeneration: 1,
    readinessPhase: 'ready',
    readinessGeneration: 1,
    promptDetector: null,
    promptEpoch: 1,
    projectAction: null,
    exitCode: options.exitCode === undefined ? (options.live ? null : 0) : options.exitCode,
    closed: false,
    live: options.live
      ? {
          pty: fromPartial<IPty>({}),
          pid: 4242,
          pauseOutput: () => undefined,
          resumeOutput: () => undefined,
          tty: null,
          ttyIdentity: null,
          processIdentity: null,
          processMetadata: Promise.resolve(null),
          exit: {
            whenExited: new Promise(() => undefined),
            exitCode: null,
            notifyExit: () => undefined,
            dispose: () => undefined,
          },
          processTreeExit: {
            whenExited: new Promise(() => undefined),
            exitCode: null,
            notifyExit: () => undefined,
            dispose: () => undefined,
          },
          resourceDrain: {
            status: 'pending',
            whenDrained: new Promise(() => undefined),
          },
          outputPaused: false,
        }
      : null,
    drainingProcesses: new Set(),
    termination: null,
    activity: null,
    ownerMigration: null,
  }
}

describe('decideTerminalOpen', () => {
  it('creates with persisted replay when no record exists', () => {
    expect(decideTerminalOpen(undefined, INPUT, true, 'persisted scrollback')).toEqual({
      kind: 'create',
      persisted: 'persisted scrollback',
    })
  })

  it('creates with empty replay when nothing is persisted', () => {
    expect(decideTerminalOpen(undefined, INPUT, true, '')).toEqual({
      kind: 'create',
      persisted: '',
    })
  })

  it('reports cwd-missing with the record scrollback when a record exists', () => {
    const record = makeRecord({ cwd: CWD_A, live: true, scrollback: 'in-memory tail\n' })
    expect(decideTerminalOpen(record, INPUT, false, 'persisted scrollback')).toEqual({
      kind: 'cwd-missing',
      persisted: 'in-memory tail\n',
    })
  })

  it('reports cwd-missing with persisted history when no record exists', () => {
    expect(decideTerminalOpen(undefined, INPUT, false, 'persisted scrollback')).toEqual({
      kind: 'cwd-missing',
      persisted: 'persisted scrollback',
    })
  })

  it('reuses a live shell in the same working path', () => {
    const record = makeRecord({ cwd: CWD_A, live: true })
    expect(decideTerminalOpen(record, INPUT, true, '')).toEqual({ kind: 'reuse' })
  })

  it('preserves explicit overrides when a same-cwd pane attach omits env', () => {
    const record = makeRecord({
      cwd: CWD_A,
      live: true,
      env: { T3CODE_PROJECT_ROOT: '/project' },
    })

    expect(decideTerminalOpen(record, INPUT, true, '')).toEqual({ kind: 'reuse' })
    expect(record.env).toEqual({ T3CODE_PROJECT_ROOT: '/project' })
  })

  it('treats an explicit environment change as a launch-context change', () => {
    const record = makeRecord({
      cwd: CWD_A,
      live: true,
      env: { T3CODE_PROJECT_ROOT: '/old-project' },
    })

    expect(
      decideTerminalOpen(
        record,
        { ...INPUT, env: { T3CODE_PROJECT_ROOT: '/new-project' } },
        true,
        '',
      ),
    ).toEqual({ kind: 'context-change' })
  })

  it('treats an explicit empty environment as clearing existing overrides', () => {
    const record = makeRecord({
      cwd: CWD_A,
      live: false,
      env: { T3CODE_PROJECT_ROOT: '/project' },
    })

    expect(decideTerminalOpen(record, { ...INPUT, env: {} }, true, '')).toEqual({
      kind: 'context-change',
    })
  })

  it('reports context-change for a live shell in a different working path', () => {
    const record = makeRecord({ cwd: CWD_B, live: true })
    expect(decideTerminalOpen(record, INPUT, true, '')).toEqual({ kind: 'context-change' })
  })

  it('respawns a dead shell in the same working path', () => {
    const record = makeRecord({ cwd: CWD_A, live: false })
    expect(decideTerminalOpen(record, INPUT, true, '')).toEqual({ kind: 'respawn' })
  })

  it('reuses the same launch context while its shell spawn is still in flight', () => {
    const current = makeRecord({ cwd: CWD_A, live: false, exitCode: null })

    expect(decideTerminalOpen(current, INPUT, true, '')).toEqual({
      kind: 'reuse-spawning',
    })
  })

  it('reports context-change for a dead shell when the working path changed', () => {
    const record = makeRecord({ cwd: CWD_B, live: false })
    expect(decideTerminalOpen(record, INPUT, true, '')).toEqual({ kind: 'context-change' })
  })
})
