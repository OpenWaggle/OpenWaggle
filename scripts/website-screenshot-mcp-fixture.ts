import fs from 'node:fs/promises'
import path from 'node:path'

/** Folder under the scratch HOME holding the fixture servers; `cwd` in the config names it. */
const FIXTURE_FOLDER = 'mcp-fixtures'
export const MCP_CONNECTED_SERVER = 'release-notes'
export const MCP_FAILING_SERVER = 'issue-tracker'
export const MCP_SECRET_SERVER = 'deploy-status'
const MCP_MISSING_SECRET = 'DEPLOY_STATUS_AUTHORIZATION'
const JSON_INDENT = 2

/**
 * A complete stdio MCP server in one file, with no dependencies: newline-delimited JSON-RPC that
 * answers `initialize`, `tools/list` and `tools/call`, so Check connection lists real tools.
 */
const RELEASE_NOTES_SERVER = `import { createInterface } from 'node:readline'

const tools = [
  {
    name: 'list_releases',
    description: 'List published releases, newest first.',
    inputSchema: { type: 'object', properties: { limit: { type: 'number' } } },
  },
  {
    name: 'get_release_notes',
    description: 'Read the notes of one release by its version.',
    inputSchema: {
      type: 'object',
      properties: { version: { type: 'string' } },
      required: ['version'],
    },
  },
  {
    name: 'draft_release_notes',
    description: 'Draft notes for the next release from merged pull requests.',
    inputSchema: { type: 'object', properties: { since: { type: 'string' } } },
  },
]

function send(message) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\\n')
}

createInterface({ input: process.stdin }).on('line', (line) => {
  if (line.trim() === '') return
  const request = JSON.parse(line)
  if (request.id === undefined) return
  if (request.method === 'initialize') {
    send({
      id: request.id,
      result: {
        protocolVersion: request.params?.protocolVersion ?? '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'release-notes', version: '1.0.0' },
      },
    })
  } else if (request.method === 'tools/list') {
    send({ id: request.id, result: { tools } })
  } else if (request.method === 'tools/call') {
    send({ id: request.id, result: { content: [{ type: 'text', text: 'v1.0.0: first stable release.' }] } })
  } else {
    send({ id: request.id, error: { code: -32601, message: 'Method not found' } })
  }
})
`

/** A server that cannot start: it prints why on stderr and exits, as a misconfigured one does. */
const ISSUE_TRACKER_SERVER = `console.error('issue-tracker MCP 0.4.2')
console.error('Reading configuration from ~/.config/issue-tracker/config.toml')
console.error('Error: ISSUE_TRACKER_URL is not set. Add it to the server env in mcp.json.')
process.exit(1)
`

/**
 * OpenWaggle's global MCP file in the scratch HOME: a local server that connects, one that
 * fails, and a remote one whose Authorization header reads a vault secret nobody saved.
 */
export async function writeMcpFixture(homeDir: string) {
  const folder = path.join(homeDir, FIXTURE_FOLDER)
  await fs.mkdir(folder, { recursive: true })
  await fs.writeFile(path.join(folder, 'release-notes-mcp.mjs'), RELEASE_NOTES_SERVER, 'utf8')
  await fs.writeFile(path.join(folder, 'issue-tracker-mcp.mjs'), ISSUE_TRACKER_SERVER, 'utf8')
  const config = {
    mcpServers: {
      [MCP_CONNECTED_SERVER]: {
        command: 'node',
        args: ['release-notes-mcp.mjs'],
        cwd: `~/${FIXTURE_FOLDER}`,
        description: "Read and draft the project's release notes",
      },
      [MCP_FAILING_SERVER]: {
        command: 'node',
        args: ['issue-tracker-mcp.mjs'],
        cwd: `~/${FIXTURE_FOLDER}`,
      },
      [MCP_SECRET_SERVER]: {
        url: 'https://deploy.example.com/mcp',
        headers: { Authorization: { secret: MCP_MISSING_SECRET } },
      },
    },
  }
  const openWaggleDir = path.join(homeDir, '.openwaggle')
  await fs.mkdir(openWaggleDir, { recursive: true })
  await fs.writeFile(
    path.join(openWaggleDir, 'mcp.json'),
    `${JSON.stringify(config, null, JSON_INDENT)}\n`,
    'utf8',
  )
}
