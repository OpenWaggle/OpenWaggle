import type {
  BeforeAgentStartEvent,
  ExtensionAPI,
  ToolDefinition,
  ToolInfo,
} from '@earendil-works/pi-coding-agent'
import { fromPartial } from '@total-typescript/shoehorn'
import { Type } from 'typebox'
import { describe, expect, it, vi } from 'vitest'
import {
  announceOnDemandTools,
  onDemandToolRegistration,
  TOOL_SEARCH_TOOL_NAME,
} from '../openwaggle-on-demand-tools'

type Handler = (event: unknown) => unknown

function fakePi(allTools: Partial<ToolInfo>[], active: string[]) {
  const handlers = new Map<string, Handler[]>()
  const registered: ToolDefinition[] = []
  const setActiveTools = vi.fn()
  const pi = fromPartial<ExtensionAPI>({
    registerTool: (tool: ToolDefinition) => registered.push(tool),
    on: (name: string, handler: Handler) => {
      handlers.set(name, [...(handlers.get(name) ?? []), handler])
    },
    getAllTools: () => allTools,
    getActiveTools: () => active,
    setActiveTools,
  })
  const emit = (name: string, event: unknown = {}) => {
    for (const handler of handlers.get(name) ?? []) handler(event)
  }
  return { pi, registered, setActiveTools, emit }
}

function promptOptions() {
  return fromPartial<BeforeAgentStartEvent>({
    systemPromptOptions: { promptGuidelines: [], sections: {} },
  })
}

describe('OpenWaggle on-demand tools', () => {
  it('registers a tool as deferred in the openwaggle namespace, without prompt text', () => {
    const { pi, registered } = fakePi([], [])
    onDemandToolRegistration(pi).registerTool({
      name: 'source_control',
      label: 'Source Control',
      description: 'Reach the source control host.',
      promptSnippet: 'would change the system prompt when loaded',
      promptGuidelines: ['so would this'],
      parameters: Type.Object({}),
      execute: async () => ({ content: [], details: undefined }),
    })

    expect(registered[0]).toMatchObject({
      name: 'source_control',
      exposure: 'deferred',
      namespace: { name: 'openwaggle' },
    })
    expect(registered[0]).not.toHaveProperty('promptSnippet')
    expect(registered[0]).not.toHaveProperty('promptGuidelines')
  })

  it("activates Pi's tool search when the session starts", () => {
    const { pi, setActiveTools, emit } = fakePi(
      [{ name: TOOL_SEARCH_TOOL_NAME, reachesTools: () => 'all' }],
      ['read', 'bash'],
    )
    announceOnDemandTools(pi, { rule: 'rule' })
    emit('session_start')

    expect(setActiveTools).toHaveBeenCalledWith(['read', 'bash', TOOL_SEARCH_TOOL_NAME])
  })

  it('never activates a same-named tool that cannot load tools, or one already active', () => {
    const impostor = fakePi([{ name: TOOL_SEARCH_TOOL_NAME }], ['read'])
    announceOnDemandTools(impostor.pi, { rule: 'rule' })
    impostor.emit('session_start')
    const active = fakePi(
      [{ name: TOOL_SEARCH_TOOL_NAME, reachesTools: () => 'all' }],
      [TOOL_SEARCH_TOOL_NAME],
    )
    announceOnDemandTools(active.pi, { rule: 'rule' })
    active.emit('session_start')

    expect(impostor.setActiveTools).not.toHaveBeenCalled()
    expect(active.setActiveTools).not.toHaveBeenCalled()
  })

  it('announces the family with a rule or by replacing a Pi section in place', () => {
    const { pi, emit } = fakePi([], [])
    announceOnDemandTools(pi, { rule: 'Load preview_* with tool_search.' })
    announceOnDemandTools(pi, { section: { name: 'docs', text: 'Docs: openwaggle_docs.' } })
    const event = promptOptions()
    emit('before_agent_start', event)

    expect(event.systemPromptOptions.promptGuidelines).toEqual(['Load preview_* with tool_search.'])
    expect(event.systemPromptOptions.sections).toEqual({ docs: 'Docs: openwaggle_docs.' })
  })
})
