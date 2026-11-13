import type { ExtensionAPI, ToolDefinition } from '@earendil-works/pi-coding-agent'
import {
  DEFAULT_SESSION_AGENT_CAPABILITIES,
  type SessionCapability,
} from '@shared/types/session-capability'
import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it } from 'vitest'
import { resolveSessionRunExecution } from '../../session-run-execution-profile'
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

const SCHEDULE_ACTIONS = [
  'schedule_list',
  'schedule_read',
  'schedule_runs',
  'schedule_create',
  'schedule_update',
  'schedule_delete',
  'schedule_run_now',
  'schedule_outcome',
]

/** What a top-level Session made from the desktop before Scheduled tasks existed persisted. */
const DEFAULT_BEFORE_SCHEDULED_TASKS = DEFAULT_SESSION_AGENT_CAPABILITIES.filter(
  (capability) => capability !== 'schedules:read' && capability !== 'schedules:manage',
)

/** The grant the Host gives the agent of a desktop-started root Session. */
function desktopRootCapabilities(persisted?: readonly SessionCapability[]) {
  return resolveSessionRunExecution(
    {
      session_id: 'queen',
      title: 'Queen',
      project_path: '/repo',
      profile_json: JSON.stringify({
        modelId: 'openai/gpt-5.5',
        thinkingLevel: 'high',
        ...(persisted ? { sessionCapabilities: persisted } : {}),
      }),
      resolved_agent_snapshot_json: null,
      authorization_ceiling: 'yolo',
      parent_session_id: null,
      parent_title: null,
      hive_root_session_id: null,
      depth: null,
      direct_worker_count: 0,
      workspace_id: 'workspace',
      workspace_kind: 'managed-worktree',
      working_path: '/repo',
      capabilities_json: null,
      delegation_id: null,
      delegation_state: null,
    },
    'run-queen',
  ).sessionCapabilities
}

async function helpError(tool: ToolDefinition, topic: string) {
  const result = await tool.execute(
    'help-call',
    { action: 'help', topic },
    undefined,
    undefined,
    fromPartial({}),
  )
  return {
    isError: 'isError' in result ? result.isError : undefined,
    text: result.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join(''),
  }
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

  it('lists every schedule action for a desktop-started root Session', async () => {
    for (const capabilities of [
      desktopRootCapabilities(),
      desktopRootCapabilities(DEFAULT_BEFORE_SCHEDULED_TASKS),
    ]) {
      const text = await guidance(register(capabilities))

      for (const action of SCHEDULE_ACTIONS)
        expect(text).toMatch(new RegExp(`^- ${action}\\(`, 'm'))
      expect(text).not.toMatch(/Not available to this Session/)
    }
  })

  it('says why a Worker has no schedule actions instead of leaving them out silently', async () => {
    const tool = register(WORKER_CAPABILITIES)
    const text = await guidance(tool)

    expect(text).not.toMatch(/^- schedule_/m)
    expect(text).toMatch(
      /Not available to this Session:\n- Scheduled tasks are not available to this Session: it has no schedules:read or schedules:manage.*A Worker never gets them.*Scheduled panel or with openwaggle schedules/s,
    )
    expect(await helpError(tool, 'schedule_create')).toEqual({
      isError: true,
      text: expect.stringMatching(
        /^The hive action schedule_create is not available to this Session: it requires schedules:manage, and this Session has no schedules:manage\. A Worker never gets them\./,
      ),
    })
    expect(() => prepare(tool, { action: 'schedule_list' })).toThrow(
      /capability_denied: the hive action schedule_list requires schedules:read; this Session has no schedules:read\. A Worker never gets them\./,
    )
  })

  it('explains a read-only schedule grant and any other action outside the grant', async () => {
    const readOnly = register([...WORKER_CAPABILITIES, 'schedules:read'])

    expect(await guidance(readOnly)).toMatch(
      /This Session has schedules:read but no schedules:manage: it can list and read Scheduled tasks/,
    )
    expect((await helpError(register(WORKER_CAPABILITIES), 'fork')).text).toBe(
      'The hive action fork is not available to this Session: it requires sessions:create and sessions:read, and this Session has no sessions:create.',
    )
    expect((await helpError(register(WORKER_CAPABILITIES), 'bogus')).text).toMatch(
      /^No hive action "bogus" for this Session\. Actions: /,
    )
  })
})
