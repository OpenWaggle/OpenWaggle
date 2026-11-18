import type { ChildProcess, ExecFileException } from 'node:child_process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type InventoryExec = (
  executable: string,
  args: readonly string[],
  options: { readonly timeout: number; readonly windowsHide: boolean },
  callback: (error: ExecFileException | null, stdout: string) => void,
) => ChildProcess

const mocks = vi.hoisted(() => ({ execFile: vi.fn<InventoryExec>() }))
vi.mock('node:child_process', () => ({ execFile: mocks.execFile }))

import { snapshotWindowsProcessTree, verifyWindowsProcessTreeExit } from '../windows-process-tree'

const records = JSON.stringify([
  { processId: 42, parentProcessId: 1, creationDate: 'first-identity' },
  { processId: 43, parentProcessId: 42, creationDate: 'child-identity' },
])

function callback(index = 0) {
  const called = mocks.execFile.mock.calls[index]
  if (!called) throw new Error('Inventory command was not started.')
  return called[3]
}

describe('Windows process inventory command', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.spyOn(Date, 'now').mockReturnValue(1_000)
  })
  afterEach(() => vi.restoreAllMocks())

  it('retries a positively identified killed timeout once and uses only the fresh identity result', async () => {
    const pending = snapshotWindowsProcessTree(42)
    vi.spyOn(Date, 'now').mockReturnValue(4_001)
    callback()(
      Object.assign(new Error('private command arguments'), {
        killed: true,
        signal: 'SIGTERM' as const,
      }),
      '',
    )
    await Promise.resolve()
    await Promise.resolve()
    expect(mocks.execFile).toHaveBeenCalledTimes(2)
    callback(1)(null, records)
    await expect(pending).resolves.toEqual([
      { processId: 42, creationDate: 'first-identity' },
      { processId: 43, creationDate: 'child-identity' },
    ])
    for (const call of mocks.execFile.mock.calls) {
      expect(call[2]).toEqual({ timeout: 3_000, windowsHide: true })
      expect(call[1].join(' ')).toContain('-Property ProcessId,ParentProcessId,CreationDate')
    }
  })

  it('bounds repeated killed timeouts without leaking raw diagnostics', async () => {
    const pending = snapshotWindowsProcessTree(42)
    const rejection = expect(pending).rejects.toThrow('Windows process inventory failed: timeout')
    vi.spyOn(Date, 'now').mockReturnValue(4_001)
    callback()(
      Object.assign(new Error('private command arguments'), {
        killed: true,
        signal: 'SIGTERM' as const,
      }),
      '',
    )
    await Promise.resolve()
    await Promise.resolve()
    vi.spyOn(Date, 'now').mockReturnValue(7_002)
    callback(1)(
      Object.assign(new Error('private command arguments'), {
        killed: true,
        signal: 'SIGTERM' as const,
      }),
      '',
    )
    await rejection
    expect(mocks.execFile).toHaveBeenCalledTimes(2)
  })

  it.each([
    { code: 1 },
    { code: 'ENOENT' },
    { code: 'EACCES' },
    { killed: true, signal: 'SIGTERM', code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' },
  ] as const)(
    'never retries an ordinary exit, spawn, permission or output-limit failure: %j',
    async (fields) => {
      const pending = snapshotWindowsProcessTree(42)
      vi.spyOn(Date, 'now').mockReturnValue(4_001)
      callback()(Object.assign(new Error('private command arguments'), fields), '')
      await expect(pending).rejects.toThrow('Windows process inventory failed:')
      expect(mocks.execFile).toHaveBeenCalledOnce()
    },
  )

  it('does not treat an early killed command as a timeout', async () => {
    const pending = snapshotWindowsProcessTree(42)
    callback()(
      Object.assign(new Error('private command arguments'), {
        killed: true,
        signal: 'SIGTERM' as const,
      }),
      '',
    )
    await expect(pending).rejects.toThrow('Windows process inventory failed:')
    expect(mocks.execFile).toHaveBeenCalledOnce()
  })

  it('fails closed on a CIM error rather than accepting an empty partial inventory as process exit', async () => {
    const pending = verifyWindowsProcessTreeExit([
      { processId: 42, creationDate: 'first-identity' },
    ])
    callback()(Object.assign(new Error('CIM query failed'), { code: 1 }), '[]')
    await expect(pending).rejects.toThrow('Windows process inventory failed: process-error')
    expect(mocks.execFile).toHaveBeenCalledOnce()
    expect(mocks.execFile.mock.calls[0]?.[1].join(' ')).toContain("$ErrorActionPreference = 'Stop'")
  })

  it.each(['not-json', '{}', '[{}]'])(
    'does not retry malformed inventory output: %s',
    async (output) => {
      const pending = snapshotWindowsProcessTree(42)
      callback()(null, output)
      await expect(pending).rejects.toThrow()
      expect(mocks.execFile).toHaveBeenCalledOnce()
    },
  )

  it('reports bounded status fields without the raw command, stderr or error cause', async () => {
    const pending = snapshotWindowsProcessTree(42).catch((error: unknown) => error)
    callback()(
      Object.assign(new Error('private command and private stderr'), {
        code: 'EACCES',
        cause: new Error('private credential material'),
      }),
      '',
    )
    const error = await pending
    expect(error).toBeInstanceOf(Error)
    expect(error).toMatchObject({
      message:
        'Windows process inventory failed: process-error; elapsedMs=0; code=EACCES; signal=unavailable; killed=false.',
    })
    expect(error).not.toHaveProperty('cause')
  })
})
