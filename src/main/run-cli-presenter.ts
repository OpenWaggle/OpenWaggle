import { matchBy } from '@diegogbrisa/ts-match'
import type { JsonValue } from '@shared/types/json'
import type { SessionHostEventPayload } from '@shared/types/session-host-event'
import type { AgentTransportEvent } from '@shared/types/stream'

const SUMMARY_MAX_LENGTH = 120
const ELLIPSIS = '…'

export interface RunCliPresenterOutput {
  readonly reply: (text: string) => void
  readonly stderr: (text: string) => void
}

function truncate(value: string) {
  const singleLine = value.replace(/\s+/g, ' ').trim()
  return singleLine.length > SUMMARY_MAX_LENGTH
    ? `${singleLine.slice(0, SUMMARY_MAX_LENGTH - ELLIPSIS.length)}${ELLIPSIS}`
    : singleLine
}

function isJsonObject(
  value: JsonValue | undefined,
): value is { readonly [key: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const SUMMARY_ARGUMENT_KEYS = [
  'command',
  'path',
  'file_path',
  'filePath',
  'pattern',
  'url',
  'query',
]

/** A one-line description of a tool call's arguments for terminal progress output. */
export function summarizeToolArguments(args: JsonValue | undefined) {
  if (args === undefined || args === null) return ''
  if (isJsonObject(args)) {
    for (const key of SUMMARY_ARGUMENT_KEYS) {
      const value = args[key]
      if (typeof value === 'string' && value.trim().length > 0) return truncate(value)
    }
  }
  return truncate(JSON.stringify(args))
}

/**
 * Renders one Run's Session Host events as a readable terminal transcript: the assistant's
 * reply goes to stdout, while progress and diagnostics go to stderr.
 */
export class RunCliPresenter {
  private stdoutLineOpen = false

  constructor(private readonly output: RunCliPresenterOutput) {}

  /** Keep stderr progress lines from splitting a partially written stdout line. */
  private note(text: string) {
    this.endReplyLine()
    this.output.stderr(`${text}\n`)
  }

  private reply(text: string) {
    if (text.length === 0) return
    this.output.reply(text)
    this.stdoutLineOpen = !text.endsWith('\n')
  }

  endReplyLine() {
    if (!this.stdoutLineOpen) return
    this.output.reply('\n')
    this.stdoutLineOpen = false
  }

  started(input: { readonly sessionId: string; readonly projectPath: string }) {
    this.note(`openwaggle: started Session ${input.sessionId} in ${input.projectPath}`)
  }

  status(text: string) {
    this.note(`openwaggle: ${text}`)
  }

  present(payload: SessionHostEventPayload) {
    if (payload.kind === 'session-transport') {
      this.presentTransport(payload.event)
      return
    }
    // Launch progress repeats its stages; only a failure is worth a line in the terminal.
    if (payload.kind === 'session-worktree-launch' && payload.event.type === 'failure') {
      this.note(`openwaggle: worktree setup failed: ${payload.event.errorMessage}`)
    }
  }

  private presentTransport(event: AgentTransportEvent) {
    matchBy(event, 'type')
      .with('message_update', (update) => {
        if (update.assistantMessageEvent.type === 'text_delta') {
          this.reply(update.assistantMessageEvent.delta)
        }
      })
      .with('message_end', (end) => {
        if (end.role === 'assistant') this.endReplyLine()
      })
      .with('tool_execution_start', (start) => {
        const summary = summarizeToolArguments(start.args)
        this.note(`• ${start.toolName}${summary ? ` ${summary}` : ''}`)
      })
      .with('tool_execution_end', (end) => {
        if (end.isError) this.note(`  ${end.toolName} failed`)
      })
      .with('auto_retry_start', (retry) =>
        this.note(
          `openwaggle: retrying (attempt ${retry.attempt}/${retry.maxAttempts}): ${truncate(retry.errorMessage)}`,
        ),
      )
      .with('compaction_start', () => this.note('openwaggle: compacting context'))
      .with('compaction_end', (end) => {
        if (end.errorMessage) this.note(`openwaggle: compaction failed: ${end.errorMessage}`)
      })
      .with('agent_end', (end) => {
        // An aborted Run is reported once, as interrupted, when it settles.
        if (end.error && !end.willRetry && end.reason !== 'aborted') {
          this.note(`openwaggle: error: ${end.error.message}`)
        }
      })
      .otherwise(() => undefined)
  }
}
