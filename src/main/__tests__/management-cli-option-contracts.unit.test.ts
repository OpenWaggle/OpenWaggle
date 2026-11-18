import { describe, expect, it } from 'vitest'
import { validateAccessCliOptions } from '../access-cli-option-contract'
import {
  parseManagementEnvelope,
  parseProfilePolicy,
  parseProfileScope,
} from '../access-cli-policy'
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
          '--manage-capability',
          'sessions:discover',
          '--manage-project',
          '../project',
          '--manage-export-root',
          'exports',
        ]),
        '/repo/worktree',
      ),
    ).toEqual({
      capabilities: ['sessions:discover'],
      scope: { projectPaths: ['/repo/project'], exportRoots: ['/repo/worktree/exports'] },
      authorizationCeiling: 'ask-for-approval',
    })
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

  it('builds a Profile-management envelope from the --manage-* options', () => {
    const envelope = (values: readonly string[]) =>
      parseManagementEnvelope(argumentsFor(values), '/repo/worktree')
    expect(envelope(['--capability', 'sessions:read'])).toBeUndefined()
    expect(
      envelope([
        '--manage-capability',
        'sessions:read',
        '--manage-capability',
        'sessions:discover',
        '--manage-hive',
        'openwaggle://sessions/queen-1',
        '--manage-attachment-root',
        '/shared',
        '--manage-authorization',
        'yolo',
      ]),
    ).toEqual({
      capabilities: ['sessions:discover', 'sessions:read'],
      scope: { hiveRootSessionIds: ['queen-1'], attachmentRoots: ['/shared'] },
      authorizationCeiling: 'yolo',
    })
    expect(envelope(['--manage-capability', 'sessions:read', '--manage-all'])).toMatchObject({
      scope: { all: true },
    })
  })

  it('checks the capabilities and targets of a Profile-management envelope', () => {
    const envelope = (values: readonly string[]) => () =>
      parseManagementEnvelope(argumentsFor(values), '/repo/worktree')
    expect(envelope(['--manage-all'])).toThrow('at least one --manage-capability')
    expect(envelope(['--manage-capability', 'sessions:raed', '--manage-all'])).toThrow(
      'Unknown --manage-capability: sessions:raed',
    )
    expect(envelope(['--manage-capability', 'sessions:read'])).toThrow(
      'needs --manage-all, or one or more of --manage-project, --manage-session and --manage-hive',
    )
    expect(
      envelope(['--manage-capability', 'sessions:read', '--manage-all', '--manage-project', '.']),
    ).toThrow('--manage-all already covers every target')
    expect(
      envelope([
        '--manage-capability',
        'sessions:read',
        '--manage-project',
        '.',
        '--manage-session',
        'session-1',
        '--manage-hive',
        'queen-1',
      ])(),
    ).toEqual({
      capabilities: ['sessions:read'],
      scope: {
        projectPaths: ['/repo/worktree'],
        sessionIds: ['session-1'],
        hiveRootSessionIds: ['queen-1'],
      },
      authorizationCeiling: 'ask-for-approval',
    })
    expect(
      envelope([
        '--manage-capability',
        'sessions:read',
        '--manage-all',
        '--manage-authorization',
        'full',
      ]),
    ).toThrow('--manage-authorization must be ask-for-approval or yolo')
  })

  it('applies the --manage-* options only to a profile that gets access:profiles', () => {
    const policy = (values: readonly string[]) => () =>
      parseProfilePolicy(argumentsFor(values), '/repo/worktree')
    const manage = ['--manage-capability', 'sessions:read', '--manage-all']
    expect(policy(['--capability', 'sessions:read', '--all', ...manage])).toThrow(
      'apply only to a profile with --capability access:profiles',
    )
    // Even an incomplete envelope is refused for that reason first.
    expect(policy(['--capability', 'sessions:read', '--all', '--manage-project', '.'])).toThrow(
      'apply only to a profile with --capability access:profiles',
    )
    expect(policy(['--capability', 'access:profiles', '--all', ...manage])()).toMatchObject({
      managementEnvelope: { capabilities: ['sessions:read'] },
    })
  })

  it('names replacements only on the CLI an old option belonged to', () => {
    expect(() =>
      validateAccessCliOptions(
        'create',
        argumentsFor(['--request-json', 'request.json', '--all', '--credential-store']),
      ),
    ).toThrow('Unknown option for OpenWaggle Access profiles: --request-json')
    expect(() =>
      validateSessionsCliOptions('list', argumentsFor(['--management-envelope-json', '{}'])),
    ).toThrow('Unknown option for OpenWaggle Hive: --management-envelope-json')
  })

  it('refuses --management-envelope-json and names the options that replaced it', () => {
    const create = () =>
      validateAccessCliOptions(
        'create',
        argumentsFor(['--management-envelope-json', '{}', '--all', '--credential-store']),
      )
    expect(create).toThrow('--management-envelope-json was replaced before 1.0.')
    expect(create).toThrow('--manage-capability <capability>...')
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
    // A typed value of true is a value, not a missing one.
    expect(() =>
      validateAccessCliOptions(
        'update',
        argumentsFor(['helper', '--capability', 'sessions:read', '--project', 'true']),
      ),
    ).not.toThrow()
    expect(() => validateAccessCliOptions('update', argumentsFor(['helper', '--project']))).toThrow(
      'Missing value for --project',
    )
  })

  it('rejects Hive Delegation evidence typos before a mutation can be sent', () => {
    expect(() =>
      validateSessionsCliOptions('delegation-submit', argumentsFor(['--evidence-nte', 'done'])),
    ).toThrow('Unknown option for OpenWaggle Hive: --evidence-nte')
    expect(() =>
      validateSessionsCliOptions(
        'delegations-read',
        argumentsFor(['delegation-1', '--evidence-note', 'done']),
      ),
    ).toThrow('Unsupported option for hive delegations-read: --evidence-note')
    expect(() =>
      validateSessionsCliOptions(
        'delegation-submit',
        argumentsFor(['worker', 'delegation-1', 'done', '--evidence-note']),
      ),
    ).toThrow('Missing value for --evidence-note')
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
