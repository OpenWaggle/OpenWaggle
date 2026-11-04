import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { ExtensionAPI, ToolDefinition } from '@earendil-works/pi-coding-agent'
import type { LocalSessionCommandResult } from '@shared/types/local-session-protocol'
import type { SessionCapability } from '@shared/types/session-capability'
import { fromPartial } from '@total-typescript/shoehorn'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LocalSessionCommandAuthorizationError } from '../../../errors'
import {
  installSessionToolGateway,
  type SessionToolGateway,
} from '../../../session-host/session-tool-gateway'
import { createSessionsToolExtension } from '../sessions-tool-extension'

const WORKER_CAPABILITIES: readonly SessionCapability[] = [
  'sessions:discover',
  'sessions:read',
  'sessions:spawn',
]

function listResult(sessionCount: number) {
  return fromPartial<LocalSessionCommandResult>({
    contract: 'session-query-v2',
    response: {
      contractVersion: 2 as const,
      requestId: 'probe',
      outcome: {
        operation: 'list' as const,
        sessions: Array.from({ length: sessionCount }, (_, index) => ({ sessionId: `s-${index}` })),
      },
    },
  })
}

/** The Host as it answers a caller whose scope leaves the named project out. */
const scopeDenied = vi.fn(async () => {
  throw new LocalSessionCommandAuthorizationError({ code: 'target_scope_denied' })
})

/**
 * `agent_definitions_list` and `agent_definitions_search` with a projectPath: the tool used to
 * accept the argument (TypeBox objects admit unknown properties) and drop it, always reading the
 * caller's own project, so a Queen asking for another project's definitions got her own list.
 * Another project is authorized by the Session Host as a target, the scope rule launch and create
 * follow, not by capabilities alone.
 */
