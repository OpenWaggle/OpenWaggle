import { Schema } from '@shared/schema'
import type { PrefixContent, PrefixTool } from '../first-turn-prefix/prefix-tokens'
import { objectFields, unknownField } from '../../support/object-fields'

/**
 * The prefix parts of an OpenAI chat-completions request body: the system prompt split into its
 * top-level `<section>` tags (Pi renders each named section as a tag), the declared tools, and
 * the hidden user-role context messages other than the measured prompt.
 */
const SECTION_PATTERN = /<([a-z][a-z0-9_-]*)>[\s\S]*?<\/\1>/g

/** The chat-completions body fields the prefix reads; each is checked where it is read. */
const requestBodySchema = Schema.Struct({ messages: unknownField, tools: unknownField })
const messageSchema = Schema.Struct({ role: unknownField, content: unknownField })
const textPartSchema = Schema.Struct({ text: Schema.String })
const functionToolSchema = Schema.Struct({
  function: Schema.Struct({
    name: Schema.String,
    description: unknownField,
    parameters: unknownField,
  }),
})

function textOf(content: unknown) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((part: unknown) => (Schema.is(textPartSchema)(part) ? part.text : ''))
    .join('\n')
}

export function systemSections(system: string) {
  const sections: { name: string; text: string }[] = []
  let consumed = 0
  for (const match of system.matchAll(SECTION_PATTERN)) {
    const before = system.slice(consumed, match.index).trim()
    if (before.length > 0) {
      sections.push({ name: sections.length === 0 ? 'preamble' : 'between-sections', text: before })
    }
    sections.push({ name: match[1] ?? 'section', text: match[0] })
    consumed = match.index + match[0].length
  }
  const rest = system.slice(consumed).trim()
  if (rest.length > 0) sections.push({ name: 'trailing', text: rest })
  return sections
}

function toolOf(value: unknown) {
  const fn = objectFields(functionToolSchema, value)?.function
  if (fn === undefined) {
    const tool: PrefixTool[] = []
    return tool
  }
  const tool: PrefixTool[] = [
    {
      name: fn.name,
      description: typeof fn.description === 'string' ? fn.description : '',
      parameters: fn.parameters,
    },
  ]
  return tool
}

function arrayOf(value: unknown) {
  const result: readonly unknown[] = Array.isArray(value) ? value : []
  return result
}

export function prefixContentOfOpenAiRequest(requestBody: unknown, prompt: string) {
  const body = objectFields(requestBodySchema, requestBody)
  const messages = arrayOf(body?.messages).flatMap((message) => {
    const fields = Schema.is(messageSchema)(message) ? message : undefined
    return fields === undefined ? [] : [fields]
  })
  const system = messages
    .filter((message) => message.role === 'system' || message.role === 'developer')
    .map((message) => textOf(message.content))
    .join('\n')
  const runContext = messages
    .filter((message) => message.role === 'user')
    .map((message) => textOf(message.content))
    .filter((text) => text.length > 0 && text !== prompt)
  const result: PrefixContent = {
    sections: systemSections(system),
    tools: arrayOf(body?.tools).flatMap(toolOf),
    runContext,
  }
  return result
}
