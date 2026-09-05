import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import type { ElectronApplication } from '@playwright/test'
import { fromPartial } from '@total-typescript/shoehorn'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { forceCloseElectronApplication } from './electron-process-tree'

describe('Electron process-tree teardown', () => {
  const children: ChildProcess[] = []

  afterEach(() => {
    for (const child of children.splice(0)) {
      if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) continue
      try {
        process.kill(child.pid, 'SIGKILL')
      } catch {
        // The regression helper already terminated the fixture.
      }
    }
  })

  it('force-closes the process without creating a pending Playwright close operation', async () => {
    const killSpy = vi.spyOn(process, 'kill')
    const child = spawn(process.execPath, ['-e', 'setInterval(() => undefined, 1_000)'], {
      stdio: 'ignore',
    })
    children.push(child)
    await once(child, 'spawn')
    const exited = once(child, 'exit')
    let playwrightObservedClose = false
    child.once('close', () => {
      playwrightObservedClose = true
    })

    await forceCloseElectronApplication(
      fromPartial<ElectronApplication>({
        process: () => child,
      }),
    )

    await expect(exited).resolves.toBeDefined()
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true)
    expect(playwrightObservedClose).toBe(true)
    expect(killSpy).toHaveBeenCalledWith(-Number(child.pid), 'SIGKILL')
  })
})
