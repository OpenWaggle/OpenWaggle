import { describe, expect, it } from 'vitest'
import { migrateOpenWaggleMcpFiles } from '../migrate-openwaggle-mcp-files'
import {
  connectedFs,
  HOME,
  LEGACY_STATE,
  MIGRATION_RECORD,
  memoryFs,
  NOW,
  OPENWAGGLE_GLOBAL,
  recordingLogger,
} from './migration-fixtures'

describe('converting OpenWaggle-only fields to Pi entries', () => {
  it('converts transports, OAuth scopes, and direct tools, and removes fields Pi has no use for', async () => {
    const fs = connectedFs({
      [OPENWAGGLE_GLOBAL]: {
        mcpServers: {
          events: {
            url: 'https://events.example.com/sse',
            transport: 'sse',
            compatibility: 'legacy-sse',
            protocolVersion: '2024-11-05',
            headers: { Authorization: { secret: 'EVENTS_TOKEN' } },
          },
          socket: { url: 'wss://socket.example.com/mcp', transport: 'websocket' },
          oldSse: { url: 'https://old.example.com/sse', compatibility: 'legacy-sse' },
          remote: {
            url: 'https://remote.example.com/mcp',
            transport: 'streamable-http',
            auth: { type: 'oauth', scopes: ['read', 'write'] },
            directTools: ['search'],
            required: true,
            clientCapabilities: { sampling: true },
          },
          local: {
            command: 'local-mcp',
            transport: 'stdio',
            security: { allowNetwork: true, readRoots: ['.'] },
            directTools: false,
            description: 'Local helper',
            provenance: { source: 'catalog', importedAt: '2026-01-01T00:00:00.000Z' },
          },
        },
      },
    })

    await migrateOpenWaggleMcpFiles({ homeDir: HOME, projectPaths: [], now: () => NOW, fs })

    expect(fs.json(OPENWAGGLE_GLOBAL)).toEqual({
      mcpServers: {
        events: {
          url: 'https://events.example.com/sse',
          type: 'sse',
          headers: { Authorization: { secret: 'EVENTS_TOKEN' } },
        },
        socket: { url: 'wss://socket.example.com/mcp', type: 'websocket' },
        oldSse: { url: 'https://old.example.com/sse', type: 'sse' },
        remote: {
          url: 'https://remote.example.com/mcp',
          oauth: { scope: 'read write' },
          toolExposure: { search: 'direct' },
        },
        local: {
          command: 'local-mcp',
          description: 'Local helper',
          provenance: { source: 'catalog', importedAt: '2026-01-01T00:00:00.000Z' },
        },
      },
    })
  })

  it('keeps unrelated keys, key order, and the file indentation', async () => {
    const original = [
      '{',
      '\t"autoEnableCodemode": false,',
      '\t"servers": {',
      '\t\t"local": { "command": "local-mcp", "transport": "stdio" }',
      '\t},',
      '\t"custom": { "keep": true }',
      '}',
      '',
    ].join('\n')
    const fs = connectedFs({ [OPENWAGGLE_GLOBAL]: original })

    await migrateOpenWaggleMcpFiles({ homeDir: HOME, projectPaths: [], now: () => NOW, fs })

    expect(fs.files.get(OPENWAGGLE_GLOBAL)).toBe(
      `${JSON.stringify(
        {
          autoEnableCodemode: false,
          mcpServers: { local: { command: 'local-mcp' } },
          custom: { keep: true },
        },
        null,
        '\t',
      )}\n`,
    )
  })

  it('leaves a file that is already in Pi format untouched and makes no backup', async () => {
    const original = '{"mcpServers":{"local":{"command":"local-mcp"}}}'
    const fs = connectedFs({ [OPENWAGGLE_GLOBAL]: original })

    const report = await migrateOpenWaggleMcpFiles({
      homeDir: HOME,
      projectPaths: [],
      now: () => NOW,
      fs,
    })

    expect(fs.files.get(OPENWAGGLE_GLOBAL)).toBe(original)
    expect(fs.writes).toEqual([MIGRATION_RECORD])
    expect(report.files).toEqual([{ path: OPENWAGGLE_GLOBAL, status: 'unchanged', changes: [] }])
  })

  it('never overwrites an existing backup', async () => {
    const backupPath = `${OPENWAGGLE_GLOBAL}.pre-adr-0048.bak`
    const fs = connectedFs({
      [OPENWAGGLE_GLOBAL]: { mcpServers: { local: { command: 'local-mcp', required: true } } },
      [backupPath]: 'earlier backup',
    })

    await migrateOpenWaggleMcpFiles({ homeDir: HOME, projectPaths: [], now: () => NOW, fs })

    expect(fs.files.get(backupPath)).toBe('earlier backup')
    expect(fs.json(OPENWAGGLE_GLOBAL)).toEqual({ mcpServers: { local: { command: 'local-mcp' } } })
  })
})

describe('migration failures', () => {
  it('logs an unreadable file, leaves it intact, and retries on the next run', async () => {
    const fs = connectedFs({ [OPENWAGGLE_GLOBAL]: '{ "mcpServers": ' })
    const logger = recordingLogger()

    const report = await migrateOpenWaggleMcpFiles({
      homeDir: HOME,
      projectPaths: [],
      now: () => NOW,
      fs,
      logger,
    })

    expect(fs.files.get(OPENWAGGLE_GLOBAL)).toBe('{ "mcpServers": ')
    expect(report.files).toEqual([
      expect.objectContaining({ path: OPENWAGGLE_GLOBAL, status: 'failed' }),
    ])
    expect(logger.error).toHaveBeenCalledWith(
      'MCP file migration failed; the file was left unchanged',
      expect.objectContaining({ path: OPENWAGGLE_GLOBAL, error: expect.any(String) }),
    )

    fs.files.set(
      OPENWAGGLE_GLOBAL,
      '{ "mcpServers": { "a": { "command": "a", "required": true } } }',
    )
    const retry = await migrateOpenWaggleMcpFiles({
      homeDir: HOME,
      projectPaths: [],
      now: () => NOW,
      fs,
      logger,
    })
    expect(retry.files[0]?.status).toBe('migrated')
  })

  it('leaves the original in place when writing the migrated file fails', async () => {
    const original = `${JSON.stringify({ mcpServers: { a: { command: 'a', required: true } } })}\n`
    const fs = connectedFs({ [OPENWAGGLE_GLOBAL]: original })
    fs.failWritesTo = OPENWAGGLE_GLOBAL

    const report = await migrateOpenWaggleMcpFiles({
      homeDir: HOME,
      projectPaths: [],
      now: () => NOW,
      fs,
      logger: recordingLogger(),
    })

    expect(fs.files.get(OPENWAGGLE_GLOBAL)).toBe(original)
    expect(fs.files.has(MIGRATION_RECORD)).toBe(false)
    expect(report.files[0]?.status).toBe('failed')
  })

  it('does not start when the old state cannot be read, so no choice is lost', async () => {
    const original = `${JSON.stringify({ mcpServers: { a: { command: 'a', required: true } } })}\n`
    const fs = connectedFs({ [OPENWAGGLE_GLOBAL]: original, [LEGACY_STATE]: '{ broken' })
    const logger = recordingLogger()

    const report = await migrateOpenWaggleMcpFiles({
      homeDir: HOME,
      projectPaths: [],
      now: () => NOW,
      fs,
      logger,
    })

    expect(report.error).toEqual(expect.any(String))
    expect(report.files).toEqual([])
    expect(fs.files.get(OPENWAGGLE_GLOBAL)).toBe(original)
    expect(logger.error).toHaveBeenCalledOnce()
  })
})
