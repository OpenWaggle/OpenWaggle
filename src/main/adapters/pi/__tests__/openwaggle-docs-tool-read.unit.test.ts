import { symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import * as Effect from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import {
  call,
  callRead,
  discoveryView,
  docsRoot,
  EXTENSION_DOC,
  extensionTopic,
  registerDocsToolFixture,
  registerTool,
  sha256,
} from './openwaggle-docs-tool.test-harness'

registerDocsToolFixture()

describe('openwaggle_docs read', () => {
  it('reads a topic by id, unprefixed id, or alias as Markdown and pages long docs', async () => {
    const tool = registerTool()
    const first = await callRead(tool, { topic: 'openwaggle:using-openwaggle/hives-and-sessions' })
    expect(first.header).toContain('Topic: openwaggle:using-openwaggle/hives-and-sessions')
    expect(first.header).toContain('Lines 1-2000 of 3000. Read on with offset 2001.')
    expect(first.body.split('\n')).toHaveLength(2000)
    expect(first.body.startsWith('Hive line 1\nHive line 2\n')).toBe(true)
    expect(first.details).toMatchObject({
      topic: 'openwaggle:using-openwaggle/hives-and-sessions',
      source: 'openwaggle',
      startLine: 1,
      endLine: 2000,
      totalLines: 3000,
      nextOffset: 2001,
    })
    expect(first.details).not.toHaveProperty('content')

    const rest = await callRead(tool, {
      topic: 'using-openwaggle/hives-and-sessions',
      offset: 2001,
    })
    expect(rest.details).toMatchObject({ startLine: 2001, endLine: 3000, totalLines: 3000 })
    expect(rest.details).not.toHaveProperty('nextOffset')
    expect((await callRead(tool, { topic: 'Hives' })).details).toMatchObject({
      topic: 'openwaggle:using-openwaggle/hives-and-sessions',
    })
  })

  it('cuts a single line longer than the byte budget', async () => {
    await writeFile(path.join(docsRoot(), 'first-party.md'), `${'é'.repeat(40_000)}\nnext`)
    const read = await callRead(registerTool(), { topic: 'openwaggle:configuration/mcp' })
    expect(Buffer.byteLength(read.body, 'utf8')).toBeLessThanOrEqual(50 * 1024)
    expect(read.body.endsWith('é')).toBe(true)
    expect(read.header).toContain('was cut')
    expect(read.details).toMatchObject({ startLine: 1, endLine: 1, lineCut: true, nextOffset: 2 })
  })

  it('reports other topics an ambiguous alias names', async () => {
    const read = await callRead(registerTool(), { topic: 'mcp' })
    expect(read.details).toMatchObject({
      topic: 'openwaggle:configuration/mcp',
      otherMatches: ['pi:mcp'],
    })
    expect(read.header).toContain('Also matches: pi:mcp')
    expect(read.body).toBe('# MCP')
  })

  it('reads a trusted extension doc and says who wrote it', async () => {
    const read = await callRead(registerTool(), { topic: 'deploy' })
    expect(read.body).toBe(EXTENSION_DOC)
    expect(read.header).toContain('From the extension Acme Deploy (acme.deploy)')
    expect(read.details).toMatchObject({
      topic: 'extension:acme.deploy/usage',
      source: 'extension',
      extension: { id: 'acme.deploy', name: 'Acme Deploy' },
    })
  })

  it('refuses an extension doc that leaves its package or changed after discovery', async () => {
    const link = path.join(docsRoot(), 'acme-deploy', 'linked.md')
    await symlink(path.join(docsRoot(), 'secret.txt'), link)
    const escaping = registerTool(() =>
      Effect.succeed(
        discoveryView([extensionTopic({ path: link, contentHash: sha256('secret') })]),
      ),
    )
    const escaped = await call(escaping, { action: 'read', topic: 'deploy' })
    expect(escaped).toMatchObject({ isError: true, text: expect.stringContaining('outside') })
    expect(escaped.text).not.toContain('secret\n')

    await writeFile(path.join(docsRoot(), 'acme-deploy', 'usage.md'), 'Replaced')
    expect(await call(registerTool(), { action: 'read', topic: 'deploy' })).toMatchObject({
      isError: true,
      text: expect.stringContaining('changed after it was discovered'),
    })
  })

  it('returns tool errors for unknown topics, bad offsets, and invalid arguments', async () => {
    const tool = registerTool()
    expect(await call(tool, { action: 'read', topic: 'nope' })).toMatchObject({
      isError: true,
      text: expect.stringContaining('search or list'),
    })
    expect(await call(tool, { action: 'read', topic: 'hives', offset: 5000 })).toMatchObject({
      isError: true,
      text: expect.stringContaining('3000 lines'),
    })
    expect(await call(tool, { action: 'search' })).toMatchObject({
      isError: true,
      text: expect.stringContaining('"search"'),
    })
    expect(await call(tool, { action: 'delete' })).toMatchObject({ isError: true })
  })

  it('explains a missing bundle instead of failing the Run', async () => {
    const tool = registerTool(() => Effect.fail(new Error('ENOENT: index.json')), null)
    const result = await call(tool, { action: 'search', query: 'hives' })
    expect(result.isError).toBe(true)
    expect(result.text).toContain(JSON.stringify(docsRoot()))
    expect(result.text).toContain('pnpm docs:generate')
  })
})
