import type { PrefixContent, PrefixTool } from '../first-turn-prefix/prefix-tokens'

/**
 * The prefix parts of an OpenAI chat-completions request body: the system prompt split into its
 * top-level `<section>` tags (Pi renders each named section as a tag), the declared tools, and
 * the hidden user-role context messages other than the measured prompt.
 */
const SECTION_PATTERN = /<([a-z][a-z0-9_-]*)>[\s\S]*?<\/\1>/g

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function textOf(content: unknown) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map((part) => (isRecord(part) && typeof part.text === 'string' ? part.text : '')).join('\n')
}

export function systemSections(system: string) {
  const sections: { name: string; text: string }[] = []
  let consumed = 0
  for (const match of system.matchAll(SECTION_PATTERN)) {
    const before = system.slice(consumed, match.index).trim()
    if (before.length > 0) sections.push({ name: sections.length === 0 ? 'preamble' : 'between-sections', text: before })
    sections.push({ name: match[1] ?? 'section', text: match[0] })
    consumed = match.index + match[0].length
  }
  const rest = system.slice(consumed).trim()
  if (rest.length > 0) sections.push({ name: 'trailing', text: rest })
  return sections
}

function toolOf(value: unknown): PrefixTool[] {
  const fn = isRecord(value) && isRecord(value.function) ? value.function : null
  if (!fn || typeof fn.name !== 'string') return []
  return [{ name: fn.name, description: typeof fn.description === 'string' ? fn.description : '', parameters: fn.parameters }]
}

export function prefixContentOfOpenAiRequest(body: Record<string, unknown>, prompt: string): PrefixContent {
  const messages = Array.isArray(body.messages) ? body.messages.filter(isRecord) : []
  const system = messages
    .filter((message) => message.role === 'system' || message.role === 'developer')
    .map((message) => textOf(message.content))
    .join('\n')
  const runContext = messages
    .filter((message) => message.role === 'user')
    .map((message) => textOf(message.content))
    .filter((text) => text.length > 0 && text !== prompt)
  return {
    sections: systemSections(system),
    tools: Array.isArray(body.tools) ? body.tools.flatMap(toolOf) : [],
    runContext,
  }
}
