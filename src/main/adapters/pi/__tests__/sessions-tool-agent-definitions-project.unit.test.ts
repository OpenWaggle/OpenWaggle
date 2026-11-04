import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { ExtensionAPI, ToolDefinition } from '@earendil-works/pi-coding-agent'
import { fromPartial } from '@total-typescript/shoehorn'
import { afterEach, describe, expect, it } from 'vitest'
import { createSessionsToolExtension } from '../sessions-tool-extension'

/**
 * `agent_definitions_list` and `agent_definitions_search` with a projectPath: the tool used to
 * accept the argument (TypeBox objects admit unknown properties) and drop it, always reading the
 * caller's own project, so a Queen asking for another project's definitions got her own list.
 */
describe('hive agent-definition discovery for a named project', () => {
  const temporaryRoots: string[] = []

  afterEach(async () => {
    await Promise.all(
      temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })),
    )
  })

  async function projects() {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-agent-projects-'))
    temporaryRoots.push(root)
    const own = path.join(root, 'own')
    const other = path.join(root, 'other')
    await fs.mkdir(path.join(own, '.openwaggle', 'agents'), { recursive: true })
    await fs.mkdir(path.join(other, '.openwaggle', 'agents'), { recursive: true })
    await fs.writeFile(
      path.join(other, '.openwaggle', 'agents', 'reviewer.md'),
      '---\nschemaVersion: 1\nname: reviewer\ndescription: Reviews merge requests\n---\n\nReview.\n',
      'utf8',
    )
    await fs.writeFile(
      path.join(other, '.openwaggle', 'agents', 'planner.md'),
      '---\nschemaVersion: 1\nname: planner\ndescription: Plans the work\n---\n\nPlan.\n',
      'utf8',
    )
    return { own, other }
  }

  function hiveTool(input: {
    readonly own: string
    readonly known: readonly string[]
    readonly worker?: boolean
    readonly togglesByProject?: Readonly<Record<string, Readonly<Record<string, boolean>>>>
  }) {
    let tool: ToolDefinition | undefined
    createSessionsToolExtension({
      sessionId: 'session-queen',
      runId: 'run-queen',
      workingDirectory: input.own,
      projectPath: input.own,
      ...(input.worker
        ? { sessionCapabilities: ['sessions:discover', 'sessions:read', 'sessions:spawn'] }
        : {}),
      resolveAgentDefinitionProject: async (directory) => {
        const projectPath = path.resolve(directory)
        return {
          projectPath,
          known: input.known.includes(projectPath),
          enabledByName: input.togglesByProject?.[projectPath] ?? {},
        }
      },
    })(
      fromPartial<ExtensionAPI>({
        registerTool: (registered: ToolDefinition) => {
          tool = registered
        },
        on: () => () => undefined,
      }),
    )
    if (!tool) throw new Error('The hive tool was not registered.')
    const registered = tool
    return (params: Record<string, unknown>) =>
      registered.execute(
        'definitions',
        params,
        new AbortController().signal,
        () => undefined,
        fromPartial({}),
      )
  }

  it('lists the definitions of the project it names, with that project’s toggles', async () => {
    const { own, other } = await projects()
    const call = hiveTool({
      own,
      known: [own, other],
      togglesByProject: { [other]: { planner: false } },
    })

    const result = await call({ action: 'agent_definitions_list', projectPath: other })

    expect(result.isError).toBeFalsy()
    expect(result.details).toEqual({
      definitions: [
        { name: 'reviewer', description: 'Reviews merge requests', scope: 'project', valid: true },
      ],
    })
  })

  it('searches the project it names', async () => {
    const { own, other } = await projects()
    const call = hiveTool({ own, known: [own, other] })

    const result = await call({
      action: 'agent_definitions_search',
      query: 'merge',
      projectPath: other,
    })

    expect(result.details).toEqual({
      definitions: [expect.objectContaining({ name: 'reviewer' })],
    })
  })

  it('refuses a directory that is not a project in OpenWaggle instead of reading its own', async () => {
    const { own, other } = await projects()
    const call = hiveTool({ own, known: [own] })

    const result = await call({ action: 'agent_definitions_list', projectPath: other })

    expect(result.isError).toBe(true)
    expect(result.content).toEqual([
      { type: 'text', text: expect.stringContaining('is not a project in OpenWaggle') },
    ])
  })

  it('refuses another project to a Session that cannot launch or create there', async () => {
    const { own, other } = await projects()
    const call = hiveTool({ own, known: [own, other], worker: true })

    const result = await call({ action: 'agent_definitions_list', projectPath: other })

    expect(result.isError).toBe(true)
    expect(result.content).toEqual([
      { type: 'text', text: expect.stringContaining('only its own project') },
    ])
  })

  it('reads its own project when projectPath names it, even without launch or create', async () => {
    const { own } = await projects()
    await fs.writeFile(
      path.join(own, '.openwaggle', 'agents', 'mine.md'),
      '---\nschemaVersion: 1\nname: mine\ndescription: Own role\n---\n\nMine.\n',
      'utf8',
    )
    const call = hiveTool({ own, known: [own], worker: true })

    const result = await call({ action: 'agent_definitions_list', projectPath: own })

    expect(result.details).toEqual({
      definitions: [expect.objectContaining({ name: 'mine' })],
    })
  })

  it('refuses a relative projectPath', async () => {
    const { own } = await projects()
    const call = hiveTool({ own, known: [own] })

    const result = await call({ action: 'agent_definitions_list', projectPath: 'other' })

    expect(result.isError).toBe(true)
  })
})
