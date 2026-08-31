import { afterEach, describe, expect, it, vi } from 'vitest'
import { runAccessCli } from '../access-cli'
import { runDelegationsCli } from '../delegations-cli'

describe('management CLI validation boundaries', () => {
  afterEach(() => vi.restoreAllMocks())

  it('rejects Access option typos before credentials or profiles are touched', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    await expect(
      runAccessCli([
        'profiles',
        'create',
        'reviewer',
        '--capabilty',
        'sessions:read',
        '--all',
        '--credential-store',
      ]),
    ).resolves.toBe(2)

    expect(stderr).toHaveBeenCalledWith(
      'error: Unknown option for OpenWaggle Access profiles: --capabilty.\n',
    )
  })

  it('rejects option-only Access and Delegation invocations', async () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    await expect(runAccessCli(['profiles', '--capabilty', 'sessions:read'])).resolves.toBe(2)
    await expect(runDelegationsCli(['--evidencejson', '{}'])).resolves.toBe(2)

    expect(stdout).not.toHaveBeenCalled()
    expect(stderr).toHaveBeenCalledWith(
      expect.stringContaining('Unsupported option-only invocation for OpenWaggle Access profiles'),
    )
    expect(stderr).toHaveBeenCalledWith(
      expect.stringContaining('Unsupported option-only invocation for OpenWaggle Delegations'),
    )
  })

  it('rejects Delegation option typos before a Host mutation is sent', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    await expect(
      runDelegationsCli([
        'submit',
        'worker',
        'delegation-1',
        'Done',
        '--evidencejson',
        '{"kind":"asserted-note","summary":"verified"}',
      ]),
    ).resolves.toBe(2)

    expect(stderr).toHaveBeenCalledWith(
      'error: Unknown option for OpenWaggle Delegations: --evidencejson.\n',
    )
  })
})
