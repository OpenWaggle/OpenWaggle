import { fromAny } from '@total-typescript/shoehorn'
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

      const result = fromAny<string, unknown>(
        await handler?.(
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
        ),
      )

      expect(result).toContain('## Description')
      expect(result).toContain('Something broke')
    })

    it('includes system info when flag is set', async () => {
      registerFeedbackHandlers()
      const handler = handlers.get('feedback:generate-markdown')

      const result = fromAny<string, unknown>(
        await handler?.(
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
        ),
      )

      expect(result).toContain('## System Info')
      expect(result).toContain('App Version')
    })

    it('includes error context when provided', async () => {
      registerFeedbackHandlers()
      const handler = handlers.get('feedback:generate-markdown')

      const result = fromAny<string, unknown>(
        await handler?.(
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
        ),
      )

      expect(result).toContain('## Error Context')
      expect(result).toContain('rate-limited')
      expect(result).toContain('Too many requests')
    })

    // Raw error detail can carry provider output; it is redacted before it can reach an issue.
    it('redacts credentials in the raw error before it reaches the report', async () => {
      registerFeedbackHandlers()
      const handler = handlers.get('feedback:generate-markdown')

      const result = fromAny<string, unknown>(
        await handler?.(
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
              code: 'unknown',
              message:
                'upstream said: Authorization: Bearer abcdef0123456789secret ANTHROPIC_API_KEY=abcdef1234567890 API key: xyz9876543210',
              userMessage: 'Something went wrong',
              retryable: true,
            },
          },
        ),
      )

      expect(result).not.toContain('abcdef0123456789secret')
      expect(result).toContain('Bearer [REDACTED_TOKEN]')
      expect(result).not.toContain('abcdef1234567890')
      expect(result).not.toContain('xyz9876543210')
    })

    it('includes model info when provided', async () => {
      registerFeedbackHandlers()
      const handler = handlers.get('feedback:generate-markdown')

      const result = fromAny<string, unknown>(
        await handler?.(
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
        ),
      )

      expect(result).toContain('## Model Info')
      expect(result).toContain('claude-sonnet-4-20250514')
      expect(result).toContain('anthropic')
    })
  })
})
