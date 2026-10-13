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

  it('writes error data into the line, so a text log shows it rather than [object Object]', () => {
    const logger = createRendererLogger('db')
    logger.error('failed', { reason: 'timeout' })
    expect(console.error).toHaveBeenCalledWith('[db] failed {"reason":"timeout"}')
  })

  it('reads errors and structured failures in warn and error data', () => {
    const logger = createRendererLogger('composer')
    logger.error('Composer send failed', {
      error: new Error('Unknown model: qa-router/auto'),
      cause: { code: 'invalid-model', message: 'Unknown model: qa-router/auto' },
    })
    const circular: Record<string, unknown> = { reason: 'loop' }
    circular.self = circular
    logger.warn('retrying', circular)

    expect(console.error).toHaveBeenCalledWith(
      '[composer] Composer send failed {"error":"Error: Unknown model: qa-router/auto","cause":{"code":"invalid-model","message":"Unknown model: qa-router/auto"}}',
    )
    expect(console.warn).toHaveBeenCalledWith(
      '[composer] retrying {"reason":"loop","self":"[Circular]"}',
    )
    expect(String(vi.mocked(console.error).mock.calls[0])).not.toContain('[object Object]')
  })

  it('passes debug and info data without eager serialization', () => {
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
