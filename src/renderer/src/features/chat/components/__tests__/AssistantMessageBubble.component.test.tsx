import { SessionId, SupportedModelId } from '@shared/types/brand'
import type {
  ChatTextPart,
  ChatThinkingPart,
  ChatToolCallPart,
  ChatToolResultPart,
  UIMessage,
  UIMessagePart,
} from '@shared/types/chat-ui'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

// The syntax service highlights in Web Workers, which jsdom lacks; it answers plain text here.
vi.mock('@/shared/lib/syntax/syntax-service', () => ({
  syntaxService: {
    highlight: async (input: { source: string; language: string; theme: string }) => ({
      status: 'plain-text' as const,
      language: input.language,
      theme: input.theme,
      lines: input.source.split('\n').map((line) => [{ content: line }]),
      elapsedMs: 0,
    }),
  },
}))

import { AssistantMessageBubble, type WaggleInfo } from '../AssistantMessageBubble'

/*
 * The label, Markdown text, tool-call cards and structured payloads are the real components, so
 * each case asserts what the transcript shows for an assistant message.
 */

function textPart(content: string) {
  return { type: 'text', content } satisfies ChatTextPart
}

function toolCallPart(path: string, id = 'tc-1') {
  return {
    type: 'tool-call',
    id,
    name: 'read',
    arguments: JSON.stringify({ path }),
    state: 'output-available',
  } satisfies ChatToolCallPart
}

function toolResultPart(toolCallId: string, content: unknown = 'ok') {
  return {
    type: 'tool-result',
    toolCallId,
    content,
    state: 'output-available',
  } satisfies ChatToolResultPart
}

function thinkingPart(content = 'internal reasoning') {
  return { type: 'thinking', content } satisfies ChatThinkingPart
}

function createMessage(parts: UIMessagePart[]) {
  return { id: 'm1', role: 'assistant', parts } satisfies UIMessage
}

const ARCHITECT: WaggleInfo = { agentLabel: 'Architect', agentColor: 'blue' }
const GPT_55 = SupportedModelId('openai/gpt-5.5')

interface RenderAssistantOptions {
  readonly message: UIMessage
  readonly waggle?: WaggleInfo
  readonly assistantModel?: SupportedModelId
  readonly hideAgentLabel?: boolean
  readonly turnFolded?: boolean
  readonly run?: { readonly isStreaming?: boolean; readonly isRunActive?: boolean }
  readonly onViewTurnDiff?: (messageId: string) => void
}

function renderAssistantMessage({
  message,
  waggle,
  assistantModel,
  hideAgentLabel,
  turnFolded,
  run,
  onViewTurnDiff,
}: RenderAssistantOptions) {
  return render(
    <AssistantMessageBubble
      message={message}
      runtime={{
        sessionId: SessionId('session-1'),
        extensions: { registry: null, projectPaths: [] },
      }}
      run={{ ...run, ...(assistantModel ? { assistantModel } : {}) }}
      {...(waggle === undefined ? {} : { waggle })}
      presentation={{
        ...(hideAgentLabel === undefined ? {} : { hideAgentLabel }),
        ...(turnFolded === undefined ? {} : { turnFolded }),
      }}
      {...(onViewTurnDiff ? { actions: { onViewTurnDiff } } : {})}
    />,
  )
}

const readCard = (path: string) =>
  screen.queryByRole('button', { name: new RegExp(`Read ${path}`) })

