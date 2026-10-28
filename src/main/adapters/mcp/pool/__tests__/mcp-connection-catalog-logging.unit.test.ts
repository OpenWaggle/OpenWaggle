import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const logger = vi.hoisted(() => ({ warn: vi.fn() }))
vi.mock('../../../../logger', () => ({
  createLogger: () => ({ error: vi.fn(), warn: logger.warn, info: vi.fn(), debug: vi.fn() }),
}))

const { fileBackedMcpToolCatalogStore, memoryMcpToolCatalogStore } = await import(
  '../mcp-connection-catalog'
)
const { fileBackedPackageBinStore } = await import('../../runtime/mcp-package-runner-bin-store')
const { McpSessionConnectionPool } = await import('../mcp-session-connection-pool')
const { FakeUpstream, flush, INITIALIZE_RESULT, initializeRequest } = await import(
  './fake-upstream'
)

let root = ''
beforeEach(() => {
  logger.warn.mockClear()
  root = mkdtempSync(path.join(tmpdir(), 'ow-mcp-logging-'))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('MCP state that cannot be used is logged, not swallowed (review R5 P3-8)', () => {
  it('logs a corrupt catalog, but not a missing one', () => {
    const store = fileBackedMcpToolCatalogStore(() => root)
    expect(store.read('missing')).toBeUndefined()
    expect(logger.warn).not.toHaveBeenCalled()

    writeFileSync(path.join(root, 'corrupt.json'), '{ not json')
    expect(store.read('corrupt')).toBeUndefined()
    expect(logger.warn).toHaveBeenCalledWith(
      'An MCP tool catalog is not valid JSON; it is ignored',
      expect.objectContaining({ key: 'corrupt' }),
    )
  })

  it('logs a catalog it cannot save', () => {
    // The catalog directory is a file, so nothing can be written inside it.
    const blocked = path.join(root, 'tool-catalogs')
    writeFileSync(blocked, '')
    fileBackedMcpToolCatalogStore(() => blocked).write('key', {
      initialize: {},
      toolsPages: {},
      savedAt: 1,
    })
    expect(logger.warn).toHaveBeenCalledWith(
      'Could not save an MCP tool catalog',
      expect.objectContaining({ key: 'key' }),
    )
  })

  it('logs an unreadable package runner resolutions file', () => {
    mkdirSync(path.join(root, 'mcp'))
    const file = path.join(root, 'mcp', 'package-runner-bins.json')
    writeFileSync(file, '{"version":2}')
    expect(fileBackedPackageBinStore(() => file).load()).toEqual({})
    expect(logger.warn).toHaveBeenCalledWith(
      'The MCP package runner resolutions file is unreadable; it is ignored',
    )
  })

  it('logs a started server whose tools could not be checked against the catalog', async () => {
    const store = memoryMcpToolCatalogStore()
    store.write('key', {
      initialize: INITIALIZE_RESULT,
      toolsPages: { '': { tools: [] } },
      savedAt: Date.now(),
    })
    const pool = new McpSessionConnectionPool({ catalogStore: store })
    const lease = pool.lease('s1', {
      name: 'browser',
      fingerprint: 'v1',
      catalogKey: 'key',
      lazyStart: true,
      open: () => {
        const upstream = new FakeUpstream((request) => {
          if (request.method === 'tools/list') {
            queueMicrotask(() =>
              upstream.push({
                jsonrpc: '2.0',
                id: request.id,
                error: { code: -32_000, message: 'listing broke' },
              }),
            )
            return undefined
          }
          return { content: [] }
        })
        return { transport: upstream }
      },
    })
    await lease.start()
    await lease.send(initializeRequest(1))
    await lease.send({ jsonrpc: '2.0', method: 'notifications/initialized' })
    await lease.send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'x' } })
    await flush()
    await flush()

    expect(logger.warn).toHaveBeenCalledWith(
      'Could not check a started MCP server’s tools against its catalog',
      expect.objectContaining({ server: 'browser', error: 'listing broke' }),
    )
    await pool.closeAll()
  })
})
