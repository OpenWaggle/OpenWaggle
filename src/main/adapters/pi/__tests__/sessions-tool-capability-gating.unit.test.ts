import type { ExtensionAPI, ToolDefinition } from '@earendil-works/pi-coding-agent'
import type { SessionCapability } from '@shared/types/session-capability'
import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it } from 'vitest'
import { createSessionsToolExtension } from '../sessions-tool-extension'
import { hiveHelpText } from './hive-help.test-utils'

/** What the spawned Worker of a Queen holds (derived grant), never create, start, or organize. */
const WORKER_CAPABILITIES: readonly SessionCapability[] = [
  'sessions:discover',
  'sessions:read',
  'sessions:spawn',
  'sessions:message',
  'sessions:steer',
  'sessions:interrupt',
  'sessions:queue',
  'sessions:report',
  'delegations:read',
  'delegations:contribute',
  'delegations:review',
]

function register(capabilities?: readonly SessionCapability[], modelMultiAgentEnabled = true) {
  let tool: ToolDefinition | undefined
  createSessionsToolExtension({
    sessionId: 'session-worker',
    runId: 'run-current',
    workingDirectory: '/repo',
    projectPath: '/repo',
    modelMultiAgentEnabled,
    ...(capabilities ? { sessionCapabilities: capabilities } : {}),
  })(
    fromPartial<ExtensionAPI>({
      registerTool: (registered: ToolDefinition) => {
        tool = registered
      },
    }),
  )
  if (!tool) throw new Error('hive tool was not registered')
  return tool
}

/** Every rule the grant gets, as help returns it; the system prompt carries the essentials. */
function guidance(tool: ToolDefinition) {
  return hiveHelpText(tool)
}

function prepare(tool: ToolDefinition, args: unknown) {
  if (!tool.prepareArguments) throw new Error('the hive tool prepares no arguments')
  return tool.prepareArguments(args)
}

describe('Hive tool capability gating', () => {
  it('advertises only the actions the Session grant carries', async () => {
    const text = await guidance(register(WORKER_CAPABILITIES))

    for (const action of [
      'launch',
      'create',
      'fork',
      'unarchive',
      'export_create',
      'exports_wait',
      'authorization_set',
      'approval_respond',
    ]) {
      expect(text).not.toMatch(new RegExp(`\\b${action}\\b`))
    }
    expect(text).not.toMatch(/start for an idle Session|\bstart accepts|Sending start/)
    expect(text).toMatch(/Use spawn for a new Worker Session/)
    expect(text).toMatch(
      /spawn accepts thinking as the new Session's starting level and authorization/,
    )
    expect(text).toMatch(/follow_up for durable work after its current Run/)
    expect(text).toMatch(/steer to append to one exact active Run/)
  })

  it('keeps the full guidance for a Session without a derived grant', async () => {
    const text = await guidance(register())

    for (const action of ['launch', 'create', 'start', 'unarchive', 'export_create']) {
      expect(text).toMatch(new RegExp(`\\b${action}\\b`))
    }
  })

  it('describes the catalog defaults to any Session that can discover', async () => {
    expect(await guidance(register(WORKER_CAPABILITIES))).toMatch(
      /current project by default, every worktree of it included.*list leaves archived Sessions out unless archived is true.*delegations_list shows every state, newest first/s,
    )
  })

  it('describes only the discovery actions the grant carries', async () => {
    const text = await guidance(register(['sessions:discover']))

    expect(text).toMatch(/list and search look at your current project by default/)
    expect(text).not.toMatch(/delegations_list/)
  })

  it('points a delegations-only grant at delegations_list, not list or search', async () => {
    const text = await guidance(register(['delegations:read']))

    expect(text).toMatch(/Use delegations_list with catalogScope project/)
    expect(text).not.toMatch(/\b(list|search) (and|or|with|look)/)
  })

  it('refuses an action outside the grant with the capability it needs', () => {
    const tool = register(WORKER_CAPABILITIES)

    expect(() => prepare(tool, { action: 'fork', sessionId: 'session-worker' })).toThrow(
      'capability_denied: the hive action fork requires sessions:create and sessions:read; this Session has no sessions:create.',
    )
    expect(() => prepare(tool, { action: 'launch', objective: 'x' })).toThrow(
      /hive action launch requires sessions:create and sessions:start/,
    )
  })

  it('explains that spawn and launch need multi-agent work enabled for the model', async () => {
    const tool = register(WORKER_CAPABILITIES, false)

    expect(() => prepare(tool, { action: 'spawn', objective: 'x' })).toThrow(
      /hive action spawn is not available: multi-agent work is turned off/,
    )
    expect(await guidance(tool)).not.toMatch(/\bspawn\b/)
  })

  it('passes a permitted action on to schema validation unchanged', () => {
    const tool = register(WORKER_CAPABILITIES)
    const permitted = { action: 'read', sessionId: 'session-worker' }

    expect(prepare(tool, permitted)).toBe(permitted)
  })

  it('names an unknown action instead of failing every action constant', () => {
    expect(() => prepare(register(WORKER_CAPABILITIES), { action: 'bogus_action' })).toThrow(
      'Unknown hive action "bogus_action".',
    )
  })
})
