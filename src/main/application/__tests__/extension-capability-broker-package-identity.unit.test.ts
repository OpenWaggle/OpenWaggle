import { describe, expect, it } from 'vitest'
import { entryMatchesPackage } from '../extension-capability-broker-model'
import { makeBrokerPackage } from './extension-capability-broker-test-utils'
import {
  expectFirstEntry,
  loadRegistry,
  makeLifecycle,
  PROJECT_PATH,
} from './extension-contribution-registry-test-utils'

describe('extension capability broker package identity', () => {
  it('does not authorize a registry entry after the package content changes', async () => {
    const originalPackage = makeBrokerPackage()
    const registry = await loadRegistry({
      packages: [originalPackage],
      lifecycles: [makeLifecycle(originalPackage)],
      projectPaths: [PROJECT_PATH],
    })
    const entry = expectFirstEntry(registry)
    const changedPackage = { ...originalPackage, contentHash: 'changed-content-hash' }

    expect(entryMatchesPackage(entry, originalPackage)).toBe(true)
    expect(entryMatchesPackage(entry, changedPackage)).toBe(false)
  })
})
