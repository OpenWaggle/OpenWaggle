import { describe, expect, it } from 'vitest'
import { createSmokePackageJson } from '../package-smoke'
import { piRuntimeSmokePins, smokePnpmWorkspaceConfig } from '../package-smoke-runtime-assertions'

describe('package smoke Pi release pins', () => {
  it('pins every package of the Pi release the app is built on', () => {
    const workspace = `catalogs:\n  pi-runtime:\n    "@earendil-works/pi-ai": 1.0.4\n    "@earendil-works/pi-coding-agent": 1.0.4\n`
    expect(piRuntimeSmokePins(workspace)).toEqual({
      '@earendil-works/chord': '1.0.4',
      '@earendil-works/pi-ai': '1.0.4',
      '@earendil-works/pi-coding-agent': '1.0.4',
    })
  })

  it('overrides the Pi release in the consumer manifest, so a newer Pi cannot be mixed in', () => {
    const registryDependencies = [
      '@earendil-works/pi-ai',
      '@earendil-works/pi-coding-agent',
      '@earendil-works/pi-tui',
      '@types/node',
      '@types/react',
      '@types/react-dom',
      'react',
      'react-dom',
      'tsx',
      'typescript',
      'vite',
    ].map((name) => ({ name, version: '1.0.0' }))
    const manifest = createSmokePackageJson([], registryDependencies, {
      '@earendil-works/pi-agent-core': '1.0.4',
    })
    expect(manifest.overrides).toEqual({ '@earendil-works/pi-agent-core': '1.0.4' })
    expect(manifest.resolutions).toEqual({ '@earendil-works/pi-agent-core': '1.0.4' })
  })

  it('pins the Pi release and the packed tarballs in the consumer pnpm workspace', () => {
    expect(
      smokePnpmWorkspaceConfig({ '@earendil-works/pi-ai': '1.0.4' }, [
        { name: '@openwaggle/pi-waggle', tarballPath: '/tmp/pi-waggle.tgz' },
      ]),
    ).toBe(
      'packages: []\n\noverrides:\n  "@earendil-works/pi-ai": "1.0.4"\n  "@openwaggle/pi-waggle": "file:/tmp/pi-waggle.tgz"\n',
    )
  })
})
