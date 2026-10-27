import type { ExtensionAPI, ToolDefinition } from '@earendil-works/pi-coding-agent'
import { fromPartial } from '@total-typescript/shoehorn'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installSessionToolGateway } from '../../../session-host/session-tool-gateway'
import { sessionsToolSchemaForCapabilities } from '../sessions-tool-capability-schema'
import { createSessionsToolExtension } from '../sessions-tool-extension'
import { renderScheduledTasksToolResult } from '../sessions-tool-schedule-result'
import { hiveHelpText } from './hive-help.test-utils'
import { result, task } from './sessions-tool-schedule.test-utils'

describe('Hive tool Scheduled task results', () => {
  it('renders tasks compactly with wall-clock times, seconds and offset in their stored zone', () => {
    const rendered = JSON.parse(
      renderScheduledTasksToolResult(
        result({
          effect: 'listed',
          tasks: [
            task({
              attention: { reason: 'target-session-archived', message: 'Archived.', since: 1 },
              lastRun: {
                id: 'run-1',
                taskId: 'task-1',
                trigger: 'run-now',
                nominalAt: Date.UTC(2025, 5, 1, 7, 0),
                firedAt: Date.UTC(2025, 5, 1, 7, 0),
                missedCount: 0,
                status: 'skipped',
                reason: 'session-busy',
              },
            }),
          ],
        }),
      ),
    )

    expect(rendered).toEqual({
      operation: 'list',
      effect: 'listed',
      tasks: [
        {
          id: 'task-1',
          name: 'Check CI',
          kind: 'heartbeat',
          enabled: true,
          schedule: 'daily 09:00 on Mon,Wed',
          timeZone: 'Europe/Madrid',
          nextRunAt: '2025-06-02 09:00:00 +02:00',
          nextRunJitter: '±5 min',
          runCount: 0,
          sessionId: 'session-self',
          attention: { reason: 'target-session-archived', message: 'Archived.' },
          lastRun: {
            status: 'skipped',
            trigger: 'run-now',
            firedAt: '2025-06-01 09:00:00 +02:00',
            reason: 'session-busy',
          },
        },
      ],
    })
  })

  it('includes the prompt and run history on read and keeps refusals explicit', () => {
    const read = JSON.parse(
      renderScheduledTasksToolResult(
        result(
          {
            effect: 'read',
            task: task({ schedule: { kind: 'interval', everyMinutes: 15 }, nextRunAt: null }),
            runs: [
              {
                id: 'run-2',
                taskId: 'task-1',
                trigger: 'catch-up',
                nominalAt: Date.UTC(2025, 5, 1, 6, 0),
                firedAt: Date.UTC(2025, 5, 1, 7, 0),
                missedCount: 3,
                status: 'started',
                sessionId: 'session-self',
                runId: 'run-x',
              },
            ],
          },
          'read',
        ),
      ),
    )
    expect(read.task).toMatchObject({
      schedule: 'every 15 min',
      nextRunAt: null,
      prompt: 'Check whether CI is green.',
    })
    expect(read.task).not.toHaveProperty('nextRunJitter')
    expect(read.runs).toEqual([
      {
        id: 'run-2',
        status: 'started',
        trigger: 'catch-up',
        firedAt: '2025-06-01 09:00:00 +02:00',
        nominalAt: '2025-06-01 08:00:00 +02:00',
        missed: 3,
        sessionId: 'session-self',
        runId: 'run-x',
      },
    ])

    expect(
      JSON.parse(
        renderScheduledTasksToolResult(
          result(
            { effect: 'rejected', code: 'invalid_schedule', message: 'Too frequent.' },
            'create',
          ),
        ),
      ),
    ).toEqual({
      operation: 'create',
      effect: 'rejected',
      code: 'invalid_schedule',
      message: 'Too frequent.',
    })
  })
})

