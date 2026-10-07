import { describe, expect, it } from 'vitest'
import { usageStatisticsMcpServerIdentifier } from '../usage-statistics-mcp'
import {
  usageStatisticsDurationSeconds,
  usageStatisticsEntryPointForCaller,
  usageStatisticsRunResult,
  usageStatisticsStartAccessMode,
  usageStatisticsTokenCount,
} from '../usage-statistics-run-mapping'

describe('Usage statistics Run mapping', () => {
  it.each([
    ['gui:local-user', 'app'],
    ['session-agent:session-1:run-1', 'agent'],
    ['transient-mcp:abc123', 'agent'],
    ['local-user:abc123', 'cli'],
    ['profile:release-bot', 'agent'],
    ['something-new', 'cli'],
  ] as const)('maps caller %s to entry point %s', (callerId, entryPoint) => {
    expect(usageStatisticsEntryPointForCaller(callerId)).toBe(entryPoint)
  })

  it('starts a Run under the mode the Host already holds, most specific first', () => {
    const none = { ceiling: null, sessionMode: null, globalDefault: null } as const

    expect(usageStatisticsStartAccessMode({ ...none, globalDefault: 'yolo' })).toBe('yolo')
    expect(
      usageStatisticsStartAccessMode({
        ...none,
        sessionMode: 'ask-for-approval',
        globalDefault: 'yolo',
      }),
    ).toBe('ask-for-approval')
    expect(
      usageStatisticsStartAccessMode({
        ...none,
        runOverride: 'yolo',
        sessionMode: 'ask-for-approval',
      }),
    ).toBe('yolo')
    // The project default sits between the Session's mode and the global default.
    expect(
      usageStatisticsStartAccessMode({
        ...none,
        projectDefault: 'ask-for-approval',
        globalDefault: 'yolo',
      }),
    ).toBe('ask-for-approval')
    expect(
      usageStatisticsStartAccessMode({
        ...none,
        sessionMode: 'yolo',
        projectDefault: 'ask-for-approval',
      }),
    ).toBe('yolo')
    // An Ask for Approval ceiling wins over every override; nothing known fails closed.
    expect(
      usageStatisticsStartAccessMode({ ...none, ceiling: 'ask-for-approval', runOverride: 'yolo' }),
    ).toBe('ask-for-approval')
    expect(usageStatisticsStartAccessMode(none)).toBe('ask-for-approval')
  })

  it('maps every terminal status to a published result', () => {
    expect(usageStatisticsRunResult('completed')).toBe('completed')
    expect(usageStatisticsRunResult('failed')).toBe('failed')
    expect(usageStatisticsRunResult('interrupted')).toBe('interrupted')
    expect(usageStatisticsRunResult('interrupted-by-interaction-timeout')).toBe('interrupted')
  })

  it('rounds durations to seconds within the accepted range', () => {
    expect(usageStatisticsDurationSeconds(1_000, 3_600)).toBe(3)
    expect(usageStatisticsDurationSeconds(5_000, 1_000)).toBe(0)
    expect(usageStatisticsDurationSeconds(0, 30 * 24 * 3_600_000)).toBe(604_800)
  })

  it('keeps token counts finite, whole and non-negative', () => {
    expect(usageStatisticsTokenCount(12.6)).toBe(13)
    expect(usageStatisticsTokenCount(-4)).toBe(0)
    expect(usageStatisticsTokenCount(Number.NaN)).toBe(0)
    expect(usageStatisticsTokenCount(Number.POSITIVE_INFINITY)).toBe(0)
  })
})

describe('Usage statistics MCP server identifiers', () => {
  const devtools = { command: 'npx', args: ['chrome-devtools-mcp@latest'] }

  it('names a catalog server that launches as the catalog installs it, under either spelling', () => {
    expect(usageStatisticsMcpServerIdentifier({ name: 'chrome-devtools', launch: devtools })).toBe(
      'chrome-devtools',
    )
    // Pi puts `chrome_devtools` in the tool name; a server saved under that name is the same one.
    expect(usageStatisticsMcpServerIdentifier({ name: 'chrome_devtools', launch: devtools })).toBe(
      'chrome-devtools',
    )
  })

  it("reports a user's own server that only shares a catalog name as custom", () => {
    expect(
      usageStatisticsMcpServerIdentifier({
        name: 'chrome-devtools',
        launch: { command: 'node', args: ['/home/me/devtools-fork.js'] },
      }),
    ).toBe('custom')
    expect(
      usageStatisticsMcpServerIdentifier({
        name: 'playwright',
        launch: { url: 'https://internal.example/mcp' },
      }),
    ).toBe('custom')
  })

  it('reports every other server, and servers whose config is unknown, as custom', () => {
    expect(usageStatisticsMcpServerIdentifier({ name: 'acme-internal', launch: devtools })).toBe(
      'custom',
    )
    expect(usageStatisticsMcpServerIdentifier({ name: 'chrome-devtools', launch: undefined })).toBe(
      'custom',
    )
  })
})
