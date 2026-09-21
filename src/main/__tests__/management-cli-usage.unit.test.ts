import { describe, expect, it } from 'vitest'
import { accessCliUsage } from '../access-cli'
import { AGENTS_CLI_USAGE } from '../agents-cli-usage'
import { delegationsCliUsage } from '../delegations-cli'

describe('management CLI help', () => {
  it('documents Agent mutation guards and command-specific concurrency options', () => {
    expect(AGENTS_CLI_USAGE).toContain('agents update <file>')
    expect(AGENTS_CLI_USAGE).toContain('[--expected-digest <sha256>]')
    expect(AGENTS_CLI_USAGE).toContain('fail before files are read or changed')
  })

  it('documents Access and Delegation client and validation contracts', () => {
    expect(accessCliUsage()).toContain('--authorization ask-for-approval|yolo')
    expect(accessCliUsage()).toContain('fail before credentials or profiles change')
    expect(delegationsCliUsage()).toContain('--idempotency-key <key>')
    expect(delegationsCliUsage()).toContain('Mutation replay: --idempotency-key <key>')
    expect(delegationsCliUsage()).toContain('[--revised-objective <text>]')
    expect(delegationsCliUsage()).toContain('[--resource <reference>]...')
    expect(delegationsCliUsage()).toContain('--profile-credential-file <path>')
    expect(delegationsCliUsage()).toContain('fail before a query or mutation is sent')
  })
})
