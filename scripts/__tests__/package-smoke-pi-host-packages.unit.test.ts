import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { assertPiHostPackagesArePeers } from '../package-smoke-runtime-assertions'

describe("a Pi package's host-provided dependencies", () => {
  it('accepts Pi SDKs and typebox declared as "*" peers', () => {
    expect(() =>
      assertPiHostPackagesArePeers('@openwaggle/pi-waggle', {
        pi: { extensions: ['./dist/extension.js'] },
        dependencies: { '@openwaggle/waggle-core': '^0.1.1' },
        peerDependencies: { '@earendil-works/pi-coding-agent': '*', typebox: '*' },
      }),
    ).not.toThrow()
  })

  it('rejects a host package installed as a dependency, which Pi warns about on start', () => {
    expect(() =>
      assertPiHostPackagesArePeers('@openwaggle/pi-waggle', {
        pi: { extensions: ['./dist/extension.js'] },
        dependencies: { typebox: '1.3.32' },
      }),
    ).toThrow('typebox is in dependencies')
  })

  it('rejects a host peer narrower than "*"', () => {
    expect(() =>
      assertPiHostPackagesArePeers('@openwaggle/pi-waggle', {
        pi: { extensions: ['./dist/extension.js'] },
        peerDependencies: { '@earendil-works/pi-tui': '^1.4.0' },
      }),
    ).toThrow('@earendil-works/pi-tui peer range is ^1.4.0, not "*"')
  })

  it('ignores packages that are not Pi packages', () => {
    expect(() =>
      assertPiHostPackagesArePeers('@openwaggle/waggle-core', { dependencies: { typebox: '1.3.32' } }),
    ).not.toThrow()
  })

  it('holds for the pi-waggle manifest in the repository', () => {
    const manifest: unknown = JSON.parse(readFileSync('packages/pi-waggle/package.json', 'utf8'))
    expect(() => assertPiHostPackagesArePeers('@openwaggle/pi-waggle', manifest)).not.toThrow()
  })
})
