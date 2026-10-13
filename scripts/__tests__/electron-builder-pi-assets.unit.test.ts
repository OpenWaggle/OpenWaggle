import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  forceIncludePiPackageAsset,
  missingPackagedPiAssets,
  PACKAGED_PI_ASSET_ENTRIES,
} from '../electron-builder-pi-assets'

const PI_PACKAGE = path.join(
  '/repo/node_modules/.pnpm/@earendil-works+pi-coding-agent@1.2.0_patch_hash=abc/node_modules',
  '@earendil-works',
  'pi-coding-agent',
)

describe("packaging Pi's own documentation", () => {
  it("force-includes the top-level files electron-builder drops from every module, for Pi only", () => {
    expect(forceIncludePiPackageAsset(path.join(PI_PACKAGE, 'README.md'))).toBe(true)
    expect(forceIncludePiPackageAsset(path.join(PI_PACKAGE, 'examples'))).toBe(true)
    expect(forceIncludePiPackageAsset(path.join(PI_PACKAGE, 'docs'))).toBe(true)
    expect(forceIncludePiPackageAsset(path.join(PI_PACKAGE, 'dist'))).toBe(false)
    expect(forceIncludePiPackageAsset('/repo/node_modules/.pnpm/x/node_modules/left-pad/README.md')).toBe(
      false,
    )
    expect(forceIncludePiPackageAsset(path.join(PI_PACKAGE, 'examples', 'README.md'))).toBe(false)
  })

  it('names every Pi asset missing from a packaged asar file list', () => {
    const complete = PACKAGED_PI_ASSET_ENTRIES.map((entry) => entry)

    expect(missingPackagedPiAssets(complete)).toEqual([])
    expect(
      missingPackagedPiAssets(
        complete.filter((entry) => !entry.endsWith('/README.md') && !entry.endsWith('/examples')),
      ),
    ).toEqual([
      '/node_modules/@earendil-works/pi-coding-agent/README.md',
      '/node_modules/@earendil-works/pi-coding-agent/examples',
    ])
  })
})
