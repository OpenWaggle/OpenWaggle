import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'

// commit-handler reaches Electron transitively; only the path rule is under test.
vi.mock('electron', () => ({
  app: { getPath: () => tmpdir(), getName: () => 'openwaggle-test' },
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: { handle: vi.fn(), on: vi.fn() },
}))

const { hasCaseOnlyComponentForTests } = await import('../commit-handler')

/**
 * On a case-insensitive filesystem a component whose case alone changed cannot be committed through a pathspec:
 * git's matching resolves the new spelling onto the old index entry, `add` and `commit` both exit 0, and the
 * rename is silently left out of the commit. Pinned here without a filesystem, so the rule holds on both the
 * case-insensitive machines this is developed on and the case-sensitive ones it is tested on.
 */
describe('renames a case-insensitive filesystem cannot express', () => {
  it('recognises a case-only file name', () => {
    expect(hasCaseOnlyComponentForTests({ from: 'readme.md', to: 'README.md' })).toBe(true)
  })

  it('recognises a case-only directory component', () => {
    expect(hasCaseOnlyComponentForTests({ from: 'Utils/helper.ts', to: 'utils/helper.ts' })).toBe(
      true,
    )
  })

  it('recognises a directory whose case changed while the file was also renamed', () => {
    // Comparing whole paths missed this, and it is the same silent omission.
    expect(
      hasCaseOnlyComponentForTests({
        from: 'components/button.tsx',
        to: 'Components/PrimaryButton.tsx',
      }),
    ).toBe(true)
  })

  it('leaves ordinary renames and moves alone', () => {
    expect(hasCaseOnlyComponentForTests({ from: 'a/one.ts', to: 'a/two.ts' })).toBe(false)
    expect(hasCaseOnlyComponentForTests({ from: 'alpha/f.ts', to: 'beta/f.ts' })).toBe(false)
    expect(hasCaseOnlyComponentForTests({ from: 'a/b/f.ts', to: 'a/f.ts' })).toBe(false)
    expect(hasCaseOnlyComponentForTests({ from: 'same.ts', to: 'same.ts' })).toBe(false)
  })
})
