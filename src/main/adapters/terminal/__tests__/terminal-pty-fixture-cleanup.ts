import { rm } from 'node:fs/promises'
import type { IPty } from 'node-pty'

interface PtyFixture {
  readonly pty: Pick<IPty, 'kill'>
  readonly exit: { readonly whenExited: Promise<void> }
  readonly resourceDrain: { readonly whenDrained: Promise<boolean> }
}

export async function cleanupPtyFixture(fixture: PtyFixture | null, home: string) {
  if (fixture) {
    const timeoutMs = 10_000
    let timeout: ReturnType<typeof setTimeout> | undefined
    const deadline = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => reject(new Error('PTY fixture teardown timed out.')), timeoutMs)
    })
    try {
      fixture.pty.kill()
      const [, drained] = await Promise.race([
        Promise.all([fixture.exit.whenExited, fixture.resourceDrain.whenDrained]),
        deadline,
      ])
      if (!drained) throw new Error('PTY fixture resource drain failed.')
    } finally {
      clearTimeout(timeout)
    }
  }
  await rm(home, { recursive: true, force: true })
}
