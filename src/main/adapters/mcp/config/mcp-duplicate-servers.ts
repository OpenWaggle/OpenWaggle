/**
 * An `mcp.json` whose `mcpServers` names a server twice: a read keeps the last entry (JSON.parse,
 * as Pi reads it) but a text edit changes the first, so "Remove override" could delete the real
 * definition. Such a file is shown as an error and never edited.
 */
import { findNodeAtLocation, parseTree } from 'jsonc-parser'
import type { McpConfigFileLocation, McpConfigFileReader } from './mcp-config-files'

/** The names `mcpServers` holds more than once, in file order. */
export function duplicateMcpServerNames(text: string) {
  const root = parseTree(text)
  const servers = root ? findNodeAtLocation(root, ['mcpServers']) : undefined
  if (servers?.type !== 'object') return []
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const property of servers.children ?? []) {
    const key: unknown = property.children?.[0]?.value
    if (typeof key !== 'string') continue
    const name = key
    if (seen.has(name)) duplicates.add(name)
    seen.add(name)
  }
  return [...duplicates]
}

export function duplicateMcpServerMessage(filePath: string, name: string) {
  return `${filePath}: server "${name}" is defined more than once; remove one entry before changing it here`
}

/** One error per server a file names twice, for the configuration view. */
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
      ? duplicateMcpServerNames(text).map((name) => duplicateMcpServerMessage(file.path, name))
      : []
  })
}
