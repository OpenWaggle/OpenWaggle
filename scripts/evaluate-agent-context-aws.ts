/**
 * AWS credentials for the agent-context evaluation's Runs. Every Run is a real model with YOLO
 * authority over a throwaway HOME, so the user's `~/.aws` (long-lived keys, the SSO token cache,
 * the configuration) must never be reachable from it, not even through a link. Instead each Run
 * gets short-lived role credentials in its environment: the agent can still read them, but they
 * expire and cannot change the user's configuration.
 */
import { execFileSync } from 'node:child_process'
import { Schema } from '@shared/schema'
import { scriptEnv } from './support/env'
import { objectFields, unknownField } from './support/object-fields'

/** Runs the AWS CLI with `args` and returns its stdout. */
export type AwsCli = (args: readonly string[]) => string

const SESSION_TOKEN_SECONDS = 3_600

const defaultAwsCli: AwsCli = (args) =>
  execFileSync('aws', [...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

interface ExportedCredentials {
  readonly accessKeyId: string
  readonly secretAccessKey: string
  readonly sessionToken: string | null
  readonly expires: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function stringField(record: Record<string, unknown>, name: string) {
  const value = record[name]
  return typeof value === 'string' && value.length > 0 ? value : null
}

/** `aws sts get-session-token` wraps the credentials in `Credentials`; `export-credentials` does not. */
const credentialsEnvelopeSchema = Schema.Struct({ Credentials: unknownField })

function parseCredentials(raw: string, source: string) {
  const parsed: unknown = JSON.parse(raw)
  const wrapped = objectFields(credentialsEnvelopeSchema, parsed)?.Credentials
  const record = isRecord(wrapped) ? wrapped : parsed
  if (!isRecord(record)) throw new Error(`${source} printed no credentials.`)
  const accessKeyId = stringField(record, 'AccessKeyId')
  const secretAccessKey = stringField(record, 'SecretAccessKey')
  if (!accessKeyId || !secretAccessKey) throw new Error(`${source} printed no access key.`)
  const credentials: ExportedCredentials = {
    accessKeyId,
    secretAccessKey,
    sessionToken: stringField(record, 'SessionToken'),
    expires: stringField(record, 'Expiration') !== null,
  }
  return credentials
}

/**
 * `environment` with AWS_PROFILE replaced by short-lived credentials and a region. SSO and
 * assumed-role profiles export their temporary role credentials; a profile with long-lived keys
 * is exchanged for an STS session token, so no Run ever holds a key that does not expire.
 * Without AWS_PROFILE the environment is returned as it is.
 */
export function shortLivedAwsEnvironment(
  environment: Readonly<Record<string, string>>,
  aws: AwsCli = defaultAwsCli,
) {
  const { AWS_PROFILE: profile, ...rest } = environment
  if (!profile) {
    const record: Record<string, string> = { ...environment }
    return record
  }
  const exportArgs = [
    'configure',
    'export-credentials',
    '--profile',
    profile,
    '--format',
    'process',
  ]
  let credentials = parseCredentials(aws(exportArgs), 'aws configure export-credentials')
  if (!credentials.expires) {
    const tokenArgs = [
      'sts',
      'get-session-token',
      '--profile',
      profile,
      '--duration-seconds',
      String(SESSION_TOKEN_SECONDS),
      '--output',
      'json',
    ]
    credentials = parseCredentials(aws(tokenArgs), 'aws sts get-session-token')
  }
  const region =
    scriptEnv(rest).AWS_REGION ??
    scriptEnv(rest).AWS_DEFAULT_REGION ??
    aws(['configure', 'get', 'region', '--profile', profile]).trim()
  const record: Record<string, string> = {
    ...rest,
    AWS_ACCESS_KEY_ID: credentials.accessKeyId,
    AWS_SECRET_ACCESS_KEY: credentials.secretAccessKey,
    ...(credentials.sessionToken ? { AWS_SESSION_TOKEN: credentials.sessionToken } : {}),
    ...(region ? { AWS_REGION: region } : {}),
  }
  return record
}
