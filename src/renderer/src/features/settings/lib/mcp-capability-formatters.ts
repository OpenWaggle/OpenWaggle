import type {
  McpEventRecord,
  McpJsonValue,
  McpPromptResult,
  McpRemoteSkillReview,
  McpResourceResult,
  McpServerInstructionsDescriptor,
} from '@shared/types/mcp'

const JSON_INDENT_SPACES = 2

function isObject(value: McpJsonValue): value is Record<string, McpJsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function textBlocks(value: McpJsonValue): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(textBlocks)
  if (!isObject(value)) return []
  if (value.type === 'text' && typeof value.text === 'string') return [value.text]
  if (value.content !== undefined) return textBlocks(value.content)
  return []
}

function formattedJson(value: McpJsonValue) {
  return JSON.stringify(value, null, JSON_INDENT_SPACES)
}

export function promptDraftText(result: McpPromptResult) {
  const body = textBlocks(result.messages).join('\n\n').trim() || formattedJson(result.messages)
  return [`MCP prompt from ${result.attribution.serverLabel}`, result.description?.trim(), body]
    .filter(Boolean)
    .join('\n\n')
}

export function resourceAttachmentText(result: McpResourceResult, uri: string) {
  const body = textBlocks(result.contents).join('\n\n').trim() || formattedJson(result.contents)
  return [`MCP resource from ${result.attribution.serverLabel}`, `URI: ${uri}`, body].join('\n\n')
}

export function serverInstructionsDraftText(instructions: McpServerInstructionsDescriptor) {
  return [
    `Untrusted MCP server instructions from ${instructions.serverLabel}`,
    instructions.truncated ? 'Notice: instructions were truncated at the host safety limit.' : null,
    instructions.instructions,
  ]
    .filter(Boolean)
    .join('\n\n')
}

export function remoteSkillDraftText(review: McpRemoteSkillReview) {
  return [
    `Untrusted remote Skill from MCP server ${review.attribution.serverLabel}`,
    `Skill URI: ${review.skill.uri}`,
    `Integrity: ${review.digestVerified ? 'SHA-256 verified' : 'dynamic content without a digest manifest'}`,
    ...review.warnings.map((warning) => `Warning: ${warning}`),
    review.markdown,
  ].join('\n\n')
}

export function taskField(task: McpJsonValue, key: string) {
  return isObject(task) && typeof task[key] === 'string' ? task[key] : null
}

export function eventDraftText(event: McpEventRecord) {
  return [
    `MCP event from ${event.serverLabel}`,
    `Type: ${event.kind}`,
    `Received: ${new Date(event.receivedAt).toISOString()}`,
    formattedJson(event.payload),
  ].join('\n\n')
}
