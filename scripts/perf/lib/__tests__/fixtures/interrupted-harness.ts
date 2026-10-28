/**
 * A harness that launches a stand-in app in its own process group and creates a perf profile,
 * prints both, then waits to be interrupted (interrupt-cleanup.integration.test.ts).
 */
import { launchApp } from '../../perf-app'
import { createPerfProfile } from '../../perf-profile'

const IDLE_MS = 600_000

async function main() {
  const profile = await createPerfProfile({ label: 'interrupt' })
  const app = { label: 'stand-in', executable: process.execPath, leadingArguments: ['-e', `setTimeout(() => {}, ${String(IDLE_MS)})`] }
  const launched = launchApp(app, { PATH: process.env.PATH ?? '' }, [])
  process.stdout.write(`${JSON.stringify({ pid: launched.child.pid, root: profile.root })}\n`)
  await new Promise((resolve) => setTimeout(resolve, IDLE_MS))
}

void main()
