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
  readonly scrollback?: string
}): TerminalRecord {
  const scrollback = createTerminalScrollback()
  if (options.scrollback !== undefined) scrollback.append(options.scrollback)
  return {
    key: terminalKeyOf(OWNER_KEY, TERMINAL_ID),
    ownerKey: OWNER_KEY,
    terminalId: TERMINAL_ID,
    cwd: options.cwd,
    scrollback,
    sanitizer: createTerminalHistorySanitizer(),
    pendingOutput: '',
    pendingInput: '',
    pendingStartOffset: 0,
    outputBytes: 0,
    spawnGeneration: 1,
    exitCode: null,
    closed: false,
    live: options.live ? { pty: fromPartial<IPty>({}), pid: 4242 } : null,
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

  it('reports context-change for a live shell in a different working path', () => {
    const record = makeRecord({ cwd: CWD_B, live: true })
    expect(decideTerminalOpen(record, INPUT, true, '')).toEqual({ kind: 'context-change' })
  })

  it('respawns a dead shell in the same working path', () => {
    const record = makeRecord({ cwd: CWD_A, live: false })
    expect(decideTerminalOpen(record, INPUT, true, '')).toEqual({ kind: 'respawn' })
  })

  it('respawns a dead shell even when the working path changed', () => {
    const record = makeRecord({ cwd: CWD_B, live: false })
    expect(decideTerminalOpen(record, INPUT, true, '')).toEqual({ kind: 'respawn' })
  })
})
