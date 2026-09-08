import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type {
  ExtensionContributionRegistryEntry,
  ExtensionSessionSummaryRowView,
} from '@shared/types/extensions'
import type { SessionResource } from '@shared/types/session-resource'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ExtensionSessionSummarySections } from '../ExtensionSessionSummarySections'
import {
  baseEntry,
  PROJECT_PATH,
  registry,
  sessionResource,
  summaryEntry,
} from './extension-session-summary-test-fixtures'

const invokeExtension = vi.hoisted(() => vi.fn())

vi.mock('@/shared/lib/ipc', () => ({ api: { invokeExtension } }))

function summaryWithRows(rows: readonly ExtensionSessionSummaryRowView[]) {
  const summary = summaryEntry()
  if (!summary.sessionSummary) throw new Error('Expected a Session Summary fixture')
  return {
    ...summary,
    sessionSummary: { ...summary.sessionSummary, rows },
  } satisfies ExtensionContributionRegistryEntry
}

function commandEntry(
  contributionId: string,
  overrides: Partial<ExtensionContributionRegistryEntry> = {},
) {
  return {
    ...baseEntry(OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.COMMANDS, contributionId),
    ...overrides,
  } satisfies ExtensionContributionRegistryEntry
}

function renderSummary(
  entries: readonly ExtensionContributionRegistryEntry[],
  resources: readonly SessionResource[] = [],
) {
  const onOpenResources = vi.fn()
  render(
    <ExtensionSessionSummarySections
      registry={registry(entries)}
      projectPaths={[PROJECT_PATH]}
      sessionId="session-one"
      messageCount={1}
      placement="details"
      resources={resources}
      onOpenResources={onOpenResources}
    />,
  )
  return { onOpenResources }
}

describe('Extension Session Summary commands', () => {
  beforeEach(() => {
    localStorage.clear()
    invokeExtension.mockReset().mockResolvedValue({
      ok: false,
      error: { message: 'Invocation stopped by the test.' },
    })
  })

  it('explains why commands without a singular executable binding are disabled', () => {
    const summary = summaryWithRows([
      {
        id: 'missing-binding-row',
        label: 'Missing binding',
        action: { family: 'commands', contributionId: 'missing-binding' },
      },
      {
        id: 'methods-only-row',
        label: 'Methods only',
        action: { family: 'commands', contributionId: 'methods-only' },
      },
    ])
    const missingBinding = commandEntry('missing-binding')
    const methodsOnly = commandEntry('methods-only', {
      capability: 'sample.capability',
      methods: ['run'],
    })

    renderSummary([summary, missingBinding, methodsOnly])

    for (const label of ['Missing binding', 'Methods only']) {
      const action = screen.getByRole('button', { name: label })
      expect(action).toHaveAttribute('aria-disabled', 'true')
      expect(action).toHaveAccessibleDescription(
        'This extension command has no executable capability binding.',
      )
    }
  })

  it('explains when a bound command cannot resolve a scope for the current Session', () => {
    const summary = summaryWithRows([
      {
        id: 'wrong-scope-row',
        label: 'Run elsewhere',
        action: { family: 'commands', contributionId: 'wrong-scope' },
      },
    ])
    const command = commandEntry('wrong-scope', {
      capability: 'sample.capability',
      method: 'run',
      declaredScopes: ['session'],
      projectPaths: ['/another-project'],
    })

    renderSummary([summary, command])

    const action = screen.getByRole('button', { name: 'Run elsewhere' })
    expect(action).toHaveAttribute('aria-disabled', 'true')
    expect(action).toHaveAccessibleDescription(
      'This extension command is unavailable in the current Session.',
    )
  })

  it('invokes a bound command when its Session scope resolves', async () => {
    const summary = summaryWithRows([
      {
        id: 'run-row',
        label: 'Run command',
        action: { family: 'commands', contributionId: 'run-command' },
      },
    ])
    const command = commandEntry('run-command', {
      capability: 'sample.capability',
      method: 'run',
      declaredScopes: ['session'],
    })

    renderSummary([summary, command])
    const action = screen.getByRole('button', { name: 'Run command' })
    expect(action).not.toHaveAttribute('aria-disabled')
    fireEvent.click(action)

    await waitFor(() =>
      expect(invokeExtension).toHaveBeenCalledWith(
        {
          extensionId: 'summary-extension',
          contributionId: 'run-command',
          capability: 'sample.capability',
          method: 'run',
          scope: { kind: 'session', projectPath: PROJECT_PATH, sessionId: 'session-one' },
          payload: {},
        },
        'host-issued-binding',
      ),
    )
  })

  it('keeps a valid resource actionable when a legacy row also names a disabled command', () => {
    const summary = summaryWithRows([
      {
        id: 'legacy-two-target-row',
        label: 'Open resource',
        resourceId: 'resource-one',
        action: { family: 'commands', contributionId: 'missing-binding' },
      },
    ])
    const missingBinding = commandEntry('missing-binding')
    const { onOpenResources } = renderSummary([summary, missingBinding], [sessionResource('file')])

    const action = screen.getByRole('button', { name: 'Open resource' })
    expect(action).not.toHaveAttribute('aria-disabled')
    fireEvent.click(action)
    expect(onOpenResources).toHaveBeenCalledWith({ view: 'outputs', resourceId: 'resource-one' })
    expect(invokeExtension).not.toHaveBeenCalled()
  })
})
