import { describe, expect, it } from 'vitest'
import { formatToolActivity } from '../tool-activity'

describe('formatToolActivity', () => {
  describe('known tools with primary args', () => {
    it('formats readFile with path', () => {
      const result = formatToolActivity('readFile', { path: '/src/index.ts' })
      expect(result).toBe('Read /src/index.ts')
    })

    it('formats writeFile with path', () => {
      const result = formatToolActivity('writeFile', { path: '/src/new-file.ts' })
      expect(result).toBe('Wrote /src/new-file.ts')
    })

    it('formats editFile with path', () => {
      const result = formatToolActivity('editFile', { path: '/src/edit.ts' })
      expect(result).toBe('Edited /src/edit.ts')
    })

    it('formats runCommand with backtick-wrapped command', () => {
      const result = formatToolActivity('runCommand', { command: 'pnpm test' })
      expect(result).toBe('Ran `pnpm test`')
    })

    it('formats glob with pattern', () => {
      const result = formatToolActivity('glob', { pattern: '**/*.ts' })
      expect(result).toBe('Searched **/*.ts')
    })

    it('formats listFiles with path', () => {
      const result = formatToolActivity('listFiles', { path: '/src' })
      expect(result).toBe('Listed /src')
    })

    it('formats webFetch with url', () => {
      const result = formatToolActivity('webFetch', { url: 'https://example.com' })
      expect(result).toBe('Fetched https://example.com')
    })
  })

  describe('unknown tools', () => {
    it('returns null for unknown tool even with path arg (no primary arg mapping)', () => {
      const result = formatToolActivity('customTool', { path: '/foo' })
      expect(result).toBeNull()
    })

    it('returns null for unknown tool with arbitrary args', () => {
      const result = formatToolActivity('customTool', { foo: 'bar' })
      expect(result).toBeNull()
    })
  })

  describe('edge cases', () => {
    it('returns null when toolInput is undefined', () => {
      const result = formatToolActivity('readFile', undefined)
      expect(result).toBeNull()
    })

    it('returns null when primary arg value is not a string', () => {
      const result = formatToolActivity('readFile', { path: 42 })
      expect(result).toBeNull()
    })

    it('returns null when primary arg is missing from input', () => {
      const result = formatToolActivity('readFile', { otherKey: 'value' })
      expect(result).toBeNull()
    })

    it('returns null when toolInput is an empty object', () => {
      const result = formatToolActivity('readFile', {})
      expect(result).toBeNull()
    })

    it('returns null for known tool with boolean primary arg', () => {
      const result = formatToolActivity('writeFile', { path: true })
      expect(result).toBeNull()
    })

    it('returns null for known tool with null primary arg', () => {
      const result = formatToolActivity('glob', { pattern: null })
      expect(result).toBeNull()
    })
  })
})
