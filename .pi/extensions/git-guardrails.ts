/**
 * Project Pi extension: checks every `bash` call, and every `write` or `edit` call, against
 * `scripts/agent-guardrails` before it runs. Skipping or turning off the git hooks and force
 * pushes are blocked with no prompt, with or without a UI; the block reason tells the agent what
 * to do instead.
 *
 * Pi loads `.pi/extensions/*.ts` for a trusted project; OpenWaggle Sessions load it with the
 * project's other resources. See `.agents/verification.md` (Git hooks and agent guardrails).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type {
  ExtensionAPI,
  ToolCallEvent,
  ToolCallEventResult,
} from '@earendil-works/pi-coding-agent'
import {
  type TextEdit,
  bashCommandDecision,
  fileToolDecision,
} from '../../scripts/agent-guardrails'

function readText(cwd: string, file: string) {
  try {
    return readFileSync(resolve(cwd, file), 'utf8')
  } catch {
    return undefined
  }
}

/**
 * The arguments of `bash`, `write` and `edit` the guardrails read, each still unchecked: a model
 * wrote them, so each field is narrowed where it is read.
 */
interface GuardedToolInput {
  readonly command?: unknown
  readonly path?: unknown
  readonly content?: unknown
  readonly edits?: unknown
  readonly oldText?: unknown
  readonly newText?: unknown
}

function textEdits(input: GuardedToolInput) {
  const { edits, oldText, newText } = input
  if (Array.isArray(edits)) {
    const result: TextEdit[] = edits.flatMap((edit: unknown) =>
      typeof edit === 'object' &&
      edit !== null &&
      'oldText' in edit &&
      'newText' in edit &&
      typeof edit.oldText === 'string' &&
      typeof edit.newText === 'string'
        ? [{ oldText: edit.oldText, newText: edit.newText }]
        : [],
    )
    return result
  }
  const result: TextEdit[] =
    typeof oldText === 'string' && typeof newText === 'string' ? [{ oldText, newText }] : []
  return result
}

/** The guardrail verdict for one tool call, as a Pi `tool_call` result. */
export function guardToolCall(event: ToolCallEvent, cwd: string) {
  const input: GuardedToolInput = { ...event.input }
  const { command, path, content } = input
  if (event.toolName === 'bash' && typeof command === 'string') {
    const decision = bashCommandDecision(command)
    const result: ToolCallEventResult | undefined =
      decision.kind === 'block' ? { block: true, reason: decision.reason } : undefined
    return result
  }
  if ((event.toolName === 'write' || event.toolName === 'edit') && typeof path === 'string') {
    const decision = fileToolDecision({
      path,
      ...(event.toolName === 'write' && typeof content === 'string' ? { content } : {}),
      edits: event.toolName === 'edit' ? textEdits(input) : [],
      currentText: event.toolName === 'edit' ? readText(cwd, path) : undefined,
    })
    const result: ToolCallEventResult | undefined =
      decision.kind === 'block' ? { block: true, reason: decision.reason } : undefined
    return result
  }
  return undefined
}

export default function gitGuardrails(pi: ExtensionAPI) {
  pi.on('tool_call', (event, ctx) => guardToolCall(event, ctx.cwd))
}
