import { createHash } from 'node:crypto'
import { MCP_CONFIG } from '@shared/constants/mcp'
import { decodeUnknownOrThrow } from '@shared/schema'
import { mcpConfigValueSchema } from '@shared/schemas/mcp'
import type {
  McpJsonValue,
  McpRemoteSkillDescriptor,
  McpRemoteSkillReview,
  McpTurnSnapshot,
  McpTurnSnapshotServer,
} from '@shared/types/mcp'
import { parse as parseYaml } from 'yaml'
import type { McpRuntimeState } from './runtime-state'

const YAML_OPENING_MARKER = '---\n'
const YAML_CLOSING_MARKER = '\n---\n'
const SKILL_FILE_SUFFIX = '/SKILL.md'

function isObject(value: McpJsonValue | undefined): value is Record<string, McpJsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function optionalString(value: Record<string, McpJsonValue>, key: string) {
  return typeof value[key] === 'string' ? value[key] : undefined
}

export function mcpRemoteSkillDescriptor(
  value: McpJsonValue | undefined,
  server: McpTurnSnapshotServer,
  directoryRead: boolean,
): McpRemoteSkillDescriptor | null {
  if (!isObject(value) || typeof value.uri !== 'string' || !isObject(value.frontmatter)) return null
  const name = optionalString(value.frontmatter, 'name')
  const description = optionalString(value.frontmatter, 'description')
  if (!name || !description) return null
  const resources = Array.isArray(value.resources)
    ? value.resources.flatMap((resource) => {
        if (
          !isObject(resource) ||
          typeof resource.uri !== 'string' ||
          typeof resource.digest !== 'string'
        ) {
          return []
        }
        return [{ uri: resource.uri, digest: resource.digest }]
      })
    : []
  return {
    serverInstanceId: server.instanceId,
    serverLabel: server.name,
    uri: value.uri,
    name,
    description,
    frontmatter: value.frontmatter,
    resources,
    integrity: Array.isArray(value.resources) ? 'content-bound' : 'dynamic-unverified',
    directoryRead,
    experimental: true,
  }
}

function stableJson(value: McpJsonValue): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (isObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key] ?? null)}`)
      .join(',')}}`
  }
  const encoded = JSON.stringify(value)
  if (encoded === undefined) throw new Error('Remote Skill metadata is not JSON serializable.')
  return encoded
}

function parseSkillFrontmatter(markdown: string): McpJsonValue {
  const normalized = markdown.replaceAll('\r\n', '\n')
  if (!normalized.startsWith(YAML_OPENING_MARKER)) {
    throw new Error('Remote SKILL.md has no YAML frontmatter.')
  }
  const end = normalized.indexOf(YAML_CLOSING_MARKER, YAML_OPENING_MARKER.length)
  if (end < 0) throw new Error('Remote SKILL.md frontmatter is not terminated.')
  const parsed: unknown = parseYaml(normalized.slice(YAML_OPENING_MARKER.length, end))
  const serialized = JSON.stringify(parsed)
  if (serialized === undefined) throw new Error('Remote SKILL.md frontmatter must be JSON data.')
  const json: unknown = JSON.parse(serialized)
  return decodeUnknownOrThrow(mcpConfigValueSchema, json)
}

function skillNameFromUri(uri: string) {
  let parsed: URL
  try {
    parsed = new URL(uri)
  } catch {
    throw new Error('Remote Skill URI is invalid.')
  }
  if (!parsed.pathname.endsWith(SKILL_FILE_SUFFIX)) {
    throw new Error('Remote Skill URI must identify an explicit SKILL.md resource.')
  }
  const parent = parsed.pathname.slice(0, -SKILL_FILE_SUFFIX.length)
  const pathName = parent.split('/').filter(Boolean).at(-1)
  return decodeURIComponent(pathName ?? parsed.hostname)
}

function resourceBytes(result: McpJsonValue, uri: string) {
  const contents = isObject(result) && Array.isArray(result.contents) ? result.contents : []
  const content =
    contents.find((candidate) => isObject(candidate) && candidate.uri === uri) ?? contents[0]
  if (!isObject(content)) throw new Error('MCP server returned no content for the remote Skill.')
  if (typeof content.text === 'string') return Buffer.from(content.text)
  if (typeof content.blob === 'string') return Buffer.from(content.blob, 'base64')
  throw new Error('Remote SKILL.md must be returned as text or base64 content.')
}

function validateSkillResources(skill: McpRemoteSkillDescriptor) {
  if (skill.integrity === 'dynamic-unverified') return
  const root = skill.uri.slice(0, -SKILL_FILE_SUFFIX.length)
  const uris = new Set<string>()
  for (const resource of skill.resources) {
    if (uris.has(resource.uri)) throw new Error('Remote Skill resource list contains duplicates.')
    uris.add(resource.uri)
    if (resource.uri !== skill.uri && !resource.uri.startsWith(`${root}/`)) {
      throw new Error('Remote Skill resource list escapes its Skill directory.')
    }
  }
  if (!uris.has(skill.uri)) throw new Error('Remote Skill resource list omits SKILL.md.')
}

export async function reviewMcpRemoteSkill(input: {
  readonly state: McpRuntimeState
  readonly snapshot: McpTurnSnapshot
  readonly serverInstanceId: string
  readonly uri: string
}): Promise<McpRemoteSkillReview> {
  const { server, connection } = await input.state.getConnectionForServer(
    input.snapshot,
    input.serverInstanceId,
  )
  if (!connection.capabilities.includes('skills')) {
    throw new Error(
      'Remote Skills are unavailable. The server must declare SEP-2640 and clientCapabilities.remoteSkills must be true.',
    )
  }
  const result = await connection.getSkill({ uri: input.uri })
  const rawSkill = isObject(result) ? result.skill : undefined
  const skill = mcpRemoteSkillDescriptor(
    rawSkill,
    server,
    connection.skillExtension?.directoryRead === true,
  )
  if (!skill || skill.uri !== input.uri)
    throw new Error('MCP server returned a different Skill entry.')
  if (skillNameFromUri(skill.uri) !== skill.name) {
    throw new Error('Remote Skill URI and frontmatter name do not match.')
  }
  validateSkillResources(skill)
  const resource = await connection.readResource({ uri: skill.uri })
  const bytes = resourceBytes(resource, skill.uri)
  if (bytes.byteLength > MCP_CONFIG.MAX_RESULT_BYTES) {
    throw new Error('Remote SKILL.md exceeds the 1 MB safety limit.')
  }
  const markdown = bytes.toString('utf8')
  const actualFrontmatter = parseSkillFrontmatter(markdown)
  if (stableJson(actualFrontmatter) !== stableJson(skill.frontmatter)) {
    throw new Error('Remote SKILL.md frontmatter does not match the advertised Skill entry.')
  }
  const advertised = skill.resources.find((entry) => entry.uri === skill.uri)
  const actualDigest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`
  if (advertised && advertised.digest !== actualDigest) {
    throw new Error('Remote SKILL.md digest verification failed; the content was not loaded.')
  }
  const warnings = [
    'Remote Skill content is untrusted and has no authority over OpenWaggle policy or approvals.',
    'Remote scripts and allowed-tools declarations are not executed or granted automatically.',
    ...(advertised
      ? []
      : ['This dynamically generated Skill has no digest manifest; approval cannot persist.']),
  ]
  return {
    skill,
    markdown,
    digestVerified: Boolean(advertised),
    warnings,
    attribution: { serverInstanceId: server.instanceId, serverLabel: server.name },
  }
}