describe('Hive tool Scheduled task times', () => {
  it('shows a jittered next run to the second beside its nominal time', () => {
    const rendered = JSON.parse(
      renderScheduledTasksToolResult(
        result({
          effect: 'listed',
          tasks: [
            task({
              schedule: { kind: 'daily', at: '10:00' },
              // 08:58:59Z is 09:58:59 in Madrid on 2026-10-26, after clocks went back.
              nextRunAt: Date.UTC(2026, 9, 26, 8, 58, 59),
              nextNominalAt: Date.UTC(2026, 9, 26, 9, 0),
            }),
          ],
        }),
      ),
    )
    expect(rendered.tasks[0]).toMatchObject({
      schedule: 'daily 10:00',
      nextRunAt: '2026-10-26 09:58:59 +01:00',
      nextNominalAt: '2026-10-26 10:00:00 +01:00',
      nextRunJitter: '±5 min',
    })
  })

  it('tells the two occurrences of a repeated hour apart, and reads run pages in UTC', () => {
    const run = (id: string, firedAt: number) => ({
      id,
      taskId: 'task-1',
      trigger: 'schedule' as const,
      nominalAt: firedAt,
      firedAt,
      missedCount: 0,
      status: 'started' as const,
    })
    const read = JSON.parse(
      renderScheduledTasksToolResult(
        result(
          {
            effect: 'read',
            task: task(),
            runs: [
              run('run-a', Date.UTC(2026, 9, 25, 0, 30)),
              run('run-b', Date.UTC(2026, 9, 25, 1, 30)),
            ],
          },
          'read',
        ),
      ),
    )
    expect(read.runs.map((entry: { firedAt: string }) => entry.firedAt)).toEqual([
      '2026-10-25 02:30:00 +02:00',
      '2026-10-25 02:30:00 +01:00',
    ])

    const page = JSON.parse(
      renderScheduledTasksToolResult(
        result(
          { effect: 'runs-listed', runs: [run('run-a', Date.UTC(2026, 9, 25, 0, 30))] },
          'runs',
        ),
      ),
    )
    expect(page).toMatchObject({
      timeZone: 'UTC',
      runs: [{ trigger: 'schedule', firedAt: '2026-10-25 00:30:00 +00:00' }],
    })
  })
})

describe('Hive tool Scheduled task registration', () => {
  let releaseGateway: (() => void) | undefined

  afterEach(() => {
    releaseGateway?.()
    releaseGateway = undefined
  })

  function register(
    capabilities?: Parameters<typeof createSessionsToolExtension>[0]['sessionCapabilities'],
  ) {
    let tool: ToolDefinition | undefined
    createSessionsToolExtension({
      sessionId: 'session-self',
      runId: 'run-current',
      workingDirectory: '/repo',
      projectPath: '/repo',
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

  it('keys a create by its tool call and answers with the compact task view', async () => {
    const gateway = vi.fn(async () => result({ effect: 'created', task: task() }, 'create'))
    releaseGateway = installSessionToolGateway(gateway)
    const tool = register()

    const toolResult = await tool.execute(
      'call-1',
      {
        action: 'schedule_create',
        name: 'Check CI',
        prompt: 'Check whether CI is green.',
        scheduleKind: 'heartbeat',
        schedule: { kind: 'daily', at: '09:00', weekdays: [1, 3] },
      },
      new AbortController().signal,
      () => undefined,
      fromPartial({}),
    )

    expect(gateway).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceSessionId: 'session-self',
        payload: expect.objectContaining({
          contract: 'scheduled-tasks-v1',
          request: expect.objectContaining({ idempotencyKey: 'sessions-tool:run-current:call-1' }),
        }),
      }),
    )
    const text = toolResult.content[0]
    expect(text?.type === 'text' && JSON.parse(text.text)).toMatchObject({
      operation: 'create',
      effect: 'created',
      task: {
        id: 'task-1',
        schedule: 'daily 09:00 on Mon,Wed',
        nextRunAt: '2025-06-02 09:00:00 +02:00',
      },
    })
    expect(toolResult.details).toEqual(result({ effect: 'created', task: task() }, 'create'))
  })

  it('offers schedule actions and guidance only to Sessions that hold schedule capabilities', async () => {
    const actionsOf = (
      capabilities: Parameters<typeof sessionsToolSchemaForCapabilities>[0]['capabilities'],
    ) =>
      JSON.stringify(
        sessionsToolSchemaForCapabilities({ capabilities, modelMultiAgentEnabled: true }),
      )

    expect(actionsOf(['sessions:read'])).not.toContain('schedule_')
    const reader = actionsOf(['schedules:read'])
    expect(reader).toContain('"schedule_list"')
    expect(reader).toContain('"schedule_runs"')
    expect(reader).not.toContain('"schedule_create"')
    const manager = actionsOf(['schedules:read', 'schedules:manage'])
    for (const action of [
      'schedule_create',
      'schedule_update',
      'schedule_delete',
      'schedule_run_now',
    ]) {
      expect(manager).toContain(`"${action}"`)
    }

    expect(await hiveHelpText(register(['sessions:read', 'delegations:contribute']))).not.toContain(
      'Heartbeat',
    )
    const root = await hiveHelpText(
      register(['sessions:read', 'schedules:read', 'schedules:manage']),
    )
    // The system prompt keeps the rule that guards creating one.
    expect(register(['schedules:read', 'schedules:manage']).promptGuidelines).toEqual(
      expect.arrayContaining([expect.stringMatching(/Scheduled task only when the user asks/)]),
    )
    expect(root).toMatch(/only when the user directly asks for recurring or scheduled work/)
    expect(root).toMatch(/this Session when sessionId is omitted/)
    expect(root).toMatch(/Heartbeat fires at most every 5 minutes, a Launch schedule every 15/)
    expect(root).toMatch(/never convert them to UTC/)
    expect(root).toMatch(/pause it with schedule_update enabled false/)
  })
})
