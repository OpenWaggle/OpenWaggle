/**
 * The PowerShell processes a Windows desktop start runs to secure the Session Host's paths, counted
 * on any host: the desktop app prepares the paths (gui-session-host-startup.ts), then the Host it
 * launches prepares them again and rotates its endpoint (session-host-cli-entry.ts), each through
 * the Windows user-only security helper, which is one `powershell.exe` per call. The helper is
 * replaced by a counter; the file work is real, in a scratch profile. Before the November 2026 fix
 * a later launch ran five of them and took about 4 s of the Windows backend-ready time.
 */
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, it } from 'vitest'
import {
  prepareLocalSessionHostPaths,
  resolveLocalSessionHostPaths,
  rotateLocalSessionHostEndpoint,
} from '../../../src/main/session-host/local-session-paths'
import type { WindowsUserOnlySecurity } from '../../../src/main/session-host/windows-user-only-security'
import { expectPerfMeasurements } from '../budget-test-support'

const SOURCE = 'scripts/perf-gate/__tests__/host-startup-processes.integration.test.ts'
const WINDOWS = 'win32'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

/** One desktop start on Windows: the window's path preparation, then the Host's, and its rotation. */
async function windowsDesktopStart(userDataRoot: string) {
  let runs = 0
  const secure: WindowsUserOnlySecurity = async () => {
    runs += 1
    return { userSid: 'S-1-5-21-0-0-0-1000' }
  }
  const resolved = resolveLocalSessionHostPaths({ userDataRoot, platform: WINDOWS })
  await prepareLocalSessionHostPaths(resolved, WINDOWS, secure)
  const hostPaths = await prepareLocalSessionHostPaths(resolved, WINDOWS, secure)
  await rotateLocalSessionHostEndpoint(hostPaths, WINDOWS, secure)
  return runs
}

describe('Session Host startup processes', () => {
  it('counts the PowerShell runs of a first and a later Windows desktop start', async () => {
    const userDataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'perf-gate-host-'))
    roots.push(userDataRoot)
    const first = await windowsDesktopStart(userDataRoot)
    const later = await windowsDesktopStart(userDataRoot)
    expectPerfMeasurements('host-startup-processes', SOURCE, {
      'host.startup.windows-powershell.first-launch': first,
      'host.startup.windows-powershell.later-launch': later,
    })
  })
})
