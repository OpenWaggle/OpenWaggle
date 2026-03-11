import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const handlers = new Map<string, (...args: unknown[]) => unknown>()

vi.mock('../../runtime', () => ({
  runAppEffectExit: (effect: Effect.Effect<unknown, unknown, never>) =>
    Effect.runPromiseExit(effect),
}))

vi.mock('electron', () => ({
  app: { getVersion: () => '0.1.0-test' },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
    },
    on: vi.fn(),
  },
}))

vi.mock('../../logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
  getLogFilePath: () => '',
}))

vi.mock('../../utils/redact', () => ({
  redactSensitiveText: (v: string) => v,
}))

import { registerFeedbackHandlers } from '../feedback-handler'

describe('feedback-handler', () => {
  beforeEach(() => {
    handlers.clear()
  })

  it('registers all feedback channels', () => {
    registerFeedbackHandlers()

    expect(handlers.has('feedback:check-gh')).toBe(true)
    expect(handlers.has('feedback:collect-diagnostics')).toBe(true)
    expect(handlers.has('feedback:get-recent-logs')).toBe(true)
    expect(handlers.has('feedback:generate-markdown')).toBe(true)
    expect(handlers.has('feedback:submit')).toBe(true)
  })

  describe('feedback:collect-diagnostics', () => {
    it('returns diagnostics with expected shape', async () => {
      registerFeedbackHandlers()
      const handler = handlers.get('feedback:collect-diagnostics')
      expect(handler).toBeDefined()

      const result = await handler?.({})
      expect(result).toMatchObject({
        appVersion: '0.1.0-test',
        arch: expect.any(String),
        nodeVersion: expect.any(String),
        os: expect.any(String),
      })
      // electronVersion is undefined in non-Electron test env
      expect(result).toHaveProperty('electronVersion')
    })
  })

  describe('feedback:get-recent-logs', () => {
    it('returns empty string when no log file exists', async () => {
      registerFeedbackHandlers()
      const handler = handlers.get('feedback:get-recent-logs')
      expect(handler).toBeDefined()

      const result = await handler?.({}, 50)
      expect(result).toBe('')
    })
  })

  describe('feedback:generate-markdown', () => {
    it('generates markdown with description', async () => {
      registerFeedbackHandlers()
      const handler = handlers.get('feedback:generate-markdown')
      expect(handler).toBeDefined()

      const result = (await handler?.(
        {},
        {
          title: 'Test bug',
          description: 'Something broke',
          category: 'bug',
          includeSystemInfo: false,
          includeLogs: false,
          includeErrorContext: false,
          includeLastMessage: false,
          includeModelInfo: false,
        },
      )) as string

      expect(result).toContain('## Description')
      expect(result).toContain('Something broke')
    })

    it('includes system info when flag is set', async () => {
      registerFeedbackHandlers()
      const handler = handlers.get('feedback:generate-markdown')

      const result = (await handler?.(
        {},
        {
          title: 'Test',
          description: '',
          category: 'bug',
          includeSystemInfo: true,
          includeLogs: false,
          includeErrorContext: false,
          includeLastMessage: false,
          includeModelInfo: false,
        },
      )) as string

      expect(result).toContain('## System Info')
      expect(result).toContain('App Version')
    })

    it('includes error context when provided', async () => {
      registerFeedbackHandlers()
      const handler = handlers.get('feedback:generate-markdown')

      const result = (await handler?.(
        {},
        {
          title: 'Error report',
          description: '',
          category: 'bug',
          includeSystemInfo: false,
          includeLogs: false,
          includeErrorContext: true,
          includeLastMessage: false,
          includeModelInfo: false,
          lastErrorContext: {
            code: 'rate-limited',
            message: 'Too many requests',
            userMessage: 'Rate limited',
            suggestion: 'Wait and retry',
            retryable: true,
          },
        },
      )) as string

      expect(result).toContain('## Error Context')
      expect(result).toContain('rate-limited')
      expect(result).toContain('Too many requests')
    })

    it('includes model info when provided', async () => {
      registerFeedbackHandlers()
      const handler = handlers.get('feedback:generate-markdown')

      const result = (await handler?.(
        {},
        {
          title: 'Test',
          description: '',
          category: 'feature',
          includeSystemInfo: false,
          includeLogs: false,
          includeErrorContext: false,
          includeLastMessage: false,
          includeModelInfo: true,
          activeModel: 'claude-sonnet-4-20250514',
          activeProvider: 'anthropic',
        },
      )) as string

      expect(result).toContain('## Model Info')
      expect(result).toContain('claude-sonnet-4-20250514')
      expect(result).toContain('anthropic')
    })
  })
})
