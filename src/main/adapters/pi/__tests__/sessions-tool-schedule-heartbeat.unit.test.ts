import type { ExtensionAPI, ToolDefinition } from '@earendil-works/pi-coding-agent'
import type { LocalSessionCommandPayload } from '@shared/types/local-session-protocol'
import { fromPartial } from '@total-typescript/shoehorn'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installSessionToolGateway } from '../../../session-host/session-tool-gateway'
import { createSessionsToolExtension } from '../sessions-tool-extension'
import { renderScheduledTasksToolResult } from '../sessions-tool-schedule-result'
import { gatedTask, result, task } from './sessions-tool-schedule.test-utils'

let releaseGateway: (() => void) | undefined

afterEach(() => {
  releaseGateway?.()
  releaseGateway = undefined
})

function register() {
  let tool: ToolDefinition | undefined
  createSessionsToolExtension({
    sessionId: 'session-self',
    runId: 'run-current',
    workingDirectory: '/repo',
    projectPath: '/repo',
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

const CREATE = {
  action: 'schedule_create',
  name: 'Babysit CI',
  prompt: 'Fix failing checks.',
  scheduleKind: 'heartbeat',
  schedule: { kind: 'interval', everyMinutes: 30 },
  stopWhen: 'PR 42 merged',
  wakeIf: 'gh pr checks 42 | grep fail',
} as const

function gatewayAnswering(approvedTask = gatedTask('approved')) {
  return vi.fn(async (input: { readonly payload: LocalSessionCommandPayload }) => {
    const command =
      input.payload.contract === 'scheduled-tasks-v1' ? input.payload.request.command : null
    return command?.operation === 'approve-wake-check'
      ? result({ effect: 'updated', task: approvedTask }, 'approve-wake-check')
      : result({ effect: 'created', task: gatedTask('pending') }, 'create')
  })
}

function textOf(toolResult: Awaited<ReturnType<ToolDefinition['execute']>>) {
  const text = toolResult.content[0]
  return text?.type === 'text' ? JSON.parse(text.text) : null
}

describe('Hive tool Wake check approval (#388)', () => {
  it('asks the user to approve the exact command and sends the approval only on yes', async () => {
    const gateway = gatewayAnswering()
    releaseGateway = installSessionToolGateway(gateway)
    const confirm = vi.fn(async () => true)
    const toolResult = await register().execute(
      'call-1',
      CREATE,
      new AbortController().signal,
      () => undefined,
      fromPartial({ hasUI: true, ui: { confirm } }),
    )
    expect(confirm).toHaveBeenCalledWith(
      'Approve this Heartbeat’s Wake check?',
      expect.stringContaining('gh pr checks 42 | grep fail'),
      expect.anything(),
    )
    expect(gateway).toHaveBeenLastCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          request: expect.objectContaining({
            command: {
              operation: 'approve-wake-check',
              taskId: 'task-1',
              command: 'gh pr checks 42 | grep fail',
            },
          }),
        }),
      }),
    )
    expect(textOf(toolResult)).toMatchObject({
      operation: 'create',
      effect: 'created',
      task: { wakeIf: 'gh pr checks 42 | grep fail', wakeCheckApproval: 'approved' },
    })
  })

  it('leaves the Heartbeat held when the user declines or no one can answer', async () => {
    const gateway = gatewayAnswering()
    releaseGateway = installSessionToolGateway(gateway)
    const declined = await register().execute(
      'call-2',
      CREATE,
      new AbortController().signal,
      () => undefined,
      fromPartial({ hasUI: true, ui: { confirm: async () => false } }),
    )
    expect(textOf(declined)).toMatchObject({ task: { wakeCheckApproval: 'pending' } })
    await register().execute(
      'call-3',
      CREATE,
      new AbortController().signal,
      () => undefined,
      fromPartial({ hasUI: false }),
    )
    const approvals = gateway.mock.calls.filter(
      ([input]) =>
        input.payload.contract === 'scheduled-tasks-v1' &&
        input.payload.request.command.operation === 'approve-wake-check',
    )
    expect(approvals).toHaveLength(0)
  })

  it('does not ask when the Wake check needs no approval', async () => {
    releaseGateway = installSessionToolGateway(
      vi.fn(async () => result({ effect: 'created', task: gatedTask('not-required') }, 'create')),
    )
    const confirm = vi.fn(async () => true)
    await register().execute(
      'call-4',
      CREATE,
      new AbortController().signal,
      () => undefined,
      fromPartial({ hasUI: true, ui: { confirm } }),
    )
    expect(confirm).not.toHaveBeenCalled()
  })
})

describe('Hive tool Heartbeat results (#388)', () => {
  it('shows the Stop condition, idle count, Auto-pause, and each run outcome', () => {
    const paused = task({
      enabled: false,
      heartbeat: {
        stopWhen: 'PR 42 merged',
        indefinite: false,
        idlePauseAfter: 3,
        wakeCheck: null,
        consecutiveIdleRuns: 3,
        autoPause: { reason: 'idle', message: 'auto-paused: 3 idle runs', since: 5 },
      },
    })
    const rendered = JSON.parse(
      renderScheduledTasksToolResult(
        result(
          {
            effect: 'read',
            task: paused,
            runs: [
              {
                id: 'run-1',
                taskId: 'task-1',
                trigger: 'schedule',
                nominalAt: 0,
                firedAt: 0,
                missedCount: 0,
                status: 'skipped',
                reason: 'wake-check-idle',
                wakeCheck: 'idle',
              },
              {
                id: 'run-0',
                taskId: 'task-1',
                trigger: 'schedule',
                nominalAt: 0,
                firedAt: 0,
                missedCount: 0,
                status: 'started',
                outcome: { value: 'idle', source: 'inferred' },
              },
            ],
          },
          'read',
        ),
      ),
    )
    expect(rendered.task).toMatchObject({
      stopWhen: 'PR 42 merged',
      idlePauseAfter: 3,
      consecutiveIdleRuns: 3,
      autoPaused: 'auto-paused: 3 idle runs',
    })
    expect(rendered.runs).toMatchObject([
      { status: 'skipped', reason: 'wake-check-idle', wakeCheck: 'idle' },
      { status: 'started', outcome: 'idle', outcomeSource: 'inferred' },
    ])
  })
})
