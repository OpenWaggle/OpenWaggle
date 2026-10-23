import { describe, expect, it } from 'vitest'
import { parseMcpCliArguments } from '../mcp-cli-arguments'
import { describeTaskSchedule, exportedTasks } from '../schedules-cli-output'
import { buildSchedulesCliCommands, scheduleFromOptions } from '../schedules-cli-payload'
import { classifySessionsCliError } from '../sessions-cli-output'

const parsed = (...values: string[]) => parseMcpCliArguments(values)

describe('openwaggle schedules arguments', () => {
  it('reads each schedule form', () => {
    expect(scheduleFromOptions(parsed('--every', '30m'))).toEqual({
      kind: 'interval',
      everyMinutes: 30,
    })
    expect(scheduleFromOptions(parsed('--every', '2h'))).toEqual({
      kind: 'interval',
      everyMinutes: 120,
    })
    expect(scheduleFromOptions(parsed('--daily', '09:00', '--weekdays', 'weekdays'))).toEqual({
      kind: 'daily',
      at: '09:00',
      weekdays: [1, 2, 3, 4, 5],
    })
    expect(scheduleFromOptions(parsed('--rrule', 'FREQ=WEEKLY;BYDAY=MO'))).toEqual({
      kind: 'rrule',
      rule: 'FREQ=WEEKLY;BYDAY=MO',
    })
  })

  it('refuses two schedules, a bad time, and weekdays without a time', () => {
    expect(() => scheduleFromOptions(parsed('--every', '30', '--daily', '09:00'))).toThrow(/one of/)
    expect(() => scheduleFromOptions(parsed('--daily', '9am'))).toThrow(/HH:MM/)
    expect(() => scheduleFromOptions(parsed('--weekdays', '1,2'))).toThrow(/--daily/)
  })

  it('reports argument mistakes as usage errors', async () => {
    const missingPrompt = await buildSchedulesCliCommands(
      'create',
      parsed('heartbeat', 's-1', '--name', 'Watch', '--every', '30m'),
    ).catch((error: unknown) => error)
    expect(missingPrompt).toBeInstanceOf(Error)
    expect(classifySessionsCliError(missingPrompt)).toBe('usage')
    const badEvery = (() => {
      try {
        return scheduleFromOptions(parsed('--every', 'soon'))
      } catch (error) {
        return error
      }
    })()
    expect(classifySessionsCliError(badEvery)).toBe('usage')
  })

  it('builds a Heartbeat create with the prompt as the remaining words', async () => {
    const [command] = await buildSchedulesCliCommands(
      'create',
      parsed(
        'heartbeat',
        'openwaggle://sessions/s-1',
        '--name',
        'Watch',
        '--every',
        '15',
        'Check',
        'CI',
      ),
    )
    expect(command).toEqual({
      operation: 'create',
      input: {
        name: 'Watch',
        prompt: 'Check CI',
        enabled: true,
        schedule: { kind: 'interval', everyMinutes: 15 },
        target: { kind: 'heartbeat', sessionId: 's-1' },
      },
    })
  })

  it('builds a paused Launch schedule with its execution options', async () => {
    const [command] = await buildSchedulesCliCommands(
      'create',
      parsed(
        'launch',
        '/repo',
        '--name',
        'Triage',
        '--daily',
        '08:30',
        '--workspace',
        'local',
        '--model',
        'anthropic/claude',
        '--thinking',
        'high',
        '--archive-finished',
        '--paused',
        '--notify',
        'failures-only',
        '--max-runs',
        '10',
        '--prompt',
        'Triage new issues.',
      ),
    )
    expect(command).toMatchObject({
      operation: 'create',
      input: {
        enabled: false,
        notificationPolicy: 'failures-only',
        maxRuns: 10,
        target: {
          kind: 'launch',
          projectPath: '/repo',
          workspace: 'local',
          modelId: 'anthropic/claude',
          thinkingLevel: 'high',
          archiveFinishedSessions: true,
        },
      },
    })
  })

  it('maps pause, resume, run, and delete to their commands', async () => {
    expect(await buildSchedulesCliCommands('pause', parsed('t-1'))).toEqual([
      { operation: 'update', taskId: 't-1', patch: { enabled: false } },
    ])
    expect(await buildSchedulesCliCommands('resume', parsed('t-1'))).toEqual([
      { operation: 'update', taskId: 't-1', patch: { enabled: true } },
    ])
    expect(await buildSchedulesCliCommands('run', parsed('t-1'))).toEqual([
      { operation: 'run-now', taskId: 't-1' },
    ])
    expect(await buildSchedulesCliCommands('delete', parsed('t-1'))).toEqual([
      { operation: 'delete', taskId: 't-1' },
    ])
    await expect(buildSchedulesCliCommands('update', parsed('t-1'))).rejects.toThrow(/change/)
  })

  it('describes schedules for people', () => {
    expect(describeTaskSchedule({ kind: 'interval', everyMinutes: 30 })).toBe('every 30m')
    expect(describeTaskSchedule({ kind: 'interval', everyMinutes: 120 })).toBe('every 2h')
    expect(describeTaskSchedule({ kind: 'daily', at: '09:00', weekdays: [1, 2, 3, 4, 5] })).toBe(
      'weekdays at 09:00',
    )
    expect(describeTaskSchedule({ kind: 'daily', at: '09:00', weekdays: [1, 3] })).toBe(
      'Mon, Wed at 09:00',
    )
  })

  it('exports nothing but a list', () => {
    expect(
      exportedTasks({
        contractVersion: 1,
        requestId: 'r',
        operation: 'delete',
        outcome: { effect: 'deleted', taskId: 't' },
      }),
    ).toEqual([])
  })
})
