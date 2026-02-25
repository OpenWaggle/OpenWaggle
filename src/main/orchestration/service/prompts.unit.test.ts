import { describe, expect, it } from 'vitest'
import { buildExecutionPrompt, buildSynthesisPrompt } from './prompts'

describe('buildExecutionPrompt', () => {
  it('includes project context and conversation summary when requested', () => {
    const prompt = buildExecutionPrompt({
      task: {
        title: 'Inspect config',
        kind: 'analysis',
        prompt: 'Read config files and report defaults',
      },
      projectContextText: '## Project Context\n\nStack: TypeScript',
      dependencyOutputs: { previous: 'done' },
      includeConversationSummary: true,
      conversationSummaryText: 'Earlier we discussed config parsing.',
    })

    expect(prompt).toContain('Task: Inspect config')
    expect(prompt).toContain('Task kind: analysis')
    expect(prompt).toContain('## Project Context')
    expect(prompt).toContain('Dependency outputs (JSON):')
    expect(prompt).toContain('{"previous":"done"}')
    expect(prompt).toContain('Conversation context (truncated):')
    expect(prompt).toContain('Earlier we discussed config parsing.')
  })

  it('omits conversation summary details when heuristic disables it', () => {
    const prompt = buildExecutionPrompt({
      task: {
        title: 'Inspect config',
        kind: 'analysis',
        prompt: 'Read config files and report defaults',
      },
      projectContextText: '',
      dependencyOutputs: {},
      includeConversationSummary: false,
      conversationSummaryText: 'This should not appear',
    })

    expect(prompt).toContain('Conversation context omitted by heuristic.')
    expect(prompt).not.toContain('This should not appear')
    expect(prompt).not.toContain('## Project Context')
  })
})

describe('buildSynthesisPrompt', () => {
  it('includes original user request and pretty-printed outputs', () => {
    const prompt = buildSynthesisPrompt({
      userPrompt: 'Summarize findings',
      projectContextText: '## Project Context\n\nRepo: openhive',
      outputs: {
        'task-1': { text: 'Checked docs' },
        'task-2': { text: 'Validated behavior' },
      },
    })

    expect(prompt).toContain('Original user request: Summarize findings')
    expect(prompt).toContain('## Project Context')
    expect(prompt).toContain('Task outputs (JSON):')
    expect(prompt).toContain('"task-1"')
    expect(prompt).toContain('"task-2"')
  })

  it('omits project context block when empty', () => {
    const prompt = buildSynthesisPrompt({
      userPrompt: 'Summarize findings',
      projectContextText: '',
      outputs: {},
    })

    expect(prompt).toContain('Original user request: Summarize findings')
    expect(prompt).toContain('Task outputs (JSON):')
    expect(prompt).not.toContain('## Project Context')
  })
})
