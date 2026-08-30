import { describe, expect, it } from 'vitest'
import {
  SESSION_QUERY_MAX_CURSOR_LENGTH,
  SESSION_QUERY_MAX_PATH_LENGTH,
  SESSION_QUERY_MAX_SEARCH_LENGTH,
} from '../../types/session-query'
import { decodeLocalSessionCommandPayload } from '../local-session-protocol'
import { decodeSessionQueryRequest } from '../session-query'

describe('Session query v2 boundary', () => {
  it('decodes explicit full-transcript search through the Local Host envelope', () => {
    expect(
      decodeLocalSessionCommandPayload({
        contract: 'session-query-v2',
        request: {
          contractVersion: 2,
          requestId: 'query-1',
          query: {
            operation: 'search',
            query: 'socket ownership',
            limit: 25,
            searchScope: 'full-transcript',
          },
        },
      }),
    ).toEqual({
      contract: 'session-query-v2',
      request: {
        contractVersion: 2,
        requestId: 'query-1',
        query: {
          operation: 'search',
          query: 'socket ownership',
          limit: 25,
          searchScope: 'full-transcript',
        },
      },
    })
  })

  it('rejects unknown query fields instead of silently accepting schema drift', () => {
    expect(() =>
      decodeSessionQueryRequest({
        contractVersion: 2,
        requestId: 'query-2',
        query: { operation: 'read', sessionId: 'session-1', unexpected: true },
      }),
    ).toThrow(/unexpected/)
  })

  it('requires bounded positive page sizes', () => {
    expect(() =>
      decodeSessionQueryRequest({
        contractVersion: 2,
        requestId: 'query-3',
        query: { operation: 'items', sessionId: 'session-1', limit: 0 },
      }),
    ).toThrow(/limit/)
    expect(() =>
      decodeSessionQueryRequest({
        contractVersion: 2,
        requestId: 'query-4',
        query: { operation: 'items', sessionId: 'session-1', limit: 501 },
      }),
    ).toThrow(/limit/)
  })

  it('bounds search text, cursors, and paths before repository work', () => {
    const decodeSearch = (overrides: Record<string, unknown>) =>
      decodeSessionQueryRequest({
        contractVersion: 2,
        requestId: 'bounded-search',
        query: { operation: 'search', query: 'q', limit: 1, ...overrides },
      })

    expect(() =>
      decodeSearch({
        query: 'q'.repeat(SESSION_QUERY_MAX_SEARCH_LENGTH),
        cursor: 'c'.repeat(SESSION_QUERY_MAX_CURSOR_LENGTH),
        projectPath: 'p'.repeat(SESSION_QUERY_MAX_PATH_LENGTH),
        workingPath: 'w'.repeat(SESSION_QUERY_MAX_PATH_LENGTH),
      }),
    ).not.toThrow()
    expect(() => decodeSearch({ query: 'q'.repeat(SESSION_QUERY_MAX_SEARCH_LENGTH + 1) })).toThrow()
    expect(() =>
      decodeSearch({ cursor: 'c'.repeat(SESSION_QUERY_MAX_CURSOR_LENGTH + 1) }),
    ).toThrow()
    expect(() =>
      decodeSearch({ projectPath: 'p'.repeat(SESSION_QUERY_MAX_PATH_LENGTH + 1) }),
    ).toThrow()
    expect(() =>
      decodeSearch({ workingPath: 'w'.repeat(SESSION_QUERY_MAX_PATH_LENGTH + 1) }),
    ).toThrow()
    expect(() =>
      decodeSessionQueryRequest({
        contractVersion: 2,
        requestId: 'bounded-export-cursor',
        query: {
          operation: 'exports-list',
          sessionId: 'session-1',
          limit: 1,
          cursor: 'c'.repeat(SESSION_QUERY_MAX_CURSOR_LENGTH + 1),
        },
      }),
    ).toThrow()
  })

  it('decodes an explicit bounded export scope', () => {
    expect(
      decodeSessionQueryRequest({
        contractVersion: 2,
        requestId: 'export-1',
        query: {
          operation: 'export',
          sessionId: 'session-1',
          limit: 100,
          branchScope: 'tree',
          includeQueueBodies: true,
        },
      }).query,
    ).toEqual({
      operation: 'export',
      sessionId: 'session-1',
      limit: 100,
      branchScope: 'tree',
      includeQueueBodies: true,
    })
  })

  it('decodes durable export list and read queries', () => {
    expect(
      decodeSessionQueryRequest({
        contractVersion: 2,
        requestId: 'exports-list-1',
        query: {
          operation: 'exports-list',
          sessionId: 'session-1',
          limit: 20,
          statuses: ['running', 'failed'],
        },
      }).query,
    ).toMatchObject({ operation: 'exports-list', statuses: ['running', 'failed'] })
    expect(
      decodeSessionQueryRequest({
        contractVersion: 2,
        requestId: 'exports-read-1',
        query: {
          operation: 'exports-read',
          sessionId: 'session-1',
          exportOperationId: 'export-1',
        },
      }).query,
    ).toEqual({
      operation: 'exports-read',
      sessionId: 'session-1',
      exportOperationId: 'export-1',
    })
  })

  it('decodes bounded multi-Session waits and requires the selected revision threshold', () => {
    expect(
      decodeSessionQueryRequest({
        contractVersion: 2,
        requestId: 'wait-1',
        query: {
          operation: 'wait',
          targets: [
            { sessionId: 'worker-1', condition: 'idle' },
            {
              sessionId: 'worker-2',
              condition: 'state-revision-after',
              afterStateRevision: 4,
            },
          ],
          timeoutMs: 30_000,
        },
      }).query,
    ).toMatchObject({ operation: 'wait', timeoutMs: 30_000 })
    expect(() =>
      decodeSessionQueryRequest({
        contractVersion: 2,
        requestId: 'wait-invalid',
        query: {
          operation: 'wait',
          targets: [{ sessionId: 'worker-2', condition: 'state-revision-after' }],
          timeoutMs: 30_000,
        },
      }),
    ).toThrow(/afterStateRevision/)
  })
})
