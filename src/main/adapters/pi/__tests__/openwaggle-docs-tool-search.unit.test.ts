import type { DocsListInput } from '@shared/types/docs'
import * as Effect from 'effect/Effect'
import { describe, expect, it, vi } from 'vitest'
import { openWaggleDocsToolDescription } from '../openwaggle-docs-tool-extension'
import {
  callJson,
  callRead,
  discoveryView,
  docsRoot,
  extensionTopic,
  registerDocsToolFixture,
  registerTool,
} from './openwaggle-docs-tool.test-harness'

registerDocsToolFixture()

describe('openwaggle_docs prompt and schema', () => {
  it('registers a flat on-demand schema whose description points at the bundle', () => {
    const tool = registerTool()
    expect(tool.name).toBe('openwaggle_docs')
    expect(tool).toMatchObject({ exposure: 'deferred', namespace: { name: 'openwaggle' } })
    expect(tool.parameters).toMatchObject({
      type: 'object',
      required: ['action'],
      properties: { action: { enum: ['list', 'search', 'read'] } },
    })
    expect(tool.parameters).not.toHaveProperty('anyOf')
    // Declared only once tool search loads it, so it adds nothing to the system prompt.
    expect(tool.promptSnippet).toBeUndefined()
    expect(tool.promptGuidelines).toBeUndefined()
    expect(tool.description).toContain(JSON.stringify(docsRoot()))
    expect(tool.description).toContain('topics/pi/')
    expect(tool.description).toContain('app.asar open with the read and ls tools')
  })

  it('names no bundle path when the bundle is unavailable', () => {
    expect(registerTool(undefined, null).description).toBe(openWaggleDocsToolDescription(null))
    expect(openWaggleDocsToolDescription(null)).not.toContain('installed bundle is')
  })
})

describe('openwaggle_docs search and list', () => {
  it('finds the Hives topic for a natural question', async () => {
    const result = await callJson(registerTool(), { action: 'search', query: 'how do Hives work' })
    expect(result).toMatchObject({
      results: [
        { topic: 'openwaggle:using-openwaggle/hives-and-sessions', title: 'Hives and Sessions' },
      ],
    })
  })

  it('ranks OpenWaggle topics before Pi topics unless the full id is asked for', async () => {
    const tool = registerTool()
    expect(await callJson(tool, { action: 'search', query: 'settings' })).toMatchObject({
      results: [{ topic: 'openwaggle:configuration/app-settings' }, { topic: 'pi:settings' }],
    })
    expect(await callJson(tool, { action: 'search', query: 'mcp' })).toMatchObject({
      results: [{ topic: 'openwaggle:configuration/mcp' }, { topic: 'pi:mcp' }],
    })
    expect(await callJson(tool, { action: 'search', query: 'pi:settings' })).toMatchObject({
      results: [{ topic: 'pi:settings' }],
    })
    expect(await callJson(tool, { action: 'search', query: 'mcp', source: 'pi' })).toEqual({
      query: 'mcp',
      results: [{ topic: 'pi:mcp', title: 'MCP' }],
    })
  })

  it('searches stop words when nothing else is asked and hints when nothing matches', async () => {
    const tool = registerTool()
    const openWaggle = await callJson(tool, { action: 'search', query: 'OpenWaggle' })
    expect(openWaggle).toMatchObject({
      results: expect.arrayContaining([
        expect.objectContaining({ topic: 'openwaggle:configuration/app-settings' }),
      ]),
    })
    expect(await callJson(tool, { action: 'search', query: 'kubernetes' })).toMatchObject({
      results: [],
      hint: expect.stringContaining('list'),
    })
  })

  it('lists topics in source order and asks for extension docs of the Session project', async () => {
    const discover = vi.fn((_input: DocsListInput) => Effect.succeed(discoveryView()))
    const tool = registerTool(discover)
    const listed = await callJson(tool, { action: 'list' })
    expect(discover).toHaveBeenCalledWith({ projectPaths: ['/repo'], includeExtensions: true })
    expect(listed).toMatchObject({
      bundlePath: docsRoot(),
      topics: [
        { topic: 'openwaggle:using-openwaggle/hives-and-sessions' },
        { topic: 'openwaggle:configuration/mcp' },
        { topic: 'openwaggle:configuration/app-settings' },
        { topic: 'pi:mcp' },
        { topic: 'pi:settings' },
        {
          topic: 'extension:acme.deploy/usage',
          extension: { id: 'acme.deploy', name: 'Acme Deploy' },
        },
      ],
    })

    await callJson(tool, { action: 'list', source: 'pi' })
    expect(discover).toHaveBeenLastCalledWith({ projectPaths: ['/repo'], includeExtensions: false })
  })

  it('leaves out docs of extensions the user has not trusted and enabled', async () => {
    const hidden = [
      extensionTopic({ topic: 'extension:a/one', aliases: ['hives'] }, { trust: 'untrusted' }),
      extensionTopic({ topic: 'extension:b/one', aliases: ['hives'] }, { trust: 'unknown' }),
      extensionTopic({ topic: 'extension:c/one', aliases: ['hives'] }, { lifecycle: 'disabled' }),
      extensionTopic({ topic: 'extension:d/one', aliases: ['hives'], contentHash: null }),
    ]
    const tool = registerTool(() => Effect.succeed(discoveryView(hidden)))
    expect(await callJson(tool, { action: 'list', source: 'extension' })).toMatchObject({
      topics: [],
    })
    const hives = await callRead(tool, { topic: 'hives' })
    expect(hives.details).toMatchObject({ topic: 'openwaggle:using-openwaggle/hives-and-sessions' })
    expect(hives.details).not.toHaveProperty('otherMatches')
  })
})
