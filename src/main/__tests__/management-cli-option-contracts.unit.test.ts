import { describe, expect, it } from 'vitest'
import { validateAccessCliOptions } from '../access-cli-option-contract'
import { parseManagementEnvelope, parseProfileScope } from '../access-cli-policy'
import { validateAgentsCliOptions } from '../agents-cli-option-contract'
import { parseMcpCliArguments } from '../mcp-cli-arguments'
import { validateSessionsCliOptions } from '../sessions-cli-option-contract'

function argumentsFor(values: readonly string[]) {
  return parseMcpCliArguments(values)
}

describe('management CLI option contracts', () => {
  it('resolves Access project scopes against the caller cwd before persistence', () => {
    expect(parseProfileScope(argumentsFor(['--project', '.']), '/repo/project')).toEqual({
      projectPaths: ['/repo/project'],
    })
    expect(
      parseManagementEnvelope(
        argumentsFor([
          '--management-envelope-json',
          JSON.stringify({
            capabilities: ['sessions:discover'],
            scope: { projectPaths: ['../project'] },
            authorizationCeiling: 'ask-for-approval',
          }),
        ]),
        '/repo/worktree',
      ),
    ).toMatchObject({ scope: { projectPaths: ['/repo/project'] } })
  })

  it('scopes an Access profile to Sessions and Hives named by Session links', () => {
    expect(
      parseProfileScope(
        argumentsFor([
          '--session',
          'openwaggle://sessions/session-1',
          '--session',
          'session-1',
          '--hive',
          'openwaggle://sessions/queen-1',
        ]),
        '/repo/project',
      ),
    ).toEqual({ sessionIds: ['session-1'], hiveRootSessionIds: ['queen-1'] })
    expect(() =>
      parseProfileScope(argumentsFor(['--session', 'openwaggle://app/']), '/repo/project'),
    ).toThrow('--session is not a Session link')
  })

  it('strictly decodes management envelopes before resolving their project paths', () => {
    const envelope = (value: unknown) =>
      parseManagementEnvelope(
        argumentsFor(['--management-envelope-json', JSON.stringify(value)]),
        '/repo/worktree',
      )
    expect(() =>
      envelope({
        capabilities: ['sessions:discover', 42],
        scope: { projectPaths: ['.'] },
        authorizationCeiling: 'ask-for-approval',
      }),
    ).toThrow()
    expect(() =>
      envelope({
        capabilities: ['sessions:discover'],
        scope: { projectPaths: ['.'], unexpected: true },
        authorizationCeiling: 'ask-for-approval',
      }),
    ).toThrow()
  })

  it('rejects unknown, inapplicable, and missing-value Agent options', () => {
    expect(() => validateAgentsCliOptions('import', argumentsFor(['--dryrun']))).toThrow(
      'Unknown option for OpenWaggle Agents: --dryrun',
    )
    expect(() =>
      validateAgentsCliOptions('validate', argumentsFor(['--scope', 'project'])),
    ).toThrow('Unsupported option for OpenWaggle Agents validate: --scope')
    expect(() => validateAgentsCliOptions('import', argumentsFor(['--scope']))).toThrow(
      'Missing value for --scope',
    )
    expect(() => validateAgentsCliOptions('help', argumentsFor(['--jsoon']))).toThrow(
      'Unknown option for OpenWaggle Agents: --jsoon',
    )
  })

  it('rejects Access policy typos before profile management can run', () => {
    expect(() =>
      validateAccessCliOptions(
        'create',
        argumentsFor(['--capabilty', 'sessions:read', '--all', '--credential-store']),
      ),
    ).toThrow('Unknown option for OpenWaggle Access profiles: --capabilty')
    expect(() => validateAccessCliOptions('revoke', argumentsFor(['--all']))).toThrow(
      'Unsupported option for OpenWaggle Access profiles revoke: --all',
    )
    expect(() => validateAccessCliOptions('create', argumentsFor(['--capability']))).toThrow(
      'Missing value for --capability',
    )
  })

  it('rejects Hive Delegation evidence typos before a mutation can be sent', () => {
    expect(() =>
      validateSessionsCliOptions(
        'delegation-submit',
        argumentsFor(['--evidencejson', '{"kind":"asserted-note","summary":"done"}']),
      ),
    ).toThrow('Unknown option for OpenWaggle Hive: --evidencejson')
    expect(() =>
      validateSessionsCliOptions(
        'delegations-read',
        argumentsFor(['delegation-1', '--evidence-json', '{}']),
      ),
    ).toThrow('Unsupported option for hive delegations-read: --evidence-json')
    expect(() =>
      validateSessionsCliOptions(
        'delegation-submit',
        argumentsFor(['worker', 'delegation-1', 'done', '--evidence-json']),
      ),
    ).toThrow('Missing value for --evidence-json')
  })

  it('enforces positional and passthrough contracts while retaining documented text operands', () => {
    expect(() =>
      validateAgentsCliOptions('delete', argumentsFor(['reviewer', 'accidental-extra'])),
    ).toThrow('received unexpected positional arguments')
    expect(() =>
      validateSessionsCliOptions('agent-definitions-search', argumentsFor(['queue', 'semantics'])),
    ).not.toThrow()
    expect(() =>
      validateAccessCliOptions('revoke', argumentsFor(['reviewer', 'accidental-extra'])),
    ).toThrow('received unexpected positional arguments')
    expect(() =>
      validateSessionsCliOptions(
        'delegations-read',
        argumentsFor(['delegation-1', 'accidental-extra']),
      ),
    ).toThrow('received unexpected positional arguments')
    expect(() =>
      validateSessionsCliOptions(
        'delegation-submit',
        argumentsFor(['worker', 'delegation-1', 'all', 'done']),
      ),
    ).not.toThrow()
    expect(() =>
      validateAgentsCliOptions('explain', argumentsFor(['reviewer', '--', 'unexpected-command'])),
    ).toThrow('does not accept arguments after --')
  })

  it('refuses Agent-definition discovery under its former agents names (ADR 0053)', () => {
    expect(() => validateAgentsCliOptions('list', argumentsFor([]))).toThrow(
      "Unsupported OpenWaggle Agents command: list. Use 'openwaggle hive agent-definitions-list'.",
    )
    expect(() => validateAgentsCliOptions('search', argumentsFor(['reviewer']))).toThrow(
      "Use 'openwaggle hive agent-definitions-search'.",
    )
  })
})
