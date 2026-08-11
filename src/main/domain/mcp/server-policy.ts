import { MCP_SUPPORTED_PROTOCOL_VERSIONS } from '@shared/constants/mcp'
import type {
  McpCompatibilityProfile,
  McpDirectToolsMode,
  McpServerDefinition,
  McpServerTransport,
} from '@shared/types/mcp'

const KNOWN_SERVER_FIELDS = new Set([
  'command',
  'args',
  'cwd',
  'env',
  'url',
  'headers',
  'transport',
  'compatibility',
  'protocolVersion',
  'directTools',
  'required',
  'security',
  'auth',
  'clientCapabilities',
  'provenance',
])

const SECRET_NAME_PATTERN = /(api[-_]?key|token|secret|password|credential|authorization|cookie)/i

function isLoopbackHostname(hostname: string) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
}

export function getIgnoredMcpServerFields(definition: McpServerDefinition) {
  return Object.keys(definition)
    .filter((field) => !KNOWN_SERVER_FIELDS.has(field))
    .sort()
}

export function resolveMcpServerTransport(definition: McpServerDefinition): McpServerTransport {
  if (definition.transport) return definition.transport
  if (typeof definition.url === 'string') return 'streamable-http'
  if (typeof definition.command === 'string') return 'stdio'
  return 'unknown'
}

export function resolveMcpCompatibilityProfile(
  definition: McpServerDefinition,
): McpCompatibilityProfile {
  if (definition.compatibility) return definition.compatibility
  if (definition.transport === 'sse') return 'legacy-sse'
  if (definition.transport === 'websocket') return 'legacy-websocket'
  return 'auto'
}

export function resolveMcpDirectToolsMode(definition: McpServerDefinition): McpDirectToolsMode {
  if (definition.directTools === true) return 'enabled'
  if (definition.directTools === false) return 'disabled'
  if (Array.isArray(definition.directTools)) return 'partial'
  return 'inherited'
}

function findPlaintextCredentialKeys(
  values: Readonly<Record<string, string | { readonly secret: string }>> | undefined,
) {
  if (!values) return []
  const credentialKeys: string[] = []
  for (const [name, value] of Object.entries(values)) {
    if (typeof value === 'string' && SECRET_NAME_PATTERN.test(name)) credentialKeys.push(name)
  }
  return credentialKeys
}

function validateRemoteEndpoint(
  definition: McpServerDefinition,
  hasUrl: boolean,
  issues: string[],
) {
  if (!hasUrl) return
  try {
    const url = new URL(definition.url ?? '')
    if (
      url.protocol !== 'https:' &&
      !isLoopbackHostname(url.hostname) &&
      !definition.security?.allowInsecurePrivateNetwork
    ) {
      issues.push('Non-loopback MCP endpoints require HTTPS.')
    }
    if (url.username || url.password) {
      issues.push('MCP endpoint credentials must use secret references, not URL userinfo.')
    }
  } catch {
    issues.push('MCP server url is invalid.')
  }
}

function validateOAuthPolicy(definition: McpServerDefinition, hasUrl: boolean, issues: string[]) {
  if (definition.auth && !hasUrl) issues.push('OAuth is supported only for remote MCP servers.')
  for (const domain of definition.security?.oauthDomains ?? []) {
    if (!domain.trim() || domain.includes('/') || domain.includes(':')) {
      issues.push(`Invalid MCP OAuth domain grant: ${domain}.`)
    }
  }
}

function validateProtocolPolicy(definition: McpServerDefinition, issues: string[]) {
  if (
    definition.protocolVersion &&
    !MCP_SUPPORTED_PROTOCOL_VERSIONS.some((candidate) => candidate === definition.protocolVersion)
  ) {
    issues.push(`Unsupported MCP protocol revision: ${definition.protocolVersion}.`)
  }
  const compatibility = resolveMcpCompatibilityProfile(definition)
  if (
    compatibility === 'modern-only' &&
    (definition.transport === 'sse' || definition.transport === 'websocket')
  ) {
    issues.push('Modern-only MCP cannot use a legacy SSE or WebSocket transport.')
  }
}

function validateCredentialPolicy(definition: McpServerDefinition, issues: string[]) {
  const plaintextEnv = findPlaintextCredentialKeys(definition.env)
  if (plaintextEnv.length > 0) {
    issues.push(
      `Plaintext secret-like environment values require secret references: ${plaintextEnv.join(', ')}.`,
    )
  }
  const plaintextHeaders = findPlaintextCredentialKeys(definition.headers)
  if (plaintextHeaders.length > 0) {
    issues.push(
      `Plaintext secret-like headers require secret references: ${plaintextHeaders.join(', ')}.`,
    )
  }
}

export function validateMcpServerDefinition(input: {
  readonly definition: McpServerDefinition
  readonly sourceScope: 'global' | 'project'
}) {
  const issues: string[] = []
  const { definition } = input
  const hasCommand = typeof definition.command === 'string' && definition.command.trim().length > 0
  const hasUrl = typeof definition.url === 'string' && definition.url.trim().length > 0
  if (hasCommand === hasUrl)
    issues.push('Configure exactly one transport endpoint: command or url.')
  if (definition.cwd && input.sourceScope === 'project' && definition.cwd.startsWith('/')) {
    issues.push('Project MCP cwd must be project-relative.')
  }
  validateRemoteEndpoint(definition, hasUrl, issues)
  validateOAuthPolicy(definition, hasUrl, issues)
  validateProtocolPolicy(definition, issues)
  validateCredentialPolicy(definition, issues)
  return issues
}
