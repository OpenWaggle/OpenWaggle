import { isMatching, P } from '@diegogbrisa/ts-match'

const MAX_LABEL_LENGTH = 64
const DEFAULT_OLDEST_DESCRIBED_COMMANDS = 8
const DEFAULT_NEWEST_DESCRIBED_COMMANDS = 4
const LABEL_PATTERN = /^[A-Za-z0-9._:-]+$/u

function labelPart(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_LABEL_LENGTH) return
  return LABEL_PATTERN.test(value) ? value : undefined
}

function field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined
}

/**
 * A command's contract and operation names only; never its arguments. Contracts place the
 * operation at `request.operation`, `request.command.operation` (local-ui-v1, session-control-v2,
 * session-lifecycle-v2), `request.query.operation` (session-query-v2) or `request.channel`
 * (host-ui-v1).
 */
export function describeLocalSessionCommand(payload: unknown): string {
  const contract = labelPart(field(payload, 'contract'))
  const request = field(payload, 'request')
  const operation =
    labelPart(field(payload, 'operation')) ??
    labelPart(field(request, 'operation')) ??
    labelPart(field(field(request, 'command'), 'operation')) ??
    labelPart(field(field(request, 'query'), 'operation')) ??
    labelPart(field(request, 'channel'))
  return [contract, operation].filter((part) => part !== undefined).join(':') || 'unknown'
}

/**
 * Commands that stay pending on purpose until something happens or their timeout ends: the
 * desktop's 5 s long-poll, which is always in flight, and Session waits. They say nothing about
 * what blocked the event loop, so stall reports count them apart from the oldest commands.
 */
const isLongPollCommand = isMatching(
  P.union(
    { contract: 'desktop-service-v1', request: { operation: 'poll' } },
    {
      contract: 'session-query-v2',
      request: { query: { operation: P.union('wait', 'exports-wait') } },
    },
    {
      contract: 'session-query-v2',
      request: {
        query: {
          operation: 'search',
          waitTimeoutMs: P.when((value) => typeof value === 'number' && value > 0),
        },
      },
    },
  ),
)

export function isLongPollLocalSessionCommand(payload: unknown): boolean {
  return isLongPollCommand(payload)
}

interface InflightCommand {
  readonly command: string
  readonly startedAt: number
  readonly longPoll: boolean
}

/**
 * The Local Session commands a Host is executing, for diagnostics. When the Host's event loop
 * stalls, the commands that started before the stall and had not finished name the likely work.
 */
export class LocalSessionInflightCommands {
  private nextId = 0
  /** Insertion order is start order, which `describe` relies on. */
  private readonly commands = new Map<number, InflightCommand>()

  constructor(private readonly now: () => number = () => performance.now()) {}

  track(payload: unknown): () => void {
    const id = this.nextId
    this.nextId += 1
    this.commands.set(id, {
      command: describeLocalSessionCommand(payload),
      startedAt: this.now(),
      longPoll: isLongPollLocalSessionCommand(payload),
    })
    return () => {
      this.commands.delete(id)
    }
  }

  /**
   * The oldest commands are the likeliest cause of a long stall; the newest show what arrived
   * just before it. The two lists never repeat a command and leave out long-polls, which are
   * only counted.
   */
  describe(
    oldestLimit = DEFAULT_OLDEST_DESCRIBED_COMMANDS,
    newestLimit = DEFAULT_NEWEST_DESCRIBED_COMMANDS,
  ) {
    const at = this.now()
    const all = [...this.commands.values()]
    const entries = all.filter((entry) => !entry.longPoll)
    const longPollCount = all.length - entries.length
    const oldestCount = Math.min(oldestLimit, entries.length)
    const newestCount = Math.min(newestLimit, entries.length - oldestCount)
    const summary = (entry: InflightCommand) => ({
      command: entry.command,
      ageMs: Math.round(at - entry.startedAt),
    })
    return {
      inflightCommandCount: entries.length,
      ...(longPollCount > 0 ? { longPollCount } : {}),
      oldestInflightCommands: entries.slice(0, oldestCount).map(summary),
      ...(newestCount > 0
        ? { newestInflightCommands: entries.slice(entries.length - newestCount).map(summary) }
        : {}),
    }
  }
}
