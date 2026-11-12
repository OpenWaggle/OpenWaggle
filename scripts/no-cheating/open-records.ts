/**
 * New open-record types (`no-cheating/open-record`): `Record<string, unknown>`, a `[key: string]: unknown` index
 * signature, or `Schema.Record({ key: Schema.String, value: Schema.Unknown })` that a change added.
 * Outside data is decoded at the boundary with a schema from src/shared/schema into a declared
 * type and read with dot access (openwaggle/no-literal-key-lookup); a genuine map declares its
 * value type. The existing ones are left to the refactor that removes them; the gate only stops new
 * ones. Telling decoded data from an in-memory map would need type information and the data's
 * source, so every new open record is reported. A file is compared by how many it holds, so
 * reformatting or moving an existing one within the file adds none.
 */
import { addedLines } from './added-lines'
import type { Finding } from './findings'

const TYPESCRIPT_FILE = /\.(?:[cm]?tsx?|astro|vue|svelte)$/u
/** The check that names the patterns on purpose, and its tests. */
const EXEMPT_DIRECTORY = 'scripts/no-cheating/'
const OPEN_RECORD_TYPE =
  /\bRecord<\s*(?:string|PropertyKey)\s*,\s*(?:unknown|any)\s*>|\[\s*[\w$]+\s*:\s*string\s*\]\s*:\s*(?:unknown|any)\b/gu
const OPEN_RECORD_SCHEMA =
  /Schema\.Record\(\s*\{\s*key:\s*Schema\.String\s*,\s*value:\s*Schema\.(?:Unknown|Any)\s*,?\s*\}\s*\)/gu

const MESSAGE =
  'new open record type; decode outside data with a schema from src/shared/schema into a declared type, or declare the value type of a genuine map'

function lineAt(text: string, offset: number) {
  let line = 1
  for (let index = 0; index < offset; index += 1) if (text[index] === '\n') line += 1
  return line
}

function typeCount(text: string) {
  return [...text.matchAll(OPEN_RECORD_TYPE)].length
}

function schemaOffsets(text: string) {
  return [...text.matchAll(OPEN_RECORD_SCHEMA)].map((match) => match.index)
}

export function openRecordFindings(
  file: string,
  before: string | undefined,
  after: string | undefined,
): Finding[] {
  if (after === undefined || !TYPESCRIPT_FILE.test(file) || file.startsWith(EXEMPT_DIRECTORY)) {
    return []
  }
  const addedTypes = Math.max(0, typeCount(after) - typeCount(before ?? ''))
  const finding = (line: number): Finding => ({ file, line, id: 'open-record', message: MESSAGE })
  const types = addedLines(before, after)
    .filter((added) => typeCount(added.text) > 0)
    .slice(0, addedTypes)
    .map((added) => finding(added.line))
  const existingSchemas = schemaOffsets(before ?? '').length
  const schemas = schemaOffsets(after)
    .slice(existingSchemas)
    .map((offset) => finding(lineAt(after, offset)))
  return [...types, ...schemas]
}
