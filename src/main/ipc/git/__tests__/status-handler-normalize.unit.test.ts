import { describe, expect, it, vi } from 'vitest'

vi.mock('../../typed-ipc', () => ({
  typedHandle: vi.fn(),
}))

import { normalizeGitPath } from '../status-handler'

describe('normalizeGitPath', () => {
  it('returns empty string for empty input', () => {
    expect(normalizeGitPath('')).toBe('')
  })

  it('returns empty string for whitespace-only input', () => {
    expect(normalizeGitPath('   ')).toBe('')
  })

  it('returns a simple path unchanged', () => {
    expect(normalizeGitPath('src/main/index.ts')).toBe('src/main/index.ts')
  })

  it('trims surrounding whitespace from a simple path', () => {
    expect(normalizeGitPath('  src/main/index.ts  ')).toBe('src/main/index.ts')
  })

  it('resolves brace rename to the new path', () => {
    expect(normalizeGitPath('src/{old => new}.ts')).toBe('src/new.ts')
  })

  it('resolves nested brace rename', () => {
    expect(normalizeGitPath('src/{components/old => components/new}/file.ts')).toBe(
      'src/components/new/file.ts',
    )
  })

  it('resolves brace rename with empty old side', () => {
    expect(normalizeGitPath('src/{ => new}/file.ts')).toBe('src/new/file.ts')
  })

  it('resolves brace rename with empty new side', () => {
    expect(normalizeGitPath('src/{old => }/file.ts')).toBe('src//file.ts')
  })

  it('resolves brace rename with surrounding quotes', () => {
    expect(normalizeGitPath('"src/{old => new}.ts"')).toBe('src/new.ts')
  })

  it('resolves plain => rename to the new path', () => {
    expect(normalizeGitPath('old.txt => new.txt')).toBe('new.txt')
  })

  it('resolves plain => rename with spaces in filenames', () => {
    expect(normalizeGitPath('"old file.txt" => "new file.txt"')).toBe('new file.txt')
  })

  it('resolves => rename with multiple arrows', () => {
    expect(normalizeGitPath('a => b => c.txt')).toBe('c.txt')
  })

  it('resolves plain -> rename to the new path', () => {
    expect(normalizeGitPath('old.txt -> new.txt')).toBe('new.txt')
  })

  it('resolves -> rename with multiple arrows', () => {
    expect(normalizeGitPath('a -> b -> c.txt')).toBe('c.txt')
  })

  it('prefers => over -> when both appear', () => {
    expect(normalizeGitPath('a => b -> c.txt')).toBe('b -> c.txt')
  })

  it('strips surrounding double quotes from a simple path', () => {
    expect(normalizeGitPath('"src/file.txt"')).toBe('src/file.txt')
  })

  it('does not strip single quotes', () => {
    expect(normalizeGitPath("'src/file.txt'")).toBe("'src/file.txt'")
  })

  it('does not strip quotes that are not at both ends', () => {
    expect(normalizeGitPath('"src/file.txt')).toBe('"src/file.txt')
  })

  it('strips quotes from the result of a rename', () => {
    expect(normalizeGitPath('"old.txt" => "new.txt"')).toBe('new.txt')
  })
})
