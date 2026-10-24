import { describe, expect, it } from 'vitest'
import { parseMcpCliArguments } from '../mcp-cli-arguments'
import { validateSessionsCliOptions } from '../sessions-cli-option-contract'

function command(values: readonly string[]) {
  const parsed = parseMcpCliArguments(values)
  return {
    name: parsed.positionals[0] ?? '',
    arguments: { ...parsed, positionals: parsed.positionals.slice(1) },
  }
}

function validate(values: readonly string[]) {
  const parsed = command(values)
  return () => validateSessionsCliOptions(parsed.name, parsed.arguments)
}

describe('Hive CLI option contract', () => {
  it('rejects unknown options before a misspelling can change Worker placement', () => {
    expect(
      validate([
        'spawn',
        'parent',
        '--text',
        'work',
        '--expected-run',
        'run',
        '--workspce',
        'new-worktree',
      ]),
    ).toThrow('Unknown option for OpenWaggle Hive: --workspce')
  })

  it('validates options on help instead of treating misspellings as help requests', () => {
    expect(validate(['help', '--jsoon'])).toThrow('Unknown option for OpenWaggle Hive: --jsoon')
  })

  it.each([
    [['list', '--attach', 'notes.md'], 'hive list: --attach'],
    [['queue-list', 'session', '--idempotency-key', 'once'], 'hive queue-list'],
    [
      ['delegation-submit', 'worker', 'job', 'done', '--proposal', 'proposal-1'],
      'hive delegation-submit',
    ],
    [['exports-list', 'session', '--overwrite'], 'hive exports-list'],
    // An approval is `approval-respond`, never a flag on `request-respond`.
    [
      ['request-respond', 's', 'r', 'i', '--response-json', '{}', '--approve'],
      'Unknown option for OpenWaggle Hive: --approve',
    ],
    [['steer', 'session', '--text', 'turn', '--expected-run', 'run', '--yolo'], 'hive steer'],
  ] as const)('rejects options that are inapplicable to %s', (values, message) => {
    expect(validate(values)).toThrow(message)
  })

  it('rejects missing scalar values and ambiguous catalog or credential choices', () => {
    expect(validate(['list', '--limit'])).toThrow('Missing value for --limit')
    expect(validate(['list', '--project', '/repo', '--all'])).toThrow(
      'Choose either --project or --all',
    )
    expect(
      validate([
        'list',
        '--profile',
        'helper',
        '--credential-stdin',
        '--profile-credential-file',
        '/tmp/credential',
      ]),
    ).toThrow('Choose either --credential-stdin or --profile-credential-file')
  })

  it.each([['--stdin'], ['--request-json', '-']])(
    'rejects credential input that competes with message input on stdin: %s',
    (...messageInput) => {
      expect(
        validate([
          'message',
          'session',
          '--profile',
          'helper',
          '--credential-stdin',
          ...messageInput,
        ]),
      ).toThrow('--credential-stdin cannot share stdin with --stdin or --request-json -')
    },
  )

  it('rejects values assigned to boolean flags instead of silently disabling them', () => {
    expect(validate(['list', '--json=false'])).toThrow('--json do not accept values')
    expect(validate(['launch', '.', '--text', 'work', '--yolo=false'])).toThrow(
      '--yolo do not accept values',
    )
    expect(validate(['message', 'session', '--stdin=false'])).toThrow(
      '--stdin do not accept values',
    )
  })

  it('enforces Workspace-dependent flags instead of silently dropping them', () => {
    expect(validate(['create', '.', '--workspace-id', 'workspace-1'])).toThrow(
      '--workspace-id requires --workspace existing',
    )
    expect(validate(['spawn', 'parent', '--base-ref', 'main'])).toThrow(
      '--base-ref and --start-from-origin require --workspace new-worktree',
    )
    expect(
      validate([
        'spawn',
        'parent',
        '--workspace',
        'new-worktree',
        '--base-ref',
        'main',
        '--start-from-origin',
      ]),
    ).not.toThrow()
  })

  it('keeps typed requests authoritative by rejecting ignored payload-shaping companions', () => {
    expect(
      validate([
        'message',
        'session',
        '--request-json',
        '/tmp/request.json',
        '--attach',
        'ignored.txt',
      ]),
    ).toThrow('--request-json contains the complete message request')
  })

  it('rejects destructive-command extras and passthrough before dispatch', () => {
    expect(validate(['archive', 'session', 'accidental-extra'])).toThrow(
      'received unexpected positional arguments',
    )
    expect(validate(['queue-pause', 'session', 'accidental-extra'])).toThrow(
      'received unexpected positional arguments',
    )
    expect(validate(['archive', 'session', '--', 'accidental-command'])).toThrow(
      'does not accept arguments after --',
    )
  })

  it('retains explicit rest operands for search, rename, wait, and queue ordering', () => {
    expect(validate(['search', 'queue', 'delivery', 'semantics'])).not.toThrow()
    expect(validate(['rename', 'session', 'A', 'new', 'title'])).not.toThrow()
    expect(validate(['wait', 'session-1', 'session-2', '--timeout-ms', '100'])).not.toThrow()
    expect(
      validate(['queue-reorder', 'session', 'follow-1', 'follow-2', '--queue-revision', '2']),
    ).not.toThrow()
  })

  it('accepts representative lifecycle, queue, Delegation, export, and discovery options', () => {
    expect(
      validate([
        'spawn',
        'parent',
        '--text',
        'work',
        '--expected-run',
        'run',
        '--workspace',
        'new-worktree',
        '--agent',
        'reviewer',
        '--deliverable',
        'report',
        '--accept',
        'green',
      ]),
    ).not.toThrow()
    expect(
      validate(['message', 'session', '--text', 'go', '--thinking', 'high', '--yolo']),
    ).not.toThrow()
    expect(
      validate(['queue-update-authorization', 'session', 'follow-up', '--authorization', 'yolo']),
    ).toThrow()
    expect(validate(['follow-up', 'session', '--text', 'later', '--thinking', 'high'])).toThrow(
      'thinking_level_requires_idle_session',
    )
    expect(
      validate(['replace', 'session', '--text', 'again', '--expected-run', 'run', '--yolo']),
    ).toThrow('run_authorization_override_requires_idle_session')
    expect(
      validate([
        'delegation-amend',
        'parent',
        'job',
        '1',
        'reason',
        '--specification-json',
        '{}',
        '--proposal',
        'proposal-1',
      ]),
    ).not.toThrow()
    expect(
      validate([
        'export-create',
        'session',
        'bundle',
        '--format',
        'bundle',
        '--resource',
        'report.md',
        '--overwrite',
      ]),
    ).not.toThrow()
    expect(
      validate(['search', 'migration', '--all', '--mode', 'hybrid', '--require-fresh']),
    ).not.toThrow()
  })

  it.each([
    [['delegation', 'submit', 'worker', 'job', 'done'], 'delegation-submit'],
    [
      ['delegation', 'acknowledge-conflict', 'queen', 'job', 'c', 'why'],
      'delegation-conflict-acknowledge',
    ],
    [['delegations', 'list'], 'delegations-list'],
    [['queue', 'withdraw', 'session', 'follow-1'], 'queue-withdraw'],
    [['requests', 'respond', 'session', 'run', 'interaction'], 'request-respond'],
    [['authorization', 'clear', 'session'], 'authorization-set <session-id> inherit'],
    [['authorization', 'set', 'session', 'yolo'], 'authorization-set'],
    [['requests', 'respond', 'session', 'run', 'interaction', '--approve'], 'approval-respond'],
    [['export', 'create', 'session', 'out.jsonl'], 'export-create'],
    [['export', 'watch', 'session'], 'exports-watch'],
  ] as const)(
    'refuses the former grouped spelling %j and names its replacement',
    (values, name) => {
      expect(validate(values)).toThrow(`Use 'openwaggle hive ${name}'.`)
    },
  )

  it('accepts every Hive tool action as the subcommand of the same name', () => {
    expect(validate(['delegations-list', '--all', '--state', 'working'])).not.toThrow()
    expect(validate(['delegations-read', 'delegation-1', '--limit', '5'])).not.toThrow()
    expect(validate(['delegations-conflicts', '--kind', 'merge-overlap'])).not.toThrow()
    expect(validate(['delegation-conflict-acknowledge', 'q', 'd', 'c', 'reason'])).not.toThrow()
    expect(validate(['approval-respond', 's', 'r', 'i', '--response-json', '{}'])).not.toThrow()
    expect(validate(['authorization-set', 'session', 'inherit'])).not.toThrow()
    expect(validate(['exports-watch', 'session', 'operation'])).not.toThrow()
    expect(validate(['agent-definitions-search', 'code', 'review', '--json'])).not.toThrow()
    expect(validate(['agent-definitions-list', '--profile', 'helper'])).toThrow(
      'Unsupported option for hive agent-definitions-list: --profile',
    )
  })
})
