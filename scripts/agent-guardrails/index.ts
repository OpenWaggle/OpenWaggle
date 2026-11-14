/**
 * What an agent may not do on its own, checked before every tool call by the project Pi
 * extension `.pi/extensions/git-guardrails.ts`: skip or turn off the git hooks, or force push.
 * Both are blocked without a prompt. Everything else, `gh pr create` and `gh pr ready` included,
 * is allowed.
 *
 * A guard against agent mistakes, not a security boundary: the real controls are the hooks
 * themselves, CI, and branch protection on `main`.
 */
import { gitRuleHits } from './git-rules'
import { type GuardrailHit, type GuardrailRule, guidanceFor } from './hits'
import { fileToolHits, hookFileHits } from './hook-files'
import { type ShellCommand, shellCommands } from './shell'

export type { GuardrailRule } from './hits'

export type GuardrailDecision =
  | { readonly kind: 'allow' }
  | { readonly kind: 'block'; readonly rule: GuardrailRule; readonly reason: string }

export interface TextEdit {
  readonly oldText: string
  readonly newText: string
}

const ALLOW: GuardrailDecision = { kind: 'allow' }

/** Every guarded action in a shell command line. */
export function bashCommandHits(command: string) {
  return shellCommands(command).flatMap(commandHits)
}

function commandHits(command: ShellCommand) {
  if (command.unreadable !== undefined) {
    return [
      {
        rule: 'unreadable-script',
        title: `Running ${command.unreadable}, which the guardrail cannot read.`,
      },
    ] satisfies GuardrailHit[]
  }
  return [...gitRuleHits(command), ...hookFileHits(command)] satisfies GuardrailHit[]
}

/** Block a shell command that skips the git hooks or force pushes; allow anything else. */
export function bashCommandDecision(command: string) {
  const [hit] = bashCommandHits(command)
  return (hit === undefined ? ALLOW : blocked(hit)) satisfies GuardrailDecision
}

/**
 * Block a `write` or `edit` tool call that turns the git hooks off. `currentText` is the file's
 * text before the call (undefined when it does not exist), used to apply an edit's replacements.
 */
export function fileToolDecision(input: {
  readonly path: string
  readonly content?: string
  readonly edits?: readonly TextEdit[]
  readonly currentText: string | undefined
}) {
  const resulting = input.content ?? applyEdits(input.currentText, input.edits ?? [])
  const [hit] = fileToolHits(input.path, resulting)
  return (hit === undefined ? ALLOW : blocked(hit)) satisfies GuardrailDecision
}

/** The text after the edit tool's exact, first-match replacements, or undefined if one misses. */
function applyEdits(text: string | undefined, edits: readonly TextEdit[]) {
  if (text === undefined) {
    return undefined
  }
  let result = text
  for (const edit of edits) {
    const at = text.indexOf(edit.oldText)
    if (at === -1) {
      return undefined
    }
    result = result.replace(edit.oldText, () => edit.newText)
  }
  return result
}

function blocked(hit: GuardrailHit) {
  return {
    kind: 'block',
    rule: hit.rule,
    reason: `Blocked: ${hit.title} ${guidanceFor(hit.rule)}`,
  } satisfies GuardrailDecision
}
