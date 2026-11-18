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

  it('registers an entry and replaces the one registered under the same key', () => {
    const controller1 = new AbortController()
    const controller2 = new AbortController()
    manager.register('run-1', controller1, { label: 'first', count: 1 })
    expect(manager.has('run-1')).toBe(true)
    expect(manager.get('run-1')?.controller).toBe(controller1)

    manager.register('run-1', controller2, { label: 'second', count: 2 })

    const entry = manager.get('run-1')
    expect(entry?.metadata).toEqual({ label: 'second', count: 2 })
    expect(entry?.controller).toBe(controller2)
  })

  it('treats an unknown key as absent for get, has, cancel and delete', () => {
    manager.delete('nonexistent')

    expect(manager.get('nonexistent')).toBeUndefined()
    expect(manager.has('nonexistent')).toBe(false)
    expect(manager.cancel('nonexistent')).toBe(false)
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
      expect(manager.hasUnsettled('run-1')).toBe(true)

      expect(manager.deleteIfCurrent('run-1', controller)).toBe(false)
      expect(manager.hasUnsettled('run-1')).toBe(false)
    })

    it('settles when abort dispatch synchronously finishes the owning run', () => {
      const controller = new AbortController()
      manager.register('run-1', controller, { label: 'test', count: 0 })
      controller.signal.addEventListener('abort', () => {
        manager.deleteIfCurrent('run-1', controller)
      })

      expect(manager.cancel('run-1')).toBe(true)
      expect(manager.hasUnsettled('run-1')).toBe(false)
    })
  })

  describe('settlement', () => {
    it('keeps a cancelled run unsettled until its exact controller finishes', () => {
      const cancelled = new AbortController()
      const replacement = new AbortController()
      manager.register('run-1', cancelled, { label: 'cancelled', count: 0 })
      manager.cancel('run-1')
      manager.register('run-1', replacement, { label: 'replacement', count: 1 })

      expect(manager.deleteIfCurrent('run-1', cancelled)).toBe(false)
      expect(manager.get('run-1')?.controller).toBe(replacement)
      expect(manager.hasUnsettled('run-1')).toBe(true)

      expect(manager.deleteIfCurrent('run-1', replacement)).toBe(true)
      expect(manager.hasUnsettled('run-1')).toBe(false)
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

  it('removes an entry without aborting it', () => {
    const controller = new AbortController()
    const abortSpy = vi.spyOn(controller, 'abort')
    manager.register('run-1', controller, { label: 'test', count: 0 })

    manager.delete('run-1')

    expect(abortSpy).not.toHaveBeenCalled()
    expect(manager.has('run-1')).toBe(false)
  })

  it('lists the registered keys in registration order', () => {
    expect([...manager.keys()]).toEqual([])
    manager.register('a', new AbortController(), { label: 'a', count: 0 })
    manager.register('b', new AbortController(), { label: 'b', count: 0 })

    expect([...manager.keys()]).toEqual(['a', 'b'])
  })
})
