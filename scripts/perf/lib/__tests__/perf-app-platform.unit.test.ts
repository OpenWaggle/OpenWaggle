import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolvePerfApp } from '../perf-app'

/** R6 P3-9: the perf harnesses are macOS-only and say so before they launch anything. */
describe('perf harness platform', () => {
  it.each(['linux', 'win32'] as const)('refuses to resolve an app on %s', (platform) => {
    expect(() => resolvePerfApp('/Applications/OpenWaggle.app', 'app', platform)).toThrow(/macOS only/)
  })

  it('resolves a packaged app on macOS', () => {
    expect(resolvePerfApp('/Applications/OpenWaggle.app', 'app', 'darwin')).toEqual({
      label: 'app',
      executable: path.join('/Applications/OpenWaggle.app', 'Contents', 'MacOS', 'OpenWaggle'),
      leadingArguments: [],
    })
  })
})
