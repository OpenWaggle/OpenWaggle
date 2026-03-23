import { describe, expect, it } from 'vitest'
import {
  deriveCommandPattern,
  deriveWebFetchPattern,
  normalizeCommand,
} from '../tool-trust-patterns'

describe('normalizeCommand', () => {
  it('trims and collapses whitespace', () => {
    expect(normalizeCommand('  pnpm   test  ')).toBe('pnpm test')
  })

  it('returns empty string for blank input', () => {
    expect(normalizeCommand('   ')).toBe('')
  })
})

describe('deriveCommandPattern', () => {
  it('returns null for empty command', () => {
    expect(deriveCommandPattern('')).toBeNull()
  })

  it('uses 2-token prefix for pnpm', () => {
    expect(deriveCommandPattern('pnpm test:unit')).toBe('pnpm test:unit*')
  })

  it('uses 2-token prefix for git', () => {
    expect(deriveCommandPattern('git commit -m "msg"')).toBe('git commit*')
  })

  it('uses 1-token prefix for unknown commands', () => {
    expect(deriveCommandPattern('cargo build --release')).toBe('cargo*')
  })

  it('uses 1-token prefix for python', () => {
    expect(deriveCommandPattern('python script.py')).toBe('python*')
  })

  it('handles single-token command', () => {
    expect(deriveCommandPattern('ls')).toBe('ls*')
  })

  it('handles pnpm with only one token', () => {
    expect(deriveCommandPattern('pnpm')).toBe('pnpm*')
  })
})

describe('deriveWebFetchPattern', () => {
  it('returns null for non-http URLs', () => {
    expect(deriveWebFetchPattern('ftp://example.com')).toBeNull()
  })

  it('returns origin/* for root path', () => {
    expect(deriveWebFetchPattern('https://example.com')).toBe('https://example.com/*')
  })

  it('returns first path segment wildcard', () => {
    expect(deriveWebFetchPattern('https://api.example.com/v1/users?page=1')).toBe(
      'https://api.example.com/v1/*',
    )
  })

  it('handles http URLs', () => {
    expect(deriveWebFetchPattern('http://localhost:3000/api/data')).toBe(
      'http://localhost:3000/api/*',
    )
  })

  it('returns null for invalid URLs', () => {
    expect(deriveWebFetchPattern('not a url')).toBeNull()
  })
})
