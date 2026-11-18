/**
 * Writes the published JSON Schemas to `website/public/schemas/`. `published-json-schemas.unit.test.ts`
 * fails, through `stalePublishedJsonSchemas`, when a committed file differs from what the runtime
 * schemas generate, so `bun run test:unit` and `bun run verify` catch drift.
 */
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  PUBLISHED_JSON_SCHEMAS,
  PUBLISHED_SCHEMA_DIRECTORY,
  renderPublishedJsonSchema,
} from './published-json-schemas'

async function readIfPresent(filePath: string) {
  try {
    return await readFile(filePath, 'utf8')
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null
    throw error
  }
}

export async function stalePublishedJsonSchemas(root: string) {
  const stale: string[] = []
  for (const schema of PUBLISHED_JSON_SCHEMAS) {
    const filePath = path.join(root, PUBLISHED_SCHEMA_DIRECTORY, schema.fileName)
    if ((await readIfPresent(filePath)) !== renderPublishedJsonSchema(schema.build())) {
      stale.push(path.relative(root, filePath))
    }
  }
  return stale
}

async function main() {
  const root = process.cwd()
  for (const schema of PUBLISHED_JSON_SCHEMAS) {
    const filePath = path.join(root, PUBLISHED_SCHEMA_DIRECTORY, schema.fileName)
    await writeFile(filePath, renderPublishedJsonSchema(schema.build()), 'utf8')
    process.stdout.write(`Wrote ${path.relative(root, filePath)}\n`)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main()
}
