import { SessionId, SupportedModelId, WagglePresetId } from '@shared/types/brand'
import type { WagglePreset } from '@shared/types/waggle'
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useComposerStore } from '@/features/composer/state'
import { useComposerSection } from '../useComposerSection'

const SESSION_ID = SessionId('session-1')

function wagglePreset(): WagglePreset {
  return {
    id: WagglePresetId('review'),
    name: 'Review',
    description: 'Review changes',
    config: {
      mode: 'sequential',
      agents: [
        {
          label: 'Architect',
          model: SupportedModelId('openai/gpt-5.5'),
          roleDescription: 'Designs the solution',
          color: 'blue',
        },
        {
          label: 'Reviewer',
          model: SupportedModelId('anthropic/claude-sonnet-4'),
          roleDescription: 'Reviews the solution',
          color: 'amber',
        },
      ],
      stop: { primary: 'consensus', maxTurnsSafety: 4 },
    },
    isBuiltIn: false,
    createdAt: 1,
    updatedAt: 1,
  }
}

function composerSectionParams(): Parameters<typeof useComposerSection>[0] {
  return {
    isLoading: false,
    isSteering: false,
    status: 'ready',
    compactionStatus: null,
    activeSessionId: SESSION_ID,
    waggleStatus: 'idle',
    slashCommandMenuOpen: false,
    slashSkills: [],
    forkSelectorOpen: false,
    forkTargets: [],
    phase: {
      current: { label: 'Thinking', elapsedMs: 10 },
      completed: [],
      totalElapsedMs: 0,
      reset: vi.fn(),
    },
    stop: vi.fn(),
    showToast: vi.fn(),
    handleSteer: vi.fn().mockResolvedValue(undefined),
    handleSendWithWaggle: vi.fn().mockResolvedValue(undefined),
    handleStopCollaboration: vi.fn(),
    handleSkipBranchSummary: vi.fn(),
    handleSummarizeBranch: vi.fn(),
    handleStartCustomBranchSummary: vi.fn(),
    handleCancelBranchSummary: vi.fn(),
    handleOpenForkSelector: vi.fn(),
    handleCloseForkSelector: vi.fn(),
    handleSelectForkTarget: vi.fn(),
    handleCloneToNewSession: vi.fn(),
  }
}

describe('useComposerSection', () => {
  it('preserves prompt text when inserting skill and Waggle invocations', () => {
    const existingPrompt = 'Keep the existing prompt /'
    useComposerStore.setState({ input: existingPrompt, cursorIndex: existingPrompt.length })
    const { result } = renderHook(() => useComposerSection(composerSectionParams()))

    act(() => result.current.onSelectSkill('audit'))
    act(() =>
      useComposerStore.setState({ input: existingPrompt, cursorIndex: existingPrompt.length }),
    )
    act(() => result.current.onStartWaggle(wagglePreset()))

    expect(result.current.isLoading).toBe(true)
    expect(useComposerStore.getState().input).toBe('Keep the existing prompt ')
    expect(useComposerStore.getState().selectedWagglePreset?.id).toBe(WagglePresetId('review'))
  })
})
