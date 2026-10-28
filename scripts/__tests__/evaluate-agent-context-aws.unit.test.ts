import { chmod, mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { type AwsCli, shortLivedAwsEnvironment } from '../evaluate-agent-context-aws'
import { copyAwsSsoConfiguration } from '../perf/lib/aws-sso-home'

/**
 * R6 P2-3: an eval Run has YOLO authority over its home, so it gets short-lived AWS credentials in
 * its environment instead of the user's `~/.aws`; the in-process Bedrock test gets read-only
 * copies of the SSO configuration, never a link and never long-lived keys.
 */
const ROLE_CREDENTIALS = JSON.stringify({
  Version: 1,
  AccessKeyId: 'ASIAROLE',
  SecretAccessKey: 'role-secret',
  SessionToken: 'role-session',
  Expiration: '2026-10-28T12:00:00Z',
})
const LONG_LIVED = JSON.stringify({ Version: 1, AccessKeyId: 'AKIALONG', SecretAccessKey: 'long-secret' })
const SESSION_TOKEN = JSON.stringify({
  Credentials: { AccessKeyId: 'ASIASTS', SecretAccessKey: 'sts-secret', SessionToken: 'sts-session', Expiration: '2026-10-28T12:00:00Z' },
})
const MODE_BITS = 0o777
const READ_ONLY_FILE = 0o400

function fakeAws(outputs: Record<string, string>) {
  const calls: string[] = []
  const aws: AwsCli = (args) => {
    const command = args.slice(0, 2).join(' ')
    calls.push(command)
    const output = outputs[command]
    if (output === undefined) throw new Error(`unexpected aws ${command}`)
    return output
  }
  return { aws, calls }
}

describe('short-lived AWS environment for eval Runs', () => {
  it('replaces AWS_PROFILE with the profile role credentials and its region', () => {
    const { aws } = fakeAws({ 'configure export-credentials': ROLE_CREDENTIALS, 'configure get': 'eu-west-1\n' })
    expect(shortLivedAwsEnvironment({ AWS_PROFILE: 'sso', OPENROUTER_API_KEY: 'k' }, aws)).toEqual({
      OPENROUTER_API_KEY: 'k',
      AWS_ACCESS_KEY_ID: 'ASIAROLE',
      AWS_SECRET_ACCESS_KEY: 'role-secret',
      AWS_SESSION_TOKEN: 'role-session',
      AWS_REGION: 'eu-west-1',
    })
  })

  it('exchanges long-lived keys for an STS session token and keeps a given region', () => {
    const { aws, calls } = fakeAws({ 'configure export-credentials': LONG_LIVED, 'sts get-session-token': SESSION_TOKEN })
    const environment = shortLivedAwsEnvironment({ AWS_PROFILE: 'keys', AWS_REGION: 'us-east-1' }, aws)
    expect(environment).toEqual({
      AWS_REGION: 'us-east-1',
      AWS_ACCESS_KEY_ID: 'ASIASTS',
      AWS_SECRET_ACCESS_KEY: 'sts-secret',
      AWS_SESSION_TOKEN: 'sts-session',
    })
    expect(calls).toEqual(['configure export-credentials', 'sts get-session-token'])
    expect(JSON.stringify(environment)).not.toContain('AKIALONG')
  })

  it('leaves an environment without AWS_PROFILE as it is', () => {
    const { aws, calls } = fakeAws({})
    expect(shortLivedAwsEnvironment({ OPENROUTER_API_KEY: 'k' }, aws)).toEqual({ OPENROUTER_API_KEY: 'k' })
    expect(calls).toEqual([])
  })
})

describe('read-only AWS SSO configuration for the Bedrock test home', () => {
  const roots: string[] = []
  afterEach(async () => {
    for (const root of roots.splice(0)) {
      await chmod(path.join(root, 'home', '.aws', 'config'), MODE_BITS).catch(() => undefined)
      await rm(root, { recursive: true, force: true })
    }
  })

  it('copies config and the SSO cache as 0400 files, and never the long-lived keys', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'aws-sso-home-'))
    roots.push(root)
    const real = path.join(root, 'real')
    await mkdir(path.join(real, '.aws', 'sso', 'cache'), { recursive: true })
    await writeFile(path.join(real, '.aws', 'config'), '[profile sso]\n')
    await writeFile(path.join(real, '.aws', 'credentials'), '[default]\naws_secret_access_key = long\n')
    await writeFile(path.join(real, '.aws', 'sso', 'cache', 'token.json'), '{}')
    const home = path.join(root, 'home')

    await copyAwsSsoConfiguration(real, home)

    const aws = path.join(home, '.aws')
    expect((await stat(aws)).isDirectory()).toBe(true)
    expect((await readdir(aws)).sort()).toEqual(['config', 'sso'])
    for (const file of [path.join(aws, 'config'), path.join(aws, 'sso', 'cache', 'token.json')]) {
      expect((await stat(file)).mode & MODE_BITS).toBe(READ_ONLY_FILE)
    }
  })
})
