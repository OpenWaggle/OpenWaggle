import os from 'node:os'
import { fromPartial } from '@total-typescript/shoehorn'
import type * as NodePtyModule from 'node-pty'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { collectDescendants } from '../terminal-process-activity'
import type { TerminalKernelProcessInfo } from '../terminal-process-identity'
import {
  installTerminalProcessKernelApi,
  readTerminalKernelProcessInfos,
  resetTerminalProcessKernelApiForTests,
} from '../terminal-process-kernel-api'
import {
  hydratePosixProcessRows,
  type ProcessRow,
  readProcessTable,
} from '../terminal-process-probes'

const execFileMock = vi.hoisted(() => vi.fn())

vi.mock('node:child_process', () => ({ execFile: execFileMock }))

function kernelInfo(pid: number): TerminalKernelProcessInfo {
  return {
    pid,
    startedAt: `start-${pid}`,
    ppid: 1,
    pgid: pid,
    tpgid: pid,
    ttyIdentity: 'darwin:16:1',
    zombie: false,
    name: `process-${pid}`,
  }
}

function install(readMany: (pids: readonly number[]) => unknown) {
  const pty = fromPartial<typeof NodePtyModule>({})
  Reflect.set(pty, 'native', { processInfos: readMany })
  installTerminalProcessKernelApi(pty)
}

describe('terminal process kernel API', () => {
  afterEach(() => {
    resetTerminalProcessKernelApiForTests()
    execFileMock.mockReset()
    vi.restoreAllMocks()
  })

  it('splits a large identity sample into bounded native batches', () => {
    const readMany = vi.fn((pids: readonly number[]) => pids.map(kernelInfo))
    install(readMany)
    const pids = Array.from({ length: 33 }, (_, index) => index + 1)

    const result = readTerminalKernelProcessInfos(pids)

    expect(readMany).toHaveBeenCalledTimes(2)
    expect(readMany).toHaveBeenNthCalledWith(1, pids.slice(0, 32))
    expect(readMany).toHaveBeenNthCalledWith(2, [33])
    expect(result).toEqual(new Map(pids.map((pid) => [pid, kernelInfo(pid)])))
  })

  it('drops a recycled ancestry parent across bounded validation passes', () => {
    vi.spyOn(os, 'platform').mockReturnValue('darwin')
    let call = 0
    const readMany = vi.fn((pids: readonly number[]) => {
      call += 1
      return pids.map((pid) => ({
        ...kernelInfo(pid),
        ppid: pid === 1 ? 0 : pid === 2 ? 1 : pid === 33 ? 2 : 0,
        ...(call === 3 && pid === 2 ? { startedAt: 'recycled-parent' } : {}),
      }))
    })
    install(readMany)
    const pids = Array.from({ length: 33 }, (_, index) => index + 1)
    const rows = new Map<number, ProcessRow>(
      pids.map((pid) => [
        pid,
        {
          ...kernelInfo(pid),
          ppid: pid === 1 ? 0 : pid === 2 ? 1 : pid === 33 ? 2 : 0,
          tty: null,
          identityVerified: false,
        },
      ]),
    )

    const result = hydratePosixProcessRows(rows, pids)

    expect(readMany).toHaveBeenCalledTimes(4)
    expect(readMany).toHaveBeenNthCalledWith(1, pids.slice(0, 32))
    expect(readMany).toHaveBeenNthCalledWith(2, [33])
    expect(readMany).toHaveBeenNthCalledWith(3, pids.slice(0, 32))
    expect(readMany).toHaveBeenNthCalledWith(4, [33])
    expect(result?.has(1)).toBe(true)
    expect(result?.has(2)).toBe(false)
    expect(result?.get(33)).toMatchObject({ ppid: 2, startedAt: 'start-33' })
    if (result === null) throw new Error('expected a stable kernel sample')
    expect(collectDescendants(1, result).pids).toEqual(new Set([1]))
  })

  it('retains a native-confirmed cached process omitted from targeted ps output', async () => {
    vi.spyOn(os, 'platform').mockReturnValue('darwin')
    const readMany = vi.fn((pids: readonly number[]) => pids.map(kernelInfo))
    install(readMany)
    execFileMock.mockImplementation(
      (
        _command: string,
        _args: readonly string[],
        _options: unknown,
        callback: (error: Error | null, stdout: string, stderr: string) => void,
      ) => {
        callback(
          null,
          [
            '1 0 1 1 ttys001 S Fri Sep 4 22:18:37 2026 /bin/zsh',
            '2 malformed cached process row',
          ].join('\n'),
          '',
        )
      },
    )

    const result = await readProcessTable({
      rootPid: 1,
      cachedPids: [2],
      tty: 'ttys001',
      ttyClosed: true,
    })

    expect(readMany).toHaveBeenCalledTimes(2)
    expect(readMany).toHaveBeenNthCalledWith(1, [2, 1])
    expect(readMany).toHaveBeenNthCalledWith(2, [2, 1])
    expect(result?.get(2)).toMatchObject({
      pid: 2,
      startedAt: 'start-2',
      tty: null,
      ttyIdentity: 'darwin:16:1',
      identityVerified: true,
    })
  })

  it('fails the whole sample when a native batch crosses the deadline', () => {
    let now = 0
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const readMany = vi.fn((pids: readonly number[]) => {
      now = 10
      return pids.map(kernelInfo)
    })
    install(readMany)

    expect(readTerminalKernelProcessInfos([1, 2, 3], 10)).toBeNull()
    expect(readMany).toHaveBeenCalledOnce()
  })

  it.each([
    ['a non-array result', { pid: 1 }],
    ['an unrequested pid', [kernelInfo(2)]],
    ['a duplicate pid', [kernelInfo(1), kernelInfo(1)]],
    ['a malformed identity token', [{ ...kernelInfo(1), startedAt: '' }]],
    ['a malformed tty identity', [{ ...kernelInfo(1), ttyIdentity: '' }]],
  ])('rejects %s from the native boundary', (_case, nativeResult) => {
    install(() => nativeResult)

    expect(readTerminalKernelProcessInfos([1])).toBeNull()
  })
})
