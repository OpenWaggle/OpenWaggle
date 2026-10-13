import type { ExtensionContext } from '@earendil-works/pi-coding-agent'
import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it, vi } from 'vitest'
import { OPENWAGGLE_AUTHORIZE_KEY } from '../../agent-kernel/openwaggle-authorize-channel'
import {
  attachSessionMcpContext,
  openWaggleMcpConnectionHooks,
  withOpenWaggleClientCapabilities,
} from '../mcp-session-context'
import { approveMcpToolCall } from '../mcp-tool-approval'

describe('OpenWaggle MCP connection hooks', () => {
  it('declares sampling, elicitation, and MCP Apps next to the capabilities Pi asked for', () => {
    expect(
      withOpenWaggleClientCapabilities({
        protocolVersion: '2025-11-25',
        capabilities: { roots: {} },
        clientInfo: { name: 'pi', version: '1' },
      }),
    ).toEqual({
      protocolVersion: '2025-11-25',
      capabilities: {
        roots: {},
        sampling: {},
        elicitation: { form: {}, url: {} },
        extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: ['text/html;profile=mcp-app'] } },
      },
      clientInfo: { name: 'pi', version: '1' },
    })
  })

  it('answers sampling through the current Run and refuses it between Runs', async () => {
    const hooks = openWaggleMcpConnectionHooks('s1', 'figma')
    const sample = vi.fn(async () => ({
      model: 'm',
      role: 'assistant' as const,
      content: { type: 'text' as const, text: 'ok' },
    }))
    const signal = new AbortController().signal

    await expect(
      hooks.handleServerRequest?.({ method: 'sampling/createMessage', params: {}, signal }),
    ).rejects.toThrow('asked for input while the session is idle')

    const detach = attachSessionMcpContext('s1', {
      interactions: { sample, elicit: vi.fn() },
      servers: new Map([['figma', { identity: 'mcp-server:abc' }]]),
    })
    await expect(
      hooks.handleServerRequest?.({
        method: 'sampling/createMessage',
        params: { maxTokens: 5 },
        signal,
      }),
    ).resolves.toEqual({ model: 'm', role: 'assistant', content: { type: 'text', text: 'ok' } })
    detach()

    expect(sample).toHaveBeenCalledWith({
      serverInstanceId: 'mcp-server:abc',
      serverLabel: 'figma',
      request: { maxTokens: 5 },
      signal,
    })
    expect(hooks.handleServerRequest?.({ method: 'custom/x', params: {}, signal })).toBeUndefined()
  })
})

describe('MCP tool approval', () => {
  it('asks for authorization keyed on the server identity and the exact tool', async () => {
    const authorize = vi.fn(async () => true)
    const ctx = fromPartial<ExtensionContext>({
      hasUI: true,
      ui: Object.assign({ confirm: async () => false }, { [OPENWAGGLE_AUTHORIZE_KEY]: authorize }),
    })

    const approved = await approveMcpToolCall({
      ctx,
      serverName: 'chrome-devtools',
      serverIdentity: 'mcp-server:123',
      toolName: 'mcp__chrome_devtools__take_screenshot',
      input: { fullPage: true },
      fromScript: true,
    })

    expect(approved).toBe(true)
    expect(authorize).toHaveBeenCalledWith({
      title: 'Allow MCP tool call?',
      message:
        'Server: chrome-devtools\nTool: take_screenshot (called from a codemode script)\nArguments: {\n  "fullPage": true\n}',
      scopeKey: {
        requesterId: 'mcp-server:123',
        requester: 'chrome-devtools',
        capability: 'mcp.tool-call',
        resource: 'mcp__chrome_devtools__take_screenshot',
      },
    })
  })

  it('refuses without any way to ask', async () => {
    const ctx = fromPartial<ExtensionContext>({ hasUI: false, ui: {} })

    await expect(
      approveMcpToolCall({
        ctx,
        serverName: 's',
        serverIdentity: 'i',
        toolName: 'mcp__s__t',
        input: {},
        fromScript: false,
      }),
    ).resolves.toBe(false)
  })
})
