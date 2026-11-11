/**
 * Notarizes and staples the signed Electrobun app with Apple's notary service, before Hutch packs
 * it, so the update archive, the transition zip and the DMG carry the same stapled bundle. The
 * hosted macOS runners lose Apple's services now and then (release-and-ci memory: notarytool and
 * stapler transport errors), so a transport failure is retried; a rejection fails at once and
 * prints Apple's log.
 */
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { isRecord } from '../../src/shared/utils/validation'

const run = promisify(execFile)
const MAX_BUFFER_BYTES = 32 * 1024 * 1024
const ATTEMPTS = 3
const RETRY_DELAY_MS = 30_000
const TRANSPORT_ERROR =
  /NSURLErrorDomain|HTTPError\(statusCode: nil|timed out|network connection was lost/iu

export interface NotaryCredentials {
  readonly appleId: string
  readonly password: string
  readonly teamId: string
}

/** The notary credentials the release already uses for electron-builder, if all are set. */
export function notaryCredentials(environment: NodeJS.ProcessEnv): NotaryCredentials | null {
  const appleId = environment['APPLE_ID'] ?? ''
  const password = environment['APPLE_APP_SPECIFIC_PASSWORD'] ?? ''
  const teamId = environment['APPLE_TEAM_ID'] ?? ''
  return appleId === '' || password === '' || teamId === '' ? null : { appleId, password, teamId }
}

function failureOutput(error: unknown) {
  const message = error instanceof Error ? error.message : JSON.stringify(error)
  if (!isRecord(error)) return message
  const { stdout, stderr } = error
  return `${message}\n${typeof stdout === 'string' ? stdout : ''}${typeof stderr === 'string' ? stderr : ''}`
}

async function withTransportRetries<Result>(label: string, action: () => Promise<Result>) {
  let attempt = 0
  while (true) {
    attempt += 1
    try {
      return await action()
    } catch (error) {
      const output = failureOutput(error)
      if (attempt >= ATTEMPTS || !TRANSPORT_ERROR.test(output)) {
        throw new Error(`${label}: ${output}`, { cause: error })
      }
      console.warn(`${label} lost Apple's service (attempt ${attempt}); retrying.`)
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS))
    }
  }
}

async function submitAndStaple(target: string, submission: string, credentials: NotaryCredentials) {
  const submit = await withTransportRetries('notarytool submit', () =>
    run(
      'xcrun',
      [
        'notarytool',
        'submit',
        submission,
        '--apple-id',
        credentials.appleId,
        '--password',
        credentials.password,
        '--team-id',
        credentials.teamId,
        '--wait',
        '--output-format',
        'json',
      ],
      { maxBuffer: MAX_BUFFER_BYTES },
    ),
  )
  const result: unknown = JSON.parse(submit.stdout)
  const status = isRecord(result) ? result['status'] : null
  if (status !== 'Accepted') {
    throw new Error(`Notarization of ${target} was not accepted: ${submit.stdout}`)
  }
  await withTransportRetries('stapler staple', () => run('xcrun', ['stapler', 'staple', target]))
  await run('xcrun', ['stapler', 'validate', target])
}

/** Notarizes and staples an app bundle (submitted as a zip of it) or a signed DMG (as is). */
export async function notarizeMacos(target: string, credentials: NotaryCredentials) {
  if (target.endsWith('.dmg')) return submitAndStaple(target, target, credentials)
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-notary-'))
  const archive = path.join(directory, `${path.basename(target, '.app')}.zip`)
  try {
    await run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', target, archive])
    await submitAndStaple(target, archive, credentials)
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
}