describe('AssistantMessageBubble', () => {
  it.each([
    { label: 'a Waggle agent', options: { waggle: ARCHITECT }, shown: 'Architect' },
    { label: 'the assistant model', options: { assistantModel: GPT_55 }, shown: 'GPT 5.5' },
  ])('labels the message with $label', ({ options, shown }) => {
    const { container } = renderAssistantMessage({
      message: createMessage([textPart('Hello')]),
      ...options,
    })

    expect(screen.getByText(shown, { exact: false })).toBeInTheDocument()
    // The continuous Waggle rail belongs to the turn wrapper, not to each message.
    expect(container.querySelector('.border-l-2')).toBeNull()
  })

  it.each([
    { actions: 'its actions', onViewTurnDiff: vi.fn(), diffButtons: 1 },
    { actions: 'no actions', onViewTurnDiff: undefined, diffButtons: 0 },
  ])(
    'hides a repeated agent label inside a grouped Waggle turn, with $actions',
    ({ onViewTurnDiff, diffButtons }) => {
      renderAssistantMessage({
        message: createMessage([textPart('Hello')]),
        waggle: ARCHITECT,
        assistantModel: GPT_55,
        hideAgentLabel: true,
        ...(onViewTurnDiff ? { onViewTurnDiff } : {}),
      })

      expect(screen.queryByText('Architect')).toBeNull()
      expect(screen.queryByText(/GPT 5\.5/)).toBeNull()
      expect(screen.getByText('Hello')).toBeInTheDocument()
      expect(screen.queryAllByRole('button', { name: 'View turn diff' })).toHaveLength(diffButtons)
    },
  )

  it('renders text and thinking as Markdown and skips whitespace-only parts', () => {
    const { container } = renderAssistantMessage({
      message: createMessage([
        textPart('   '),
        textPart('Hello **world**'),
        thinkingPart('  '),
        thinkingPart(),
      ]),
    })

    expect(screen.getByText('world').tagName).toBe('STRONG')
    expect(screen.getByText('internal reasoning')).toBeInTheDocument()
    expect(container.querySelectorAll('.prose')).toHaveLength(2)
  })

  it('nests a matched tool result in its tool-call card and shows an unmatched one on its own', () => {
    renderAssistantMessage({
      message: createMessage([
        toolCallPart('a.ts', 'tc-1'),
        toolResultPart('tc-1', 'matched output'),
        toolResultPart('tc-2', 'orphan output'),
      ]),
    })

    expect(readCard('a.ts')).toBeInTheDocument()
    expect(screen.getAllByText('Tool result · output-available')).toHaveLength(1)
    expect(screen.getByText('orphan output')).toBeInTheDocument()
    expect(screen.queryByText('matched output')).toBeNull()
  })

  it('shows a structured standalone tool result as a structured payload', () => {
    renderAssistantMessage({ message: createMessage([toolResultPart('tc-1', { answer: 42 })]) })

    expect(screen.getByRole('region', { name: 'Structured data' })).toHaveTextContent(
      '"answer": 42',
    )
  })

  it.each([
    {
      label: 'every part when the turn is not folded',
      turnFolded: false,
      run: {},
      texts: ['Earlier text', 'Final answer'],
      card: true,
    },
    {
      label: 'only the final text when the turn is folded (ADR 0034)',
      turnFolded: true,
      run: {},
      texts: ['Final answer'],
      card: false,
    },
    {
      label: 'every part of a folded turn while it streams',
      turnFolded: true,
      run: { isStreaming: true },
      texts: ['Earlier text', 'Final answer'],
      card: true,
    },
    {
      label: 'every part of a folded turn while its Run is active',
      turnFolded: true,
      run: { isRunActive: true },
      texts: ['Earlier text', 'Final answer'],
      card: true,
    },
  ])('renders $label', ({ turnFolded, run, texts, card }) => {
    renderAssistantMessage({
      message: createMessage([
        textPart('Earlier text'),
        toolCallPart('a.ts', 'tc-1'),
        toolResultPart('tc-1'),
        textPart('Final answer'),
      ]),
      turnFolded,
      run,
    })

    for (const text of ['Earlier text', 'Final answer']) {
      expect(screen.queryByText(text) !== null).toBe(texts.includes(text))
    }
    expect(readCard('a.ts') !== null).toBe(card)
  })

  it('opens the turn diff for this message from View turn diff', async () => {
    const onViewTurnDiff = vi.fn()
    renderAssistantMessage({
      message: createMessage([textPart('Hello')]),
      assistantModel: GPT_55,
      onViewTurnDiff,
    })

    await userEvent.click(screen.getByRole('button', { name: 'View turn diff' }))

    expect(onViewTurnDiff).toHaveBeenCalledWith('m1')
  })

  it.each([
    { label: 'no reveal handler is given', turnFolded: false, handler: undefined },
    // A folded turn's changed-files card opens the diff instead.
    { label: 'the turn is folded', turnFolded: true, handler: vi.fn() },
  ])('omits View turn diff when $label', ({ turnFolded, handler }) => {
    renderAssistantMessage({
      message: createMessage([toolCallPart('a.ts'), textPart('Answer')]),
      assistantModel: GPT_55,
      turnFolded,
      ...(handler ? { onViewTurnDiff: handler } : {}),
    })

    expect(screen.queryByRole('button', { name: 'View turn diff' })).toBeNull()
  })
})
