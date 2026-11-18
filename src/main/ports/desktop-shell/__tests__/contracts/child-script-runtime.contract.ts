import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { expect } from 'vitest'
import { definePortContract } from './port-contract'
import type { ChildScriptRuntimeShape } from '../../child-runtime'

export interface ChildScriptRuntimeContractHarness {
  readonly subject: ChildScriptRuntimeShape
  /** Whether the suite may spawn `executable()`; false where the shell binary is not present. */
  readonly canSpawn: boolean
}

export const childScriptRuntimeContract = definePortContract<ChildScriptRuntimeContractHarness>(
  'ChildScriptRuntime',
  {
    'keeps the caller environment and never mutates it': async ({ subject }) => {
      const environment = Object.freeze({ OPENWAGGLE_PROBE: 'kept', PATH: '/usr/bin' })
      const child = subject.environment(environment)
      expect(child).toMatchObject({ OPENWAGGLE_PROBE: 'kept', PATH: '/usr/bin' })
      expect(child).not.toBe(environment)
      expect(path.isAbsolute(subject.executable())).toBe(true)
    },

    'runs `-e` source as a script rather than the app': async ({ subject, canSpawn }) => {
      if (!canSpawn) return
      const result = spawnSync(subject.executable(), ['-e', 'process.stdout.write("script")'], {
        env: subject.environment({}),
        encoding: 'utf8',
      })
      expect(result.stdout).toBe('script')
    },
  },
)
