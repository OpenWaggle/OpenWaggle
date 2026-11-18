import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useSessionSummaryUIStore } from '../../state/session-summary-ui-store'
import {
  renderHub,
  setActionRuns,
  setupSessionSummaryHubHarness,
} from './session-summary-hub.test-harness'

describe('Session Summary action activity', () => {
  beforeEach(setupSessionSummaryHubHarness)

  it('shows running actions before the first agent message', async () => {
    setActionRuns([
      {
        id: 'build',
        requestId: 'start',
        workspaceId: 'workspace',
        projectPath: '/project',
        workspacePath: '/project',
        action: {
          id: 'build',
          name: 'Build preview',
          icon: 'build',
          invocation: { type: 'command', command: 'pnpm build', directory: '.' },
          kind: 'task',
          allowConcurrent: false,
          autoOpenPreview: false,
        },
        invocation: { type: 'command', command: 'pnpm build', cwd: '/project' },
        status: 'running',
        startedAt: 1,
        finishedAt: null,
        exitCode: null,
        error: null,
        previewUrl: null,
        ready: false,
        outputBytes: 0,
      },
    ])
    renderHub({ messageCount: 0 })
    expect(await screen.findByText('Build preview')).toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: 'Session Summary' })).toBeInTheDocument()
    expect(useSessionSummaryUIStore.getState().panels['session-1']?.available).toBe(true)
  })
})
