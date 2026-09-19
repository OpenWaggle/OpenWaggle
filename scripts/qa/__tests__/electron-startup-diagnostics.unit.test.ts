import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import {
  captureElectronStartupDiagnostics,
  electronStartupErrorMessage,
} from '../electron-startup-diagnostics'

describe('Electron startup diagnostics', () => {
  it('captures the existing GUI stderr and exit status without creating a process or pipe', () => {
    const stderr = new PassThrough()
    const child = { stderr, pid: 42, exitCode: 1, signalCode: null }
    const diagnostics = captureElectronStartupDiagnostics(child)
    stderr.write('Local Session Host startup failed\n')

    expect(diagnostics.snapshot(new Error('firstWindow timed out'))).toEqual({
      error: expect.stringContaining('firstWindow timed out'),
      pid: 42,
      exitCode: 1,
      signalCode: null,
      stderrTail: 'Local Session Host startup failed\n',
    })
    diagnostics.stop()
    expect(stderr.listenerCount('data')).toBe(0)
  })

  it('bounds retained diagnostics and detaches collection when startup completes', () => {
    const stderr = new PassThrough()
    const diagnostics = captureElectronStartupDiagnostics({
      stderr,
      pid: 43,
      exitCode: null,
      signalCode: null,
    })
    stderr.write('old diagnostics'.repeat(1_000))
    stderr.write('latest failure')
    diagnostics.stop()
    stderr.write('must not be collected')
    const snapshot = diagnostics.snapshot('timeout '.repeat(1_000))

    expect(snapshot.stderrTail).toHaveLength(4_096)
    expect(snapshot.stderrTail.endsWith('latest failure')).toBe(true)
    expect(snapshot.error).toHaveLength(4_096)
    expect(stderr.listenerCount('data')).toBe(0)
  })

  it('reports an early process signal or missing stderr without requiring a window', () => {
    const diagnostics = captureElectronStartupDiagnostics({
      stderr: null,
      pid: undefined,
      exitCode: null,
      signalCode: 'SIGABRT',
    })

    expect(diagnostics.snapshot('launch failed')).toEqual({
      error: 'launch failed',
      pid: null,
      exitCode: null,
      signalCode: 'SIGABRT',
      stderrTail: '',
    })
    diagnostics.stop()
    expect(electronStartupErrorMessage(new Error('launch rejected'))).toContain('launch rejected')
  })
})
