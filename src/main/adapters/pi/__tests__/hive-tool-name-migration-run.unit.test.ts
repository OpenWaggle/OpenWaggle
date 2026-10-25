import { DatabaseSync } from 'node:sqlite'
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it, vi } from 'vitest'
import { HIVE_TOOL_NAME_MIGRATION_STATEMENTS } from '../../../services/hive-tool-name-migration'
import { resolveSessionRunExecution } from '../../session-run-execution-profile'
import {
  createAgentRunContextExtension,
  createAgentToolAllowlistGuard,
} from '../agent-run-context-extension'

/** The tools a Run of this stored profile makes active, and which ones it lets the model call. */
async function runTools(profileJson: string) {
  const resolved = resolveSessionRunExecution(
    {
      session_id: 'queen-1',
      title: 'Coordinate',
      project_path: '/repo',
      profile_json: profileJson,
      resolved_agent_snapshot_json: null,
      authorization_ceiling: 'ask-for-approval',
      parent_session_id: null,
      parent_title: null,
      hive_root_session_id: 'queen-1',
      depth: 0,
      direct_worker_count: 0,
      workspace_id: 'workspace-1',
      workspace_kind: 'local',
      working_path: '/repo',
      capabilities_json: null,
      delegation_id: null,
      delegation_state: null,
    },
    'run-1',
  )
  const setActiveTools = vi.fn()
  let toolCall:
    | ((event: { readonly toolName: string }) => { readonly block: boolean } | undefined)
    | undefined
  let beforeStart:
    | ((
        event: { readonly systemPromptOptions: { sections: Record<string, string> } },
        ctx: ExtensionContext,
      ) => unknown)
    | undefined
  const pi = fromPartial<ExtensionAPI>({
    on: (event: string, handler: never) => {
      if (event === 'tool_call') toolCall = handler
      if (event === 'before_agent_start') beforeStart = handler
    },
    getActiveTools: () => ['read', 'bash', 'hive'],
    setActiveTools,
    appendEntry: vi.fn(),
  })
  const input = {
    ...(resolved.toolAllowlist ? { toolAllowlist: resolved.toolAllowlist } : {}),
    sessionIdentityContext: resolved.identityContext,
  }
  createAgentToolAllowlistGuard(input)?.(pi)
  createAgentRunContextExtension(input)(pi)
  await beforeStart?.(
    { systemPromptOptions: { sections: {} } },
    fromPartial<ExtensionContext>({ sessionManager: { getBranch: () => [] } }),
  )
  return {
    active: setActiveTools.mock.calls.at(-1)?.[0],
    hiveBlocked: toolCall?.({ toolName: 'hive' })?.block ?? false,
  }
}

/** A Session created before ADR 0053 from an Agent definition whose `tools` listed `sessions`. */
function storedProfile() {
  const database = new DatabaseSync(':memory:')
  database.exec(`CREATE TABLE session_execution_profiles (
    session_id TEXT PRIMARY KEY,
    profile_json TEXT NOT NULL,
    resolved_agent_snapshot_json TEXT,
    updated_at INTEGER NOT NULL
  )`)
  database.prepare('INSERT INTO session_execution_profiles VALUES (?, ?, NULL, 1)').run(
    'queen-1',
    JSON.stringify({
      modelId: 'openai/gpt-5.5',
      thinkingLevel: 'high',
      tools: ['read', 'sessions', 'bash'],
    }),
  )
  const read = () =>
    String(
      database.prepare('SELECT profile_json FROM session_execution_profiles').get()?.profile_json,
    )
  return { database, read }
}

describe('a Run of a Session stored before the hive rename', () => {
  it('loses the hive tool before the migration and keeps it after', async () => {
    const { database, read } = storedProfile()
    try {
      expect(await runTools(read())).toEqual({ active: ['read', 'bash'], hiveBlocked: true })

      for (const statement of HIVE_TOOL_NAME_MIGRATION_STATEMENTS) database.exec(statement)

      expect(await runTools(read())).toEqual({
        active: ['read', 'bash', 'hive'],
        hiveBlocked: false,
      })
    } finally {
      database.close()
    }
  })
})