describe('hive agent-definition discovery for a named project', () => {
  const temporaryRoots: string[] = []
  let releaseGateway: (() => void) | undefined

  afterEach(async () => {
    releaseGateway?.()
    releaseGateway = undefined
    await Promise.all(
      temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })),
    )
  })

  async function projects() {
    const root = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-agent-projects-')),
    )
    temporaryRoots.push(root)
    const own = path.join(root, 'own')
    const other = path.join(root, 'other')
    await fs.mkdir(path.join(own, '.openwaggle', 'agents'), { recursive: true })
    await fs.mkdir(path.join(other, '.openwaggle', 'agents'), { recursive: true })
    await fs.writeFile(
      path.join(own, '.openwaggle', 'agents', 'mine.md'),
      '---\nschemaVersion: 1\nname: mine\ndescription: Own role\n---\n\nMine.\n',
      'utf8',
    )
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
    return { root, own, other }
  }

  function hiveTool(input: {
    readonly own: string
    readonly known: readonly string[]
    readonly capabilities?: readonly SessionCapability[]
    readonly gateway?: SessionToolGateway
    readonly togglesByProject?: Readonly<Record<string, Readonly<Record<string, boolean>>>>
  }) {
    const gateway = vi.fn<SessionToolGateway>(input.gateway ?? (async () => listResult(0)))
    releaseGateway = installSessionToolGateway(gateway)
    let tool: ToolDefinition | undefined
    createSessionsToolExtension({
      sessionId: 'session-caller',
      runId: 'run-caller',
      workingDirectory: input.own,
      projectPath: input.own,
      ...(input.capabilities ? { sessionCapabilities: input.capabilities } : {}),
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
    const call = (params: Record<string, unknown>) =>
      registered.execute(
        'definitions',
        params,
        new AbortController().signal,
        () => undefined,
        fromPartial({}),
      )
    return { call, gateway }
  }

  it('lists the definitions of the project it names, with that project’s toggles', async () => {
    const { own, other } = await projects()
    const { call, gateway } = hiveTool({
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
    expect(gateway).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          contract: 'session-query-v2',
          request: expect.objectContaining({
            query: { operation: 'list', limit: 1, projectPath: other, archived: false },
          }),
        }),
      }),
    )
  })

  it('searches the project it names', async () => {
    const { own, other } = await projects()
    const { call } = hiveTool({ own, known: [own, other] })

    const result = await call({
      action: 'agent_definitions_search',
      query: 'merge',
      projectPath: other,
    })

    expect(result.details).toEqual({
      definitions: [expect.objectContaining({ name: 'reviewer' })],
    })
  })

  it('reads a project that is not open in OpenWaggle but has a Session there', async () => {
    const { own, other } = await projects()
    const { call } = hiveTool({ own, known: [own], gateway: async () => listResult(1) })

    const result = await call({ action: 'agent_definitions_list', projectPath: other })

    expect(result.isError).toBeFalsy()
    expect(result.details).toEqual({
      definitions: expect.arrayContaining([expect.objectContaining({ name: 'reviewer' })]),
    })
  })

  it('refuses a directory that is neither open nor has a Session, instead of reading its own', async () => {
    const { own, other } = await projects()
    const { call } = hiveTool({ own, known: [own] })

    const result = await call({ action: 'agent_definitions_list', projectPath: other })

    expect(result.isError).toBe(true)
    expect(result.content).toEqual([
      { type: 'text', text: expect.stringContaining('is not a project in OpenWaggle') },
    ])
    expect(result.content[0]).not.toEqual(
      expect.objectContaining({ text: expect.stringContaining('catalogScope all') }),
    )
  })

  it('refuses another project, without asking the Host, to a Session that cannot create', async () => {
    const { own, other } = await projects()
    const { call, gateway } = hiveTool({
      own,
      known: [own, other],
      capabilities: WORKER_CAPABILITIES,
    })

    const result = await call({ action: 'agent_definitions_list', projectPath: other })

    expect(result.isError).toBe(true)
    expect(result.content).toEqual([
      { type: 'text', text: expect.stringMatching(/^capability_denied: .*sessions:create/) },
    ])
    expect(gateway).not.toHaveBeenCalled()
  })

  it('takes the Host’s scope refusal for a caller that can create but not reach the project', async () => {
    const { root, own, other } = await projects()
    const unknown = path.join(root, 'unknown')
    await fs.mkdir(unknown)
    const { call } = hiveTool({
      own,
      known: [own, other],
      capabilities: [...WORKER_CAPABILITIES, 'sessions:create'],
      gateway: scopeDenied,
    })

    const known = await call({ action: 'agent_definitions_list', projectPath: other })
    const notAProject = await call({ action: 'agent_definitions_list', projectPath: unknown })

    expect(known.isError).toBe(true)
    expect(known.content).toEqual([
      { type: 'text', text: expect.stringContaining('(target_scope_denied)') },
    ])
    // A refused caller cannot tell a project from any other directory.
    expect(notAProject.content).toEqual(known.content)
  })

  it('reads its own project by any spelling, without launch, create or the Host', async () => {
    const { root, own } = await projects()
    const link = path.join(root, 'own-link')
    await fs.symlink(own, link)
    const { call, gateway } = hiveTool({ own, known: [own], capabilities: WORKER_CAPABILITIES })

    for (const projectPath of [own, `${own}/`, path.join(own, 'x', '..'), link]) {
      const result = await call({ action: 'agent_definitions_list', projectPath })
      expect(result.details).toEqual({
        definitions: [expect.objectContaining({ name: 'mine' })],
      })
    }
    expect(gateway).not.toHaveBeenCalled()
  })

  it('refuses a relative projectPath', async () => {
    const { own } = await projects()
    const { call } = hiveTool({ own, known: [own] })

    const result = await call({ action: 'agent_definitions_list', projectPath: 'other' })

    expect(result.isError).toBe(true)
    expect(result.content).toEqual([
      {
        type: 'text',
        text: expect.stringContaining('projectPath must be an absolute project path'),
      },
    ])
  })
})
