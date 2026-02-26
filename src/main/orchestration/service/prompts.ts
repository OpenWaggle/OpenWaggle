import type { OrchestrationTaskOutputValue } from '../engine'

interface ExecutionPromptTask {
  readonly title: string
  readonly kind: string
  readonly prompt: string
}

interface BuildExecutionPromptInput {
  readonly task: ExecutionPromptTask
  readonly projectContextText: string
  readonly dependencyOutputs: Readonly<{ [taskId: string]: OrchestrationTaskOutputValue }>
  readonly includeConversationSummary: boolean
  readonly conversationSummaryText: string
}

interface BuildSynthesisPromptInput {
  readonly userPrompt: string
  readonly projectContextText: string
  readonly outputs: Readonly<{ [taskId: string]: OrchestrationTaskOutputValue }>
}

export function buildExecutionPrompt(input: BuildExecutionPromptInput): string {
  const lines = [
    `Task: ${input.task.title}`,
    `Task kind: ${input.task.kind}`,
    `Instruction: ${input.task.prompt}`,
    '',
    ...(input.projectContextText ? [input.projectContextText, ''] : []),
    'Dependency outputs (JSON):',
    JSON.stringify(input.dependencyOutputs),
    '',
    input.includeConversationSummary
      ? `Conversation context (truncated):\n${input.conversationSummaryText}`
      : 'Conversation context omitted by heuristic.',
    '',
    'Available tools: readFile, glob, webFetch.',
    'Use readFile/glob to inspect real project files before claiming details.',
    'Use webFetch for documentation, APIs, and web-derived evidence.',
    'If a fetch fails, adapt and retry with alternative URLs/sources before giving up.',
    'Do not hallucinate file contents — read evidence first.',
    '',
    'Return concise, high-signal plain text.',
  ]

  return lines.join('\n')
}

export function buildSynthesisPrompt(input: BuildSynthesisPromptInput): string {
  const lines = [
    'Synthesize a final answer from orchestration outputs.',
    'Be actionable and concise.',
    '',
    `Original user request: ${input.userPrompt}`,
    '',
    ...(input.projectContextText ? [input.projectContextText, ''] : []),
    'Task outputs (JSON):',
    JSON.stringify(input.outputs, null, 2),
  ]

  return lines.join('\n')
}
