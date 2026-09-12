import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  EARLY_CHILD_PID,
  getTerminalProcessShutdownProbes,
  identities,
  LATE_CHILD_PID,
  makeLiveProcess,
  makeRecord,
  ROOT_PID,
  refreshTerminalProcessPids,
  row,
  setupTerminalProcessShutdownTest,
  shutdownLiveTerminal,
  table,
  teardownTerminalProcessShutdownTest,
} from './terminal-process-shutdown-test-harness'

const probes = getTerminalProcessShutdownProbes()

describe('terminal shutdown rejects reused tty ownership', () => {
  beforeEach(setupTerminalProcessShutdownTest)
  afterEach(teardownTerminalProcessShutdownTest)

  it('rejects a recycled cached pid even when a reused tty name matches', async () => {
    vi.spyOn(process, 'kill').mockReturnValue(true)
    probes.readProcessTable.mockResolvedValue(
      table(
        { ...row(ROOT_PID, 1, 'zsh'), tty: 'ttys123' },
        {
          ...row(EARLY_CHILD_PID, 1, 'unrelated'),
          tty: 'ttys123',
          startedAt: 'recycled-process',
        },
      ),
    )

    const refreshed = await refreshTerminalProcessPids(
      ROOT_PID,
      [ROOT_PID, EARLY_CHILD_PID],
      identities(ROOT_PID, EARLY_CHILD_PID),
      'ttys123',
      'darwin:16:123',
      true,
    )

    expect(refreshed.processPids).toEqual([ROOT_PID])
    expect(refreshed.processIdentities).toEqual(identities(ROOT_PID))
  })

  it('does not equate a descriptor-close request with tty closure or adopt a new member', async () => {
    const fake = makeLiveProcess()
    fake.live.tty = 'ptmx'
    Object.defineProperty(fake.live, 'ttyIdentity', { value: 'linux:5:2' })
    const record = makeRecord(fake.live)
    if (record.activity !== null) {
      record.activity = {
        ...record.activity,
        processPids: [ROOT_PID],
        processIdentities: identities(ROOT_PID),
        tty: 'ptmx',
      }
    }
    probes.readProcessTable.mockImplementation(() =>
      Promise.resolve(
        fake.closeDescriptor.mock.calls.length === 0
          ? table({
              ...row(ROOT_PID, 1, 'zsh'),
              tty: 'ptmx',
              ttyIdentity: 'linux:5:2',
            })
          : table({
              ...row(LATE_CHILD_PID, 1, 'unrelated-new-session'),
              tty: 'ptmx',
              ttyIdentity: 'linux:5:2',
            }),
      ),
    )
    vi.spyOn(process, 'kill').mockReturnValue(true)

    await expect(shutdownLiveTerminal(record, vi.fn())).resolves.toBe(true)

    expect(probes.signalTerminalProcessIdentity).not.toHaveBeenCalledWith(
      expect.objectContaining({ pid: LATE_CHILD_PID }),
      'SIGKILL',
    )
    expect(
      probes.readProcessTable.mock.calls.some(
        ([target]) =>
          target !== undefined &&
          typeof target === 'object' &&
          'ttyClosed' in target &&
          target.ttyClosed === true,
      ),
    ).toBe(true)
    expect(record.live).toBeNull()
  })
})
