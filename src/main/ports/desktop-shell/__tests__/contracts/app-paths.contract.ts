import path from 'node:path'
import { expect } from 'vitest'
import { definePortContract } from './port-contract'
import type { AppPathsShape } from '../../app-paths'

export interface AppPathsContractHarness {
  readonly subject: AppPathsShape
  /** This build's `userData` before any relocation: the canonical one, or the Dev build's own. */
  readonly buildUserData: string
}

export const appPathsContract = definePortContract<AppPathsContractHarness>('AppPaths', {
  'resolves absolute directories, with userData inside appData': async ({
    subject,
    buildUserData,
  }) => {
    subject.applyBuildIdentity()
    for (const directory of [subject.userData(), subject.logs(), subject.appData()]) {
      expect(path.isAbsolute(directory)).toBe(true)
    }
    expect(subject.userData()).toBe(buildUserData)
    expect(path.relative(subject.appData(), subject.userData()).startsWith('..')).toBe(false)
    expect(path.isAbsolute(subject.appRoot())).toBe(true)
    expect(path.isAbsolute(subject.resources())).toBe(true)
  },

  'relocates userData and logs for this process': async ({ subject }) => {
    subject.setUserData('/relocated/profile')
    subject.setLogs('/relocated/profile/logs')
    expect(subject.userData()).toBe('/relocated/profile')
    expect(subject.logs()).toBe('/relocated/profile/logs')
  },
})
