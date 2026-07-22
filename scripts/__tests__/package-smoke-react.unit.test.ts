import { describe, expect, it } from 'vitest'
import {
  assertReactPeerDependencies,
  supportsPackageSmokeNodeVersion,
} from '../package-smoke-runtime-assertions'

describe('React package consumer contract', () => {
  it('requires React to remain a runtime peer and accepts supported Node versions', () => {
    expect(() =>
      assertReactPeerDependencies({
        peerDependencies: { react: '^19.0.0', 'react-dom': '^19.0.0' },
      }),
    ).not.toThrow()
    expect(supportsPackageSmokeNodeVersion('22.19.0')).toBe(true)
    expect(supportsPackageSmokeNodeVersion('24.0.0')).toBe(true)
    expect(supportsPackageSmokeNodeVersion('22.18.9')).toBe(false)
    expect(supportsPackageSmokeNodeVersion('21.99.0')).toBe(false)
  })

  it('rejects React as a bundled runtime dependency', () => {
    expect(() =>
      assertReactPeerDependencies({
        dependencies: { react: '^19.0.0' },
        peerDependencies: { 'react-dom': '^19.0.0' },
      }),
    ).toThrow('must declare react as a peer dependency')
  })
})
