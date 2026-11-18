import { describe, expect, it } from 'vitest'
import { accessCliUsage } from '../access-cli'
import { AGENTS_CLI_USAGE } from '../agents-cli-usage'
import { sessionsCliUsage } from '../sessions-cli-usage'

describe('management CLI help', () => {
  it('documents Agent mutation guards and command-specific concurrency options', () => {
    expect(AGENTS_CLI_USAGE).toContain('agents update <file>')
    expect(AGENTS_CLI_USAGE).toContain('[--expected-digest <sha256>]')
    expect(AGENTS_CLI_USAGE).toContain('fail before files are read or changed')
  })

  it('points Agent-definition discovery at the Hive CLI and no longer lists it (ADR 0053)', () => {
    expect(AGENTS_CLI_USAGE).not.toMatch(/openwaggle agents (list|search)/)
    expect(AGENTS_CLI_USAGE).toContain('openwaggle hive agent-definitions-list')
    expect(AGENTS_CLI_USAGE).toContain('openwaggle hive agent-definitions-search')
  })

  it('documents Access and Delegation client and validation contracts', () => {
    expect(accessCliUsage()).toContain('--authorization ask-for-approval|yolo')
    expect(accessCliUsage()).toContain('fail before credentials or profiles change')
    expect(sessionsCliUsage()).toContain('Mutation replay: --idempotency-key <key>')
    expect(sessionsCliUsage()).toContain('openwaggle hive delegation-request-revision')
    expect(sessionsCliUsage()).toContain('--revised-objective <text>')
    expect(sessionsCliUsage()).toContain('--resource <reference>...')
    expect(sessionsCliUsage()).toContain('--profile-credential-file <path>')
    expect(sessionsCliUsage()).toContain(
      'fail before files, credentials, or Session Host state change',
    )
  })
})
