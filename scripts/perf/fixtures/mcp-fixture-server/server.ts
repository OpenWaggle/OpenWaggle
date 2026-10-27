#!/usr/bin/env node
/**
 * A dependency-free MCP server over stdio (newline-delimited JSON-RPC 2.0) for performance
 * measurements. It stands in for hosted MCP servers (Atlassian, Figma, Datadog) whose real
 * processes need accounts; its tool count and schema sizes match the servers it replaces.
 * Node runs it directly (type stripping), so it uses only erasable TypeScript and Node built-ins.
 *
 *   node server.ts <toolset>        toolset: atlassian | figma | datadog | generic
 */
import { createInterface } from 'node:readline'

interface Toolset {
  readonly count: number
  readonly descriptionChars: number
  readonly properties: number
}

const TOOLSETS: Readonly<Record<string, Toolset>> = {
  atlassian: { count: 32, descriptionChars: 220, properties: 4 },
  figma: { count: 2, descriptionChars: 1_400, properties: 6 },
  datadog: { count: 20, descriptionChars: 260, properties: 3 },
  generic: { count: 8, descriptionChars: 200, properties: 3 },
}
const GENERIC_TOOLSET: Toolset = { count: 8, descriptionChars: 200, properties: 3 }
const FILLER = 'Returns the matching records with their identifiers, owners, status and timestamps. '
const NAME_PAD = 2
const METHOD_NOT_FOUND = -32_601
const PARSE_ERROR = -32_700
const DEFAULT_PROTOCOL_VERSION = '2025-06-18'
const TOOLSET_ARGUMENT = 2

function toolsFor(name: string) {
  const set = TOOLSETS[name] ?? GENERIC_TOOLSET
  const description = FILLER.repeat(Math.ceil(set.descriptionChars / FILLER.length)).slice(0, set.descriptionChars)
  return Array.from({ length: set.count }, (_, index) => ({
    name: `${name}_operation_${String(index).padStart(NAME_PAD, '0')}`,
    description,
    inputSchema: {
      type: 'object',
      properties: Object.fromEntries(
        Array.from({ length: set.properties }, (_, property) => [
          `field${String(property)}`,
          { type: 'string', description: `Filter value ${String(property)} for the ${name} operation.` },
        ]),
      ),
      required: ['field0'],
    },
  }))
}

/** The `inventory` toolset answers from this table, so an evaluation can check the answer. */
const INVENTORY: Readonly<Record<string, { readonly units: number; readonly warehouse: string }>> = {
  'A-1042': { units: 17, warehouse: 'Lisbon' },
  'B-2001': { units: 64, warehouse: 'Porto' },
  'C-3003': { units: 5, warehouse: 'Faro' },
}
const INVENTORY_TOOLS = [
  {
    name: 'lookup_sku',
    description: 'Look up the stock of one SKU: units on hand and the warehouse that holds them.',
    inputSchema: {
      type: 'object',
      properties: { sku: { type: 'string', description: 'The SKU, for example A-1042.' } },
      required: ['sku'],
    },
  },
  {
    name: 'list_warehouses',
    description: 'List every warehouse name.',
    inputSchema: { type: 'object', properties: {} },
  },
]

const toolset = process.argv[TOOLSET_ARGUMENT] ?? 'generic'
const tools = toolset === 'inventory' ? [...INVENTORY_TOOLS, ...toolsFor('generic')] : toolsFor(toolset)

function inventoryResult(name: string | undefined, args: Record<string, unknown> | null) {
  if (name === 'list_warehouses') return [...new Set(Object.values(INVENTORY).map((entry) => entry.warehouse))].join(', ')
  const sku = stringField(args, 'sku') ?? ''
  const entry = INVENTORY[sku]
  return entry ? JSON.stringify({ sku, ...entry }) : `Unknown SKU ${sku}.`
}

function callResult(params: Record<string, unknown> | null) {
  const name = stringField(params, 'name')
  const args = params && isRecord(params.arguments) ? params.arguments : null
  const text = toolset === 'inventory' ? inventoryResult(name, args) : `${name ?? 'tool'}: ok`
  return { content: [{ type: 'text', text }] }
}

function write(message: object) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function stringField(record: Record<string, unknown> | null, key: string) {
  const value = record ? record[key] : undefined
  return typeof value === 'string' ? value : undefined
}

type Params = Record<string, unknown> | null

/** The result of each supported method; anything else is "method not found". */
const RESULTS: Readonly<Record<string, (params: Params) => object>> = {
  initialize: (params) => ({
    protocolVersion: stringField(params, 'protocolVersion') ?? DEFAULT_PROTOCOL_VERSION,
    capabilities: { tools: {} },
    serverInfo: { name: `perf-fixture-${toolset}`, version: '1.0.0' },
    instructions: `Fixture ${toolset} server for OpenWaggle performance measurements.`,
  }),
  'tools/list': () => ({ tools }),
  'tools/call': callResult,
  ping: () => ({}),
}

function handle(message: Record<string, unknown>) {
  const id = message.id
  if (id === undefined) return
  const method = stringField(message, 'method') ?? ''
  const result = RESULTS[method]
  if (!result) {
    write({ id, error: { code: METHOD_NOT_FOUND, message: `Method not found: ${method}` } })
    return
  }
  write({ id, result: result(isRecord(message.params) ? message.params : null) })
}

createInterface({ input: process.stdin }).on('line', (line: string) => {
  if (line.trim() === '') return
  try {
    const parsed: unknown = JSON.parse(line)
    if (isRecord(parsed)) handle(parsed)
  } catch {
    write({ id: null, error: { code: PARSE_ERROR, message: 'Parse error' } })
  }
})
