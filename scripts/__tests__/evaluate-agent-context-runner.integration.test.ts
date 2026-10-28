import { lstat, realpath, rm } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { prepareTaskProfile } from '../evaluate-agent-context-runner'
import type { EvalTask } from '../evaluate-agent-context-types'
import { createPerfProfile, type PerfProfile } from '../perf/lib/perf-profile'

/**
 * R6 P2-3: an eval Run has YOLO authority over the throwaway home, so preparing it must not link
 * anything of the user's real home in, `~/.aws` above all. (Real git: integration tier.)
 */
const TASK: EvalTask = {
  id: 'fixture',
  group: 'core-coding',
  prompt: () => 'noop',
  grade: () => ({ pass: true, reason: 'fixture' }),
  reference: {},
}

const profiles: PerfProfile[] = []
afterEach(async () => {
  for (const profile of profiles.splice(0)) await rm(profile.root, { recursive: true, force: true })
})

describe('agent-context eval task profile', () => {
  it('holds no link to the real ~/.aws', async () => {
    const profile = await createPerfProfile({ label: 'eval-aws' })
    profiles.push(profile)

    await prepareTaskProfile(TASK, profile)

    const aws = path.join(profile.home, '.aws')
    const entry = await lstat(aws).catch(() => null)
    if (entry !== null) {
      expect(entry.isSymbolicLink()).toBe(false)
      expect((await realpath(aws)).startsWith(`${profile.root}${path.sep}`)).toBe(true)
    }
    expect(entry).toBeNull()
  })
})
