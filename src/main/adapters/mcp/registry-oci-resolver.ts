import { execFile } from 'node:child_process'
import { getSafeChildEnv } from '../../env'

const OCI_COMMAND_TIMEOUT_MS = 5 * 60_000
const OCI_COMMAND_MAX_BUFFER_BYTES = 1_000_000
const OCI_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/
const MAX_OCI_IDENTIFIER_LENGTH = 2_048
const MAX_CONTROL_CHARACTER_CODE = 31
const DELETE_CHARACTER_CODE = 127

export interface ResolvedOciImage {
  readonly coordinate: string
  readonly digest: string
}

export type OciImageResolver = (identifier: string) => Promise<ResolvedOciImage>
export type OciCommandRunner = (args: readonly string[]) => Promise<string>

function childEnvironment() {
  const result: Record<string, string> = {}
  for (const [name, value] of Object.entries(getSafeChildEnv())) {
    if (value !== undefined) result[name] = value
  }
  return result
}

function runDocker(args: readonly string[]) {
  return new Promise<string>((resolve, reject) => {
    execFile(
      'docker',
      [...args],
      {
        encoding: 'utf8',
        env: childEnvironment(),
        maxBuffer: OCI_COMMAND_MAX_BUFFER_BYTES,
        timeout: OCI_COMMAND_TIMEOUT_MS,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (!error) {
          resolve(stdout)
          return
        }
        const detail = stderr.trim() || error.message
        reject(new Error(`Docker could not verify the MCP OCI image: ${detail}`))
      },
    )
  })
}

function repositoryFromIdentifier(identifier: string) {
  const digestSeparator = identifier.indexOf('@')
  const withoutDigest = digestSeparator >= 0 ? identifier.slice(0, digestSeparator) : identifier
  const lastSlash = withoutDigest.lastIndexOf('/')
  const tagSeparator = withoutDigest.lastIndexOf(':')
  return tagSeparator > lastSlash ? withoutDigest.slice(0, tagSeparator) : withoutDigest
}

function declaredDigest(identifier: string) {
  const separator = identifier.indexOf('@')
  if (separator < 0) return undefined
  const digest = identifier.slice(separator + 1)
  if (!OCI_DIGEST_PATTERN.test(digest)) {
    throw new Error('OCI package identifiers may use only an exact sha256 digest.')
  }
  return digest
}

function validateOciIdentifier(identifier: string) {
  const hasForbiddenCharacter = [...identifier].some((character) => {
    const code = character.charCodeAt(0)
    return (
      /\s/.test(character) || code <= MAX_CONTROL_CHARACTER_CODE || code === DELETE_CHARACTER_CODE
    )
  })
  if (
    identifier.length > MAX_OCI_IDENTIFIER_LENGTH ||
    identifier.startsWith('-') ||
    identifier.includes('://') ||
    identifier.includes('\\') ||
    hasForbiddenCharacter
  ) {
    throw new Error('Registry OCI package identifier is invalid.')
  }
  const repository = repositoryFromIdentifier(identifier)
  const lastSlash = identifier.lastIndexOf('/')
  const hasTag = identifier.lastIndexOf(':') > lastSlash
  const digest = declaredDigest(identifier)
  if (!repository.includes('/') || (!hasTag && !digest)) {
    throw new Error('Registry OCI packages require an explicit tag or sha256 digest.')
  }
  return { repository, digest }
}

function parseRepoDigests(stdout: string) {
  let value: unknown
  try {
    value = JSON.parse(stdout)
  } catch {
    throw new Error('Docker returned invalid repository digest metadata.')
  }
  if (!Array.isArray(value) || value.some((candidate) => typeof candidate !== 'string')) {
    throw new Error('Docker did not return repository digest metadata for the MCP OCI image.')
  }
  return value.filter((candidate): candidate is string => typeof candidate === 'string')
}

export function createDockerOciImageResolver(
  runCommand: OciCommandRunner = runDocker,
): OciImageResolver {
  return async (identifier) => {
    const requested = validateOciIdentifier(identifier)
    await runCommand(['pull', '--quiet', identifier])
    const repoDigests = parseRepoDigests(
      await runCommand(['image', 'inspect', '--format={{json .RepoDigests}}', identifier]),
    )
    const coordinate = repoDigests.find((candidate) => {
      const [repository, digest] = candidate.split('@')
      if (repository !== requested.repository || !digest || !OCI_DIGEST_PATTERN.test(digest)) {
        return false
      }
      return requested.digest === undefined || requested.digest === digest
    })
    if (!coordinate) {
      throw new Error('Docker could not prove an immutable sha256 digest for the MCP OCI image.')
    }
    const digest = coordinate.slice(coordinate.indexOf('@') + 1)
    return { coordinate, digest }
  }
}

export const resolveOciImageWithDocker = createDockerOciImageResolver()
