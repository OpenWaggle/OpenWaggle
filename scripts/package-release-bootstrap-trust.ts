import { stripVTControlCharacters } from 'node:util'
import { runRequired } from './package-release-bootstrap-commands'
import { isJsonObject, type JsonObject } from './package-release-bootstrap-model'
import type { BootstrapDependencies } from './package-release-bootstrap-types'

function jsonObjects(value: string) {
  const normalized = stripVTControlCharacters(value)
  const documents: JsonObject[] = []
  for (let start = 0; start < normalized.length; start += 1) {
    if (normalized[start] !== '{') continue
    let depth = 0
    let escaped = false
    let quoted = false
    for (let end = start; end < normalized.length; end += 1) {
      const character = normalized[end]
      if (quoted) {
        if (escaped) {
          escaped = false
          continue
        }
        if (character === '\\') {
          escaped = true
          continue
        }
        if (character === '"') quoted = false
        continue
      }
      if (character === '"') {
        quoted = true
        continue
      }
      if (character === '{') {
        depth += 1
        continue
      }
      if (character !== '}') continue
      depth -= 1
      if (depth !== 0) continue
      try {
        const parsed: unknown = JSON.parse(normalized.slice(start, end + 1))
        if (isJsonObject(parsed)) documents.push(parsed)
        start = end
      } catch {
        // Non-JSON terminal output can contain braces; keep scanning for the next object.
      }
      break
    }
  }
  return documents
}

function isAuthenticationHandoff(value: JsonObject) {
  return value.title === 'Authenticate your account at' && typeof value.url === 'string'
}

export function parseTrustListOutput(value: string): unknown {
  const configurations = jsonObjects(value).filter((item) => !isAuthenticationHandoff(item))
  if (configurations.length === 0) return []
  if (configurations.length === 1) return configurations[0]
  return configurations
}

export async function readTrustConfiguration(
  projectRoot: string,
  packageName: string,
  dependencies: BootstrapDependencies,
) {
  const output = await runRequired(dependencies, {
    args: ['trust', 'list', packageName, '--json'],
    captureOutput: true,
    command: 'npm',
    cwd: projectRoot,
    interactive: true,
  })
  return parseTrustListOutput(output)
}
