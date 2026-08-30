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

describe('Sessions CLI option contract', () => {
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
    ).toThrow('Unknown option for OpenWaggle Sessions: --workspce')
  })

  it('validates options on help instead of treating misspellings as help requests', () => {
    expect(validate(['help', '--jsoon'])).toThrow('Unknown option for OpenWaggle Sessions: --jsoon')
  })

  it.each([
    [['list', '--attach', 'notes.md'], 'sessions list: --attach'],
    [['queue', 'list', 'session', '--idempotency-key', 'once'], 'sessions queue list'],
    [
      ['delegation', 'submit', 'worker', 'job', 'done', '--proposal', 'proposal-1'],
      'delegation submit',
    ],
    [['export', 'list', 'session', '--overwrite'], 'sessions export list'],
    [['steer', 'session', '--text', 'turn', '--expected-run', 'run', '--yolo'], 'sessions steer'],
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
    expect(validate(['queue', 'pause', 'session', 'accidental-extra'])).toThrow(
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
      validate(['queue', 'reorder', 'session', 'follow-1', 'follow-2', '--queue-revision', '2']),
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
      validate([
        'queue',
        'update-authorization',
        'session',
        'follow-up',
        '--authorization',
        'yolo',
      ]),
    ).not.toThrow()
    expect(
      validate([
        'delegation',
        'amend',
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
        'export',
        'create',
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
})
