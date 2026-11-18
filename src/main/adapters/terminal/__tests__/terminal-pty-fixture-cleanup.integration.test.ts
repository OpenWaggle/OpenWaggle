import { access, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { makePtyRunner, type PtySpawnOutcome } from '../terminal-pty-runner'
import { cleanupPtyFixture } from './terminal-pty-fixture-cleanup'

afterEach(() => vi.unstubAllEnvs())

it.runIf(process.platform !== 'win32')(
  'reaps and drains a Bash fixture that ignores SIGHUP',
  async () => {
    const home = await mkdtemp(join(tmpdir(), 'openwaggle-pty-ignore-hup-'))
    const nonce = 'cleanup-ignores-hup'
    vi.stubEnv('HOME', home)
    vi.stubEnv('SHELL', '/bin/bash')
    vi.stubEnv('PATH', '/usr/bin:/bin')
    await writeFile(join(home, '.bash_profile'), "trap '' HUP\nPS1='cleanup-ready> '\n")
    let fixture: Extract<PtySpawnOutcome, { ok: true }> | null = null
    try {
      const outcome = await makePtyRunner({ appVersion: 'test' }).spawn({
        cwd: home,
        cols: 80,
        rows: 24,
        env: {},
        readinessNonce: nonce,
      })
      if (!outcome.ok) throw outcome.error
      fixture = outcome
      await new Promise<void>((resolve, reject) => {
        let output = ''
        const deadline = setTimeout(() => {
          subscription.dispose()
          reject(new Error('Bash fixture did not render its prompt.'))
        }, 10_000)
        const subscription = outcome.pty.onData((data) => {
          output += data
          if (!output.includes(`\u001b]633;B;${nonce}\u0007`)) return
          clearTimeout(deadline)
          subscription.dispose()
          resolve()
        })
        outcome.resumeOutput()
      })
      const kill = vi.spyOn(outcome.pty, 'kill')
      await cleanupPtyFixture(outcome, home)
      expect(kill).toHaveBeenCalledWith('SIGKILL')
      expect(outcome.exit.exitCode).not.toBeNull()
      expect(outcome.resourceDrain.status).toBe('drained')
      await expect(access(home)).rejects.toMatchObject({ code: 'ENOENT' })
      fixture = null
    } finally {
      await cleanupPtyFixture(fixture, home)
    }
  },
)
