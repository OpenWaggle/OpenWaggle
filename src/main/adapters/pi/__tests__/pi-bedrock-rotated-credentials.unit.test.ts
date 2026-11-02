import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stream as streamBedrock } from '@earendil-works/pi-ai/api/bedrock-converse-stream'
import { clearBedrockClients } from '@earendil-works/pi-ai/bedrock-provider'
import { AMAZON_BEDROCK_MODELS } from '@earendil-works/pi-ai/providers/amazon-bedrock.models'
import { normalizeContext } from '@earendil-works/pi-ai/utils/transcript'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { withExpiredCredentialRetry } from '../pi-bedrock-credential-retry'
import {
  signingAccessKeyId,
  userContext,
  withBedrockServer,
} from './bedrock-loopback-server.test-utils'

/**
 * Static AWS keys in the shared credentials file, rotated while OpenWaggle runs (saml2aws, a
 * a script). The AWS SDK caches that file for the life of the process, so a new client after
 * the old keys stopped working still signed with them until OpenWaggle restarted (Pi #11221).
 */

const MODEL = AMAZON_BEDROCK_MODELS['eu.anthropic.claude-haiku-4-5-20251001-v1:0']
const PROFILE = 'openwaggle-rotation-test'

/** Every other way the SDK could find credentials, so only the shared files are used. */
const UNSET_AWS_ENV = [
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AWS_BEARER_TOKEN_BEDROCK',
  'AWS_BEDROCK_SKIP_AUTH',
  'AWS_WEB_IDENTITY_TOKEN_FILE',
  'AWS_ROLE_ARN',
  'AWS_CONTAINER_CREDENTIALS_RELATIVE_URI',
  'AWS_CONTAINER_CREDENTIALS_FULL_URI',
] as const

let directory: string

function writeCredentials(accessKeyId: string) {
  writeFileSync(
    join(directory, 'credentials'),
    `[${PROFILE}]\naws_access_key_id = ${accessKeyId}\naws_secret_access_key = secret-${accessKeyId}\n`,
  )
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'ow-bedrock-rotation-'))
  writeFileSync(join(directory, 'config'), '')
  for (const name of UNSET_AWS_ENV) vi.stubEnv(name, undefined)
  vi.stubEnv('AWS_SHARED_CREDENTIALS_FILE', join(directory, 'credentials'))
  vi.stubEnv('AWS_CONFIG_FILE', join(directory, 'config'))
  vi.stubEnv('AWS_EC2_METADATA_DISABLED', 'true')
})

afterEach(() => {
  clearBedrockClients()
  vi.unstubAllEnvs()
  rmSync(directory, { recursive: true, force: true })
})

const ENV = {
  AWS_PROFILE: PROFILE,
  AWS_BEDROCK_FORCE_HTTP1: '1',
  no_proxy: '127.0.0.1',
  NO_PROXY: '127.0.0.1',
}

function retryingCall(baseUrl: string) {
  const retrying = withExpiredCredentialRetry(streamBedrock, {
    delayMs: 0,
    invalidateClients: clearBedrockClients,
  })
  return () =>
    retrying({ ...MODEL, baseUrl }, normalizeContext(userContext()), {
      region: 'eu-west-1',
      maxRetries: 0,
      env: ENV,
    }).result()
}

describe('Amazon Bedrock keys rotated in the shared credentials file', () => {
  it('signs the retry after an expired-token failure with the rotated keys', async () => {
    writeCredentials('AKIAOLDKEY')
    const expired = new Set<string>()
    const { first, second, signedWith } = await withBedrockServer(
      async (baseUrl, requests) => {
        const call = retryingCall(baseUrl)
        const first = await call()
        // The login tool writes new temporary keys, and AWS stops accepting the old ones.
        writeCredentials('AKIANEWKEY')
        expired.add('AKIAOLDKEY')
        const second = await call()
        return {
          first,
          second,
          signedWith: requests.map((request) => signingAccessKeyId(request.headers)),
        }
      },
      { isExpiredAccessKey: (accessKeyId) => expired.has(accessKeyId) },
    )

    expect(first.stopReason).toBe('stop')
    expect(second.stopReason).toBe('stop')
    // The cached client still holds the old keys and fails once; the retry's new client reads
    // the file again.
    expect(signedWith).toEqual(['AKIAOLDKEY', 'AKIAOLDKEY', 'AKIANEWKEY'])
  })

  it('signs the next request after AWS refused a replaced IAM key with the new keys', async () => {
    writeCredentials('AKIAOLDKEY')
    const revoked = new Set<string>()
    const { first, second, third, signedWith } = await withBedrockServer(
      async (baseUrl, requests) => {
        const call = retryingCall(baseUrl)
        const first = await call()
        // A rotation script writes a new access key and deletes the old one.
        writeCredentials('AKIANEWKEY')
        revoked.add('AKIAOLDKEY')
        const second = await call()
        const third = await call()
        return {
          first,
          second,
          third,
          signedWith: requests.map((request) => signingAccessKeyId(request.headers)),
        }
      },
      { isRevokedAccessKey: (accessKeyId) => revoked.has(accessKeyId) },
    )

    expect(first.stopReason).toBe('stop')
    // A refused key is not retried: that request fails, and the next one reads the file again.
    expect(second.errorMessage).toContain('UnrecognizedClientException')
    expect(third.stopReason).toBe('stop')
    expect(signedWith).toEqual(['AKIAOLDKEY', 'AKIAOLDKEY', 'AKIANEWKEY'])
  })

  it('uses the credential chain copy the Bedrock client resolves', () => {
    // packageExtensions gives pi-ai the same range as @aws-sdk/client-bedrock-runtime, so one
    // copy of the chain is installed and bundled.
    const piAi = fileURLToPath(import.meta.resolve('@earendil-works/pi-ai'))
    const fromPiAi = createRequire(piAi).resolve('@aws-sdk/credential-provider-node')
    const client = createRequire(piAi).resolve('@aws-sdk/client-bedrock-runtime')
    const fromClient = createRequire(client).resolve('@aws-sdk/credential-provider-node')

    expect(realpathSync(fromPiAi)).toBe(realpathSync(fromClient))
  })
})
