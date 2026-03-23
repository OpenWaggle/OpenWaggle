import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ActiveRunManager } from '../active-run-manager'

interface TestMetadata {
  label: string
  count: number
}

describe('ActiveRunManager', () => {
  let manager: ActiveRunManager<string, TestMetadata>

  beforeEach(() => {
    manager = new ActiveRunManager()
  })

  describe('register', () => {
    it('adds an entry', () => {
      const controller = new AbortController()
      manager.register('run-1', controller, { label: 'test', count: 0 })

      expect(manager.has('run-1')).toBe(true)
    })

    it('overwrites existing entry with same key', () => {
      const controller1 = new AbortController()
      const controller2 = new AbortController()
      manager.register('run-1', controller1, { label: 'first', count: 1 })
      manager.register('run-1', controller2, { label: 'second', count: 2 })

      const entry = manager.get('run-1')
      expect(entry?.metadata.label).toBe('second')
      expect(entry?.controller).toBe(controller2)
    })
  })

  describe('get', () => {
    it('returns the entry when present', () => {
      const controller = new AbortController()
      manager.register('run-1', controller, { label: 'test', count: 5 })

      const entry = manager.get('run-1')
      expect(entry).toBeDefined()
      expect(entry?.controller).toBe(controller)
      expect(entry?.metadata.label).toBe('test')
      expect(entry?.metadata.count).toBe(5)
    })

    it('returns undefined for missing key', () => {
      expect(manager.get('nonexistent')).toBeUndefined()
    })
  })

  describe('has', () => {
    it('returns true when entry exists', () => {
      manager.register('run-1', new AbortController(), { label: 'test', count: 0 })
      expect(manager.has('run-1')).toBe(true)
    })

    it('returns false when entry does not exist', () => {
      expect(manager.has('nonexistent')).toBe(false)
    })
  })

  describe('cancel', () => {
    it('aborts the controller and removes the entry', () => {
      const controller = new AbortController()
      const abortSpy = vi.spyOn(controller, 'abort')
      manager.register('run-1', controller, { label: 'test', count: 0 })

      const result = manager.cancel('run-1')

      expect(result).toBe(true)
      expect(abortSpy).toHaveBeenCalledOnce()
      expect(manager.has('run-1')).toBe(false)
    })

    it('returns false for missing key', () => {
      expect(manager.cancel('nonexistent')).toBe(false)
    })
  })

  describe('cancelAll', () => {
    it('cancels all entries when no predicate', () => {
      const c1 = new AbortController()
      const c2 = new AbortController()
      const spy1 = vi.spyOn(c1, 'abort')
      const spy2 = vi.spyOn(c2, 'abort')
      manager.register('run-1', c1, { label: 'a', count: 0 })
      manager.register('run-2', c2, { label: 'b', count: 0 })

      manager.cancelAll()

      expect(spy1).toHaveBeenCalledOnce()
      expect(spy2).toHaveBeenCalledOnce()
      expect(manager.has('run-1')).toBe(false)
      expect(manager.has('run-2')).toBe(false)
    })

    it('cancels only matching entries when predicate provided', () => {
      const c1 = new AbortController()
      const c2 = new AbortController()
      const spy1 = vi.spyOn(c1, 'abort')
      const spy2 = vi.spyOn(c2, 'abort')
      manager.register('run-1', c1, { label: 'cancel-me', count: 0 })
      manager.register('run-2', c2, { label: 'keep-me', count: 0 })

      manager.cancelAll((entry) => entry.metadata.label === 'cancel-me')

      expect(spy1).toHaveBeenCalledOnce()
      expect(spy2).not.toHaveBeenCalled()
      expect(manager.has('run-1')).toBe(false)
      expect(manager.has('run-2')).toBe(true)
    })
  })

  describe('delete', () => {
    it('removes without aborting', () => {
      const controller = new AbortController()
      const abortSpy = vi.spyOn(controller, 'abort')
      manager.register('run-1', controller, { label: 'test', count: 0 })

      manager.delete('run-1')

      expect(abortSpy).not.toHaveBeenCalled()
      expect(manager.has('run-1')).toBe(false)
    })

    it('does nothing for missing key', () => {
      manager.delete('nonexistent')
      expect(manager.has('nonexistent')).toBe(false)
    })
  })

  describe('metadata mutation', () => {
    it('allows in-place mutation of metadata via get()', () => {
      manager.register('run-1', new AbortController(), { label: 'initial', count: 0 })

      const entry = manager.get('run-1')
      if (entry) {
        entry.metadata.count = 42
        entry.metadata.label = 'mutated'
      }

      const updated = manager.get('run-1')
      expect(updated?.metadata.count).toBe(42)
      expect(updated?.metadata.label).toBe('mutated')
    })
  })

  describe('keys', () => {
    it('returns all registered keys', () => {
      manager.register('a', new AbortController(), { label: 'a', count: 0 })
      manager.register('b', new AbortController(), { label: 'b', count: 0 })

      const keys = [...manager.keys()]
      expect(keys).toEqual(['a', 'b'])
    })

    it('returns empty iterator when no entries', () => {
      expect([...manager.keys()]).toEqual([])
    })
  })
})
