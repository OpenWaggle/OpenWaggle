import { describe, expect, it, vi } from 'vitest'

vi.mock('../typed-ipc', () => ({
  typedHandle: vi.fn(),
}))

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}))

import { normalizeGitPath } from '../git'

describe('normalizeGitPath', () => {
  it('returns simple paths unchanged', () => {
    expect(normalizeGitPath('src/main/index.ts')).toBe('src/main/index.ts')
  })

  it('trims whitespace', () => {
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

  it('resolves plain => rename to the new path', () => {
    expect(normalizeGitPath('old.txt => new.txt')).toBe('new.txt')
  })

  it('resolves plain -> rename to the new path', () => {
    expect(normalizeGitPath('old.txt -> new.txt')).toBe('new.txt')
  })

  it('strips surrounding quotes', () => {
    expect(normalizeGitPath('"src/file with spaces.ts"')).toBe('src/file with spaces.ts')
  })

  it('unescapes quotes inside quoted paths', () => {
    expect(normalizeGitPath('"src/file\\"name.ts"')).toBe('src/file"name.ts')
  })

  it('returns empty string for empty input', () => {
    expect(normalizeGitPath('')).toBe('')
  })

  it('returns empty string for whitespace-only input', () => {
    expect(normalizeGitPath('   ')).toBe('')
  })

  it('handles brace rename with directory prefix', () => {
    expect(normalizeGitPath('packages/{core => ai}/index.ts')).toBe('packages/ai/index.ts')
  })

  it('handles quoted brace rename', () => {
    expect(normalizeGitPath('"src/{old name => new name}.ts"')).toBe('src/new name.ts')
  })
})
