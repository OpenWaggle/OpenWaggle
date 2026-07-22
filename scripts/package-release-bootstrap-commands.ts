import type {
  BootstrapCommandRequest,
  BootstrapCommandResult,
  BootstrapDependencies,
} from './package-release-bootstrap-types'

const NOT_FOUND_PATTERNS = ['E404', 'HTTP 404', 'Not Found'] as const
const GITHUB_TOKEN_ENVIRONMENT_KEYS = [
  'GH_ENTERPRISE_TOKEN',
  'GH_TOKEN',
  'GITHUB_ENTERPRISE_TOKEN',
  'GITHUB_TOKEN',
] as const

function commandLabel(request: BootstrapCommandRequest) {
  return [request.command, ...request.args].join(' ')
}

export function redactBootstrapDiagnostic(value: string) {
  return value
    .replace(
      /((?:GH_ENTERPRISE_TOKEN|GH_TOKEN|GITHUB_ENTERPRISE_TOKEN|GITHUB_TOKEN|NPM_TOKEN|NODE_AUTH_TOKEN|NPM_CONFIG_[A-Z0-9_]*(?:AUTH|OTP|TOKEN)[A-Z0-9_]*|_authToken)\s*[=:]\s*)[^\s]+/giu,
      '$1[redacted]',
    )
    .replace(/(npm_[A-Za-z0-9_-]{12,})/giu, '[redacted]')
    .replace(/(_authToken\s*[=:]\s*)[^\s]+/giu, '$1[redacted]')
    .replace(/(gh[opsu]_[A-Za-z0-9_]{20,})/gu, '[redacted]')
    .replace(/(github_pat_[A-Za-z0-9_]{20,})/gu, '[redacted]')
    .replace(/(Bearer\s+)[^\s]+/giu, '$1[redacted]')
    .replace(/(https:\/\/www\.npmjs\.com\/auth\/cli\/)[^\s"']+/giu, '$1[redacted]')
    .replace(
      /(https:\/\/registry\.npmjs\.org\/-\/v1\/done\?authId=)[^\s"']+/giu,
      '$1[redacted]',
    )
    .trim()
}

export function isCredentialEnvironmentKey(key: string) {
  const normalized = key.toUpperCase()
  return (
    GITHUB_TOKEN_ENVIRONMENT_KEYS.some((candidate) => candidate === normalized) ||
    normalized === 'NODE_AUTH_TOKEN' ||
    (normalized.startsWith('NPM_') &&
      (normalized.includes('TOKEN') ||
        normalized.includes('_AUTH') ||
        normalized.includes('OTP')))
  )
}

export async function runCommand(
  dependencies: BootstrapDependencies,
  request: BootstrapCommandRequest,
) {
  return dependencies.commands.run(request)
}

export async function runRequired(
  dependencies: BootstrapDependencies,
  request: BootstrapCommandRequest,
) {
  const result = await runCommand(dependencies, request)
  if (result.exitCode === 0) return result.stdout.trim()

  const diagnostic = redactBootstrapDiagnostic(result.stderr || result.stdout)
  throw new Error(
    `${commandLabel(request)} failed${diagnostic.length > 0 ? `: ${diagnostic}` : '.'}`,
  )
}

export function isNotFound(result: BootstrapCommandResult) {
  const output = `${result.stderr}\n${result.stdout}`
  return result.exitCode !== 0 && NOT_FOUND_PATTERNS.some((pattern) => output.includes(pattern))
}

export function runMutation(
  dependencies: BootstrapDependencies,
  request: Omit<BootstrapCommandRequest, 'mutates'>,
) {
  return runRequired(dependencies, {
    ...request,
    interactive: request.command === 'npm',
    mutates: true,
  })
}
