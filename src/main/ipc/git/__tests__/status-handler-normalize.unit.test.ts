import { describe, expect, it } from 'vitest'
import { normalizeGitPath } from '../status-parse'

describe('normalizeGitPath', () => {
  it.each([
    ['', ''],
    ['   ', ''],
    ['src/main/index.ts', 'src/main/index.ts'],
    ['  src/main/index.ts  ', 'src/main/index.ts'],
    ['src/{old => new}.ts', 'src/new.ts'],
    ['src/{components/old => components/new}/file.ts', 'src/components/new/file.ts'],
    ['src/{ => new}/file.ts', 'src/new/file.ts'],
    /*
     * git compacts a rename that removes a path component this way. Verified against real git: moving
     * `src/old/file.ts` to `src/file.ts` produces `src/{old => }/file.ts` in numstat, and the porcelain
     * path is `src/file.ts`. This used to assert `src//file.ts`, which matches no porcelain entry, so the
     * numstat stats were attached to a phantom file instead of the one that changed.
     */
    ['src/{old => }/file.ts', 'src/file.ts'],
    ['"src/{old => new}.ts"', 'src/new.ts'],
    ['"src/{old name => new name}.ts"', 'src/new name.ts'],
    ['old.txt => new.txt', 'new.txt'],
    ['"old file.txt" => "new file.txt"', 'new file.txt'],
    ['"old.txt" => "new.txt"', 'new.txt'],
    ['a => b => c.txt', 'c.txt'],
    ['old.txt -> new.txt', 'new.txt'],
    ['a -> b -> c.txt', 'c.txt'],
    // `=>` wins over `->` when both appear.
    ['a => b -> c.txt', 'b -> c.txt'],
    ['"src/file.txt"', 'src/file.txt'],
    // Only double quotes at both ends are git's quoting.
    ["'src/file.txt'", "'src/file.txt'"],
    ['"src/file.txt', '"src/file.txt'],
    ['"src/file\\"name.ts"', 'src/file"name.ts'],
  ])('normalizes %j to %j', (input, expected) => {
    expect(normalizeGitPath(input)).toBe(expected)
  })
})
