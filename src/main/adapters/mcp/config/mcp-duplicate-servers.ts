/**
 * An `mcp.json` that repeats a key, such as a server in `mcpServers` or `mcpServers` itself: a read
 * keeps the last one (JSON.parse, as Pi reads it) but a text edit changes the first, so "Remove
 * override" could delete the real definition. Such a file is shown as an error and never edited.
 */
import { type Node, parseTree } from 'jsonc-parser'
import type { McpConfigFileLocation, McpConfigFileReader } from './mcp-config-files'

type JsonPath = readonly (string | number)[]

function collectDuplicates(node: Node | undefined, at: JsonPath, duplicates: JsonPath[]) {
  if (node?.type === 'array') {
    for (const [index, item] of (node.children ?? []).entries()) {
      collectDuplicates(item, [...at, index], duplicates)
    }
    return
  }
  if (node?.type !== 'object') return
  const seen = new Set<string>()
  const repeated = new Set<string>()
  for (const property of node.children ?? []) {
    const key: unknown = property.children?.[0]?.value
    if (typeof key !== 'string') continue
    if (seen.has(key) && !repeated.has(key)) {
      repeated.add(key)
      duplicates.push([...at, key])
    }
    seen.add(key)
    collectDuplicates(property.children?.[1], [...at, key], duplicates)
  }
}

/** The keys a file holds more than once, at any level, as paths in file order. */
export function duplicateMcpConfigKeys(text: string) {
  const duplicates: JsonPath[] = []
  collectDuplicates(parseTree(text), [], duplicates)
  return duplicates
}

export function duplicateMcpKeyMessage(filePath: string, key: JsonPath) {
  const [first, name, ...rest] = key
  const what =
    first === 'mcpServers' && typeof name === 'string' && rest.length === 0
      ? `server ${JSON.stringify(name)}`
      : JSON.stringify(key.join('.'))
  return `${filePath}: ${what} is defined more than once; remove one entry before changing it here`
}

/** One error per key a file repeats, for the configuration view. */
export function duplicateMcpServerErrors(
  files: readonly McpConfigFileLocation[],
  reader: McpConfigFileReader,
) {
  return files.flatMap((file) => {
    let text: string | undefined
    try {
      text = reader.readText(file.path)
    } catch {
      return []
    }
    return text
      ? duplicateMcpConfigKeys(text).map((key) => duplicateMcpKeyMessage(file.path, key))
      : []
  })
}
