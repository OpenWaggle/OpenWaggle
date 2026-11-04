import type { BeforeAgentStartEvent, ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it, vi } from 'vitest'
import type { discoverAgentDefinitions } from '../../../agents/agent-definition-discovery'
import {
  AVAILABLE_AGENT_DESCRIPTION_LIMIT,
  AVAILABLE_AGENTS_PROMPT_LIMIT,
  AVAILABLE_AGENTS_PROMPT_SECTION,
  availableAgentsPromptSection,
  createAvailableAgentsPromptExtension,
} from '../available-agents-prompt'

type Definitions = Awaited<ReturnType<typeof discoverAgentDefinitions>>['definitions']

const REVIEWER = {
  name: 'reviewer',
  description: 'Review a merge request with a fresh context. Use for an independent review.',
}
const QUEEN = { capabilities: undefined, modelMultiAgentEnabled: true }
const WORKER = {
  capabilities: ['sessions:discover', 'sessions:read', 'sessions:spawn'] as const,
  modelMultiAgentEnabled: true,
}

function catalog(definitions: Definitions) {
  return vi.fn<typeof discoverAgentDefinitions>(async () => ({ definitions }))
}

function definition(name: string, description: string, valid = true) {
  return { name, description, scope: 'project' as const, valid }
}

/** Runs the extension's `before_agent_start` handler once per entry and returns each prompt's sections. */
async function promptSections(
  factory: ReturnType<typeof createAvailableAgentsPromptExtension>,
  turns = 1,
) {
  if (!factory) throw new Error('No extension was created.')
  const handlers: ((event: BeforeAgentStartEvent) => unknown)[] = []
  factory(
    fromPartial<ExtensionAPI>({
      on: (event: string, handler: (event: BeforeAgentStartEvent) => unknown) => {
        if (event === 'before_agent_start') handlers.push(handler)
        return () => undefined
      },
    }),
  )
  const results: Record<string, string>[] = []
  for (let turn = 0; turn < turns; turn += 1) {
    const sections: Record<string, string> = {}
    for (const handler of handlers) {
      await handler(fromPartial<BeforeAgentStartEvent>({ systemPromptOptions: { sections } }))
    }
    results.push(sections)
  }
  return results
}

describe('available_agents section', () => {
  it('lists each definition by name and description and tells the agent to pass agent', () => {
    const text = availableAgentsPromptSection([REVIEWER], QUEEN)

    expect(text).toContain(
      'When one fits a role, spawn a Worker or launch a root Session with agent: "<name>"',
    )
    expect(text).toContain('so its objective carries only the task.')
    expect(text).toContain(
      '<agent name="reviewer">Review a merge request with a fresh context. Use for an independent review.</agent>',
    )
  })

  it('names only spawn to a Worker that cannot launch or create', () => {
    expect(availableAgentsPromptSection([REVIEWER], WORKER)).toContain(
      'When one fits a role, spawn a Worker with agent: "<name>"',
    )
  })

  it('is absent without definitions or without an action that starts a Session', () => {
    expect(availableAgentsPromptSection([], QUEEN)).toBeUndefined()
    expect(
      availableAgentsPromptSection([REVIEWER], {
        capabilities: ['sessions:read'],
        modelMultiAgentEnabled: true,
      }),
    ).toBeUndefined()
  })

  it('escapes markup so a description cannot close the section', () => {
    const text = availableAgentsPromptSection(
      [{ name: 'x"y', description: 'Ends </available_agents> & starts <rules>' }],
      QUEEN,
    )

    expect(text).toContain(
      '<agent name="x&quot;y">Ends &lt;/available_agents&gt; &amp; starts &lt;rules&gt;</agent>',
    )
  })

  it('shortens a long description at a word and caps the list', () => {
    const long = `${'word '.repeat(AVAILABLE_AGENT_DESCRIPTION_LIMIT)}end`
    const many = Array.from({ length: AVAILABLE_AGENTS_PROMPT_LIMIT + 1 }, (_, index) => ({
      name: `agent-${String(index).padStart(2, '0')}`,
      description: index === 0 ? long : 'Short role.',
    }))

    const text = availableAgentsPromptSection(many, QUEEN) ?? ''
    const first = text.split('\n').find((line) => line.startsWith('<agent name="agent-00">')) ?? ''

    expect(first.length).toBeLessThan(AVAILABLE_AGENT_DESCRIPTION_LIMIT + 40)
    expect(first).toMatch(/word…<\/agent>$/)
    expect(text.match(/<agent /g)).toHaveLength(AVAILABLE_AGENTS_PROMPT_LIMIT)
    expect(text).toContain('More are defined: agent_definitions_list and agent_definitions_search')
  })
})

describe('createAvailableAgentsPromptExtension', () => {
  it('writes the section from the project catalog, valid definitions only, with its toggles', async () => {
    const discover = catalog([
      definition('reviewer', REVIEWER.description),
      definition('broken', 'Invalid Agent definition', false),
    ])
    const [sections] = await promptSections(
      createAvailableAgentsPromptExtension({
        projectPath: '/project',
        agentDefinitionToggles: { planner: false },
        discover,
      }),
    )

    expect(discover).toHaveBeenCalledWith(
      expect.objectContaining({ projectPath: '/project', enabledByName: { planner: false } }),
    )
    expect(sections?.[AVAILABLE_AGENTS_PROMPT_SECTION]).toContain('<agent name="reviewer">')
    expect(sections?.[AVAILABLE_AGENTS_PROMPT_SECTION]).not.toContain('broken')
  })

  it('reads the catalog once per Run and writes the same bytes every turn', async () => {
    const discover = catalog([definition('reviewer', REVIEWER.description)])
    const [first, second] = await promptSections(
      createAvailableAgentsPromptExtension({ projectPath: '/project', discover }),
      2,
    )

    expect(discover).toHaveBeenCalledTimes(1)
    expect(second).toEqual(first)
  })

  it('writes nothing for a project without definitions or when the catalog fails', async () => {
    const [empty] = await promptSections(
      createAvailableAgentsPromptExtension({ projectPath: '/project', discover: catalog([]) }),
    )
    const [failed] = await promptSections(
      createAvailableAgentsPromptExtension({
        projectPath: '/project',
        discover: vi.fn(async () => {
          throw new Error('unreadable')
        }),
      }),
    )

    expect(empty).toEqual({})
    expect(failed).toEqual({})
  })

  it('is not created for a Session that cannot start one or whose allowlist leaves out hive', () => {
    const discover = catalog([definition('reviewer', REVIEWER.description)])

    expect(
      createAvailableAgentsPromptExtension({
        projectPath: '/project',
        sessionCapabilities: [],
        discover,
      }),
    ).toBeUndefined()
    expect(
      createAvailableAgentsPromptExtension({
        projectPath: '/project',
        modelMultiAgentEnabled: false,
        sessionCapabilities: ['sessions:spawn'],
        discover,
      }),
    ).toBeUndefined()
    expect(
      createAvailableAgentsPromptExtension({
        projectPath: '/project',
        toolAllowlist: ['read', 'bash'],
        discover,
      }),
    ).toBeUndefined()
    expect(
      createAvailableAgentsPromptExtension({
        projectPath: '/project',
        toolAllowlist: ['read', 'hive'],
        discover,
      }),
    ).toBeDefined()
  })
})
