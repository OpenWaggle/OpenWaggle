/**
 * Writes the published JSON Schemas to `website/public/schemas/`, or with `--check` lists the
 * files that differ from what the runtime schemas generate and exits non-zero.
 */
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  PUBLISHED_JSON_SCHEMAS,
  PUBLISHED_SCHEMA_DIRECTORY,
  renderPublishedJsonSchema,
} from './published-json-schemas'

const ARGUMENT_START_INDEX = 2
const FAILURE_EXIT_CODE = 1

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

async function main(args: readonly string[]) {
  const root = process.cwd()
  if (args.includes('--check')) {
    const stale = await stalePublishedJsonSchemas(root)
    if (stale.length === 0) return
    process.stderr.write(
      `Published JSON Schemas are out of date. Run pnpm website:schemas.\n${stale.join('\n')}\n`,
    )
    process.exitCode = FAILURE_EXIT_CODE
    return
  }
  for (const schema of PUBLISHED_JSON_SCHEMAS) {
    const filePath = path.join(root, PUBLISHED_SCHEMA_DIRECTORY, schema.fileName)
    await writeFile(filePath, renderPublishedJsonSchema(schema.build()), 'utf8')
    process.stdout.write(`Wrote ${path.relative(root, filePath)}\n`)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main(process.argv.slice(ARGUMENT_START_INDEX))
}
