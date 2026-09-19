import { rm } from 'node:fs/promises'
import type { IPty } from 'node-pty'

interface PtyFixture {
  readonly pty: Pick<IPty, 'kill'> & { readonly closeDescriptor?: () => void }
  readonly exit: { readonly whenExited: Promise<void> }
  readonly resourceDrain: { readonly whenDrained: Promise<boolean> }
}

export async function cleanupPtyFixture(fixture: PtyFixture | null, home: string) {
  if (fixture) {
    const timeoutMs = 10_000
    let timeout: ReturnType<typeof setTimeout> | undefined
    let escalation: ReturnType<typeof setTimeout> | undefined
    const deadline = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => reject(new Error('PTY fixture teardown timed out.')), timeoutMs)
    })
    try {
      const completion = Promise.all([fixture.exit.whenExited, fixture.resourceDrain.whenDrained])
      fixture.pty.kill()
      const graceful = new Promise<false>((resolve) => {
        escalation = setTimeout(() => resolve(false), 1_000)
      })
      if (!(await Promise.race([completion.then(() => true), graceful, deadline]))) {
        // Bash can survive SIGHUP sent while its command/prompt is finishing. The patched kill
        // checks the captured process identity; descriptor closure never targets a numeric PID.
        fixture.pty.kill('SIGKILL')
        fixture.pty.closeDescriptor?.()
      }
      const [, drained] = await Promise.race([completion, deadline])
      if (!drained) throw new Error('PTY fixture resource drain failed.')
    } finally {
      clearTimeout(timeout)
      clearTimeout(escalation)
    }
  }
  await rm(home, { recursive: true, force: true })
}
