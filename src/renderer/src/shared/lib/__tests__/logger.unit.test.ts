import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRendererLogger } from '../logger'

describe('createRendererLogger', () => {
  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('prefixes info messages with the namespace', () => {
    const logger = createRendererLogger('TestModule')
    logger.info('hello')
    expect(console.info).toHaveBeenCalledWith('[TestModule] hello')
  })

  it('appends serialized data to info messages', () => {
    const logger = createRendererLogger('app')
    logger.info('loaded', { count: 5 })
    expect(console.info).toHaveBeenCalledWith('[app] loaded', { count: 5 })
  })

  it('routes warn calls to console.warn', () => {
    const logger = createRendererLogger('net')
    logger.warn('timeout')
    expect(console.warn).toHaveBeenCalledWith('[net] timeout')
  })

  it('routes error calls to console.error with data', () => {
    const logger = createRendererLogger('db')
    logger.error('failed', { reason: 'timeout' })
    expect(console.error).toHaveBeenCalledWith('[db] failed', { reason: 'timeout' })
  })

  it('passes structured data without eager serialization', () => {
    const logger = createRendererLogger('cycle')
    const circular: Record<string, unknown> = {}
    circular.self = circular
    logger.info('oops', circular)
    expect(console.info).toHaveBeenCalledWith('[cycle] oops', circular)
  })

  it('omits data suffix when data is undefined', () => {
    const logger = createRendererLogger('ns')
    logger.warn('bare message')
    expect(console.warn).toHaveBeenCalledWith('[ns] bare message')
  })
})
