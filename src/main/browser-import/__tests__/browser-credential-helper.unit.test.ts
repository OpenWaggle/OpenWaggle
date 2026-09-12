import { describe, expect, it } from 'vitest'
import { runCredentialHelper } from '../browser-credential-helper'
import { BrowserImportError } from '../browser-import-errors'

const TIMEOUT_TEST_MS = 25

describe('browser credential helper', () => {
  it('terminates and rejects a helper that exceeds its deadline', async () => {
    const operation = runCredentialHelper(
      process.execPath,
      ['-e', 'setInterval(() => undefined, 1_000)'],
      undefined,
      { timeoutMs: TIMEOUT_TEST_MS },
    )

    await expect(operation).rejects.toMatchObject({
      name: BrowserImportError.name,
      reason: 'keychain-unavailable',
      message: 'The OS credential helper timed out.',
    })
  })
})
