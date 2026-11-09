import { execFileSync } from 'node:child_process'
import type { AgentLoopInteraction } from '@shared/types/agent-loop-interaction'
import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it } from 'vitest'
import { respondCommandHint } from '../run-cli-interactions'
import { sanitizeTerminalText } from '../terminal-text'

function selectWithChoice(choice: string) {
  return fromPartial<AgentLoopInteraction>({
    kind: 'select',
    title: 'Pick one',
    choices: [choice],
    sessionId: 'session-1',
    runId: 'run-1',
    interactionId: 'interaction-1',
  })
}

function confirmation(purpose: 'authorization' | 'user-input') {
  return fromPartial<AgentLoopInteraction>({
    kind: 'confirm',
    title: 'Allow?',
    message: 'Run a command',
    purpose,
    sessionId: 'session-1',
    runId: 'run-1',
    interactionId: 'interaction-1',
  })
}

/** The single argument a POSIX shell hands the CLI for what follows `--choice `. */
function shellArgument(quoted: string) {
  return execFileSync('sh', ['-c', `printf %s ${quoted}`], { encoding: 'utf8' })
}

describe('respondCommandHint', () => {
  it('quotes an agent-chosen choice so pasting the command cannot run anything else', () => {
    const choice = "x'; touch /tmp/owned; echo '"
    const hint = respondCommandHint(selectWithChoice(choice), 'darwin')
    expect(hint).toContain(
      'openwaggle hive request-respond session-1 run-1 interaction-1 --choice ',
    )
    expect(shellArgument(hint?.split('--choice ')[1] ?? '')).toBe(choice)
  })

  it('attaches a choice that starts with -- so it is not read as an option', () => {
    const hint = respondCommandHint(selectWithChoice('--force'), 'darwin') ?? ''
    expect(hint).toContain("--choice='--force'")
  })

  it('shows the choice on its own line on Windows', () => {
    const hint = respondCommandHint(selectWithChoice('a & b'), 'win32')

    expect(hint).toContain('--choice CHOICE')
    expect(hint).toContain('where CHOICE is a & b')
  })

  it('does not print a choice that holds control characters', () => {
    const hint = respondCommandHint(selectWithChoice('a\u0085b\u007f\u202e'), 'darwin') ?? ''

    expect(sanitizeTerminalText(hint)).toBe(hint)
    expect(hint).toContain('--choice CHOICE\n  where CHOICE is one of the choices listed above')
  })

  it('answers an approval with approval-respond and any other confirm with --confirm', () => {
    expect(respondCommandHint(confirmation('authorization'))).toBe(
      'openwaggle hive approval-respond session-1 run-1 interaction-1 allow',
    )
    expect(respondCommandHint(confirmation('user-input'))).toBe(
      'openwaggle hive request-respond session-1 run-1 interaction-1 --confirm',
    )
  })
})
