import { describe, expect, it } from 'vitest'
import {
  appMemory,
  parsePosixProcesses,
  parseWindowsProcesses,
  processRole,
  selectAppProcesses,
} from '../app-processes'

const APP = '/tmp/install/OpenWaggle.app'
const EXE = `${APP}/Contents/MacOS/OpenWaggle`
const HELPER = `${APP}/Contents/Frameworks/OpenWaggle Helper (Renderer).app/Contents/MacOS/x`

describe('process table parsing', () => {
  it('reads ps rows with command lines that contain spaces', () => {
    expect(
      parsePosixProcesses(
        `  10     1  2048 ${EXE} --flag\n  11    10   512 ${HELPER} --type=renderer\nbad\n`,
      ),
    ).toEqual([
      { pid: 10, ppid: 1, rssBytes: 2048 * 1024, command: `${EXE} --flag` },
      { pid: 11, ppid: 10, rssBytes: 512 * 1024, command: `${HELPER} --type=renderer` },
    ])
  })

  it('reads one Windows process as an object and several as an array', () => {
    const row = {
      ProcessId: 4,
      ParentProcessId: 1,
      WorkingSetSize: 4096,
      ExecutablePath: 'C:\\App\\OpenWaggle.exe',
      CommandLine: null,
    }
    expect(parseWindowsProcesses(JSON.stringify(row))).toEqual([
      { pid: 4, ppid: 1, rssBytes: 4096, command: 'C:\\App\\OpenWaggle.exe' },
    ])
    expect(parseWindowsProcesses(JSON.stringify([row, { ...row, ProcessId: 5 }]))).toHaveLength(2)
  })

  it("ties a Windows Host started by a relative command line to its executable's install", () => {
    const host = {
      ProcessId: 7,
      ParentProcessId: 1,
      WorkingSetSize: 4096,
      ExecutablePath: 'C:\\App\\OpenWaggle.exe',
      CommandLine: 'OpenWaggle.exe session-host-internal',
    }
    const named = {
      ...host,
      ProcessId: 8,
      CommandLine: '"c:\\app\\OpenWaggle.exe" session-host-internal',
    }
    const rows = parseWindowsProcesses(JSON.stringify([host, named]))
    expect(rows.map((row) => row.command)).toEqual([
      'C:\\App\\OpenWaggle.exe OpenWaggle.exe session-host-internal',
      '"c:\\app\\OpenWaggle.exe" session-host-internal',
    ])
    expect(
      selectAppProcesses(rows, { rootPids: [], installPaths: ['C:\\App'] })
        .map((row) => row.pid)
        .toSorted((left, right) => left - right),
    ).toEqual([7, 8])
    expect(processRole(rows[0]?.command ?? '', ['C:\\App'])).toBe('session-host')
  })
})

describe('the app processes', () => {
  const rows = [
    { pid: 10, ppid: 1, rssBytes: 100, command: EXE },
    { pid: 11, ppid: 10, rssBytes: 10, command: `${HELPER} --type=renderer` },
    // A Host a CLI run started, reparented to launchd once the CLI exited.
    { pid: 20, ppid: 1, rssBytes: 50, command: `${EXE} session-host-internal` },
    { pid: 21, ppid: 20, rssBytes: 5, command: '/bin/zsh -il' },
    { pid: 30, ppid: 1, rssBytes: 999, command: '/usr/bin/unrelated' },
    { pid: 40, ppid: 1, rssBytes: 7, command: `C:\\Users\\Runner\\OpenWaggle\\OpenWaggle.exe` },
  ]

  it('takes the launched tree and every process run from the install, with descendants', () => {
    const selected = selectAppProcesses(rows, {
      rootPids: [10],
      installPaths: [APP, 'c:/users/runner/openwaggle'],
      excludePids: [11],
    })
    expect(selected.map((row) => row.pid).sort((a, b) => a - b)).toEqual([10, 20, 21, 40])
  })

  it('sums resident memory by role', () => {
    const memory = appMemory(rows.slice(0, 4), [APP])
    expect(memory).toMatchObject({
      rssBytes: 165,
      processCount: 4,
      byRole: {
        main: { count: 1, rssBytes: 100 },
        renderer: { count: 1, rssBytes: 10 },
        'session-host': { count: 1, rssBytes: 50 },
        child: { count: 1, rssBytes: 5 },
      },
    })
  })

  it.each([
    [`${HELPER} --type=gpu-process`, 'gpu'],
    [`${HELPER} --type=utility --utility-sub-type=network.mojom.NetworkService`, 'network'],
    [`${HELPER} --type=utility --utility-sub-type=storage.mojom.StorageService`, 'utility'],
    [`${HELPER} --type=crashpad-handler`, 'crashpad'],
    [`${EXE} {"transformersPath":"x"}`, 'embedding'],
    ['/home/runner/openwaggle.AppImage', 'launcher'],
    [`${EXE} run --project x`, 'cli'],
    ['/usr/lib/webkit2gtk-4.1/WebKitWebProcess 12', 'webview'],
  ] as const)('names %s a %s process', (command, role) => {
    expect(processRole(command, [APP])).toBe(role)
  })
})
