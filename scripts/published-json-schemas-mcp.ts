/**
 * JSON Schema for OpenWaggle's `mcp.json` files (`~/.openwaggle/mcp.json` and
 * `<project>/.openwaggle/mcp.json`).
 *
 * The runtime does not validate these files with Effect Schema: `validateMcpServerEntry` mirrors
 * Pi's hand-written checks so every file Pi reads means the same thing in OpenWaggle. This schema
 * is therefore built from the same constants, and `published-json-schemas-mcp-waggle.unit.test.ts` checks it
 * against `validateMcpServerEntry` and `mergeMcpConfigLayers` on a corpus of entries.
 */
import {
  MCP_EXPOSURES,
  MCP_OVERRIDE_KEYS,
  MCP_SERVER_NAME,
} from '../src/main/domain/mcp/config/mcp-server-config'
import { publishedSchemaRoot } from './published-json-schemas-effect'

const MIN_PORT = 1
const MAX_PORT = 65_535
/** Accepted for older files and read as `codemode`, as in Pi. */
const LEGACY_EXPOSURES = ['codemode-deferred'] as const

const exposure = {
  enum: [...MCP_EXPOSURES, ...LEGACY_EXPOSURES],
  description:
    'How the tools reach the agent. codemode (default): from scripts. deferred: the agent searches for them, then calls them. direct: offered on every message; OpenWaggle runs it as codemode. hidden: not usable. codemode-deferred is an older name for codemode.',
}

const secretReference = {
  type: 'object',
  required: ['secret'],
  properties: {
    secret: {
      type: 'string',
      minLength: 1,
      description:
        'Name of a secret saved in Settings > MCP > Secrets. It replaces the whole value.',
    },
  },
  additionalProperties: false,
}

function valueMap(description: string) {
  return {
    type: 'object',
    description,
    additionalProperties: {
      anyOf: [
        {
          type: 'string',
          description:
            '${NAME} or $NAME reads an environment variable from your login shell; a value starting with ! runs a command; $$ is a literal $.',
        },
        secretReference,
      ],
    },
  }
}

const baseProperties = {
  enabled: { type: 'boolean', description: 'false keeps the server without connecting to it.' },
  description: { type: 'string', description: 'What the server is for, shown to the agent.' },
  timeout: {
    type: 'number',
    exclusiveMinimum: 0,
    description: 'How long a request may take, in seconds. Default 60.',
  },
  exposure,
  toolExposure: {
    type: 'object',
    description:
      'Exposure for single tools, by tool name. * matches any characters; an exact name wins over a pattern.',
    additionalProperties: exposure,
  },
}

const stdioServer = {
  type: 'object',
  description:
    'A local server OpenWaggle starts as a program. The command is not run through a shell.',
  required: ['command'],
  properties: {
    type: { const: 'stdio' },
    command: { type: 'string', description: 'The program to start, such as npx.' },
    args: {
      type: 'array',
      items: { type: 'string' },
      description: 'Arguments for the program, used as written.',
    },
    env: valueMap('Environment variables for the server process.'),
    cwd: { type: 'string', description: 'Working folder for the server process.' },
    ...baseProperties,
  },
  additionalProperties: false,
}

const oauth = {
  type: 'object',
  description: "OAuth options, as in Pi's MCP documentation. Most servers need none.",
  properties: {
    clientId: { type: 'string', description: 'A registered OAuth client id.' },
    clientSecret: {
      type: 'string',
      description: 'The client secret. ${NAME} reads an environment variable.',
    },
    callbackPort: {
      type: 'integer',
      minimum: MIN_PORT,
      maximum: MAX_PORT,
      description: 'A fixed port for the sign-in callback.',
    },
    callbackUrl: {
      type: 'string',
      pattern: '^http://(localhost|127\\.0\\.0\\.1|\\[::1\\])(:\\d+)?(/[^?#]*)?$',
      description: 'The sign-in callback: http on localhost, 127.0.0.1, or [::1], without a query.',
    },
    scope: { type: 'string', description: 'Scopes to request.' },
    clientName: { type: 'string', pattern: '\\S', description: 'Client name to register.' },
    clientRegistration: {
      enum: ['dcr', 'cimd'],
      description:
        'dcr: dynamic client registration (default). cimd: a client ID metadata document; it cannot be combined with clientId or clientName.',
    },
    authServerMetadataUrl: {
      type: 'string',
      pattern: '^(https://|http://(localhost|127\\.0\\.0\\.1|\\[::1\\])([:/]|$))',
      description: 'Authorization server metadata URL: https, or http on a loopback host.',
    },
  },
  additionalProperties: false,
}

const remoteServer = {
  type: 'object',
  description: 'A remote server reached at a URL.',
  required: ['url'],
  properties: {
    type: {
      enum: ['http', 'streamable-http', 'sse', 'websocket'],
      description:
        'Leave out for streamable HTTP, or for WebSocket with a ws:// or wss:// URL. sse is for older servers that only offer Server-Sent Events.',
    },
    url: {
      type: 'string',
      pattern: '^(https?|wss?)://',
      description: 'The server address, used as written.',
    },
    headers: valueMap('HTTP headers sent with each request.'),
    oauth,
    auth: {
      type: 'object',
      description:
        'Sign in through a model provider instead of OAuth. Only allowed in ~/.openwaggle/mcp.json, and the URL must be https or http on a loopback host.',
      required: ['provider'],
      properties: { provider: { type: 'string', minLength: 1 } },
      additionalProperties: false,
    },
    ...baseProperties,
  },
  additionalProperties: false,
  allOf: [
    {
      if: {
        required: ['type'],
        properties: { type: { enum: ['http', 'streamable-http', 'sse'] } },
      },
      then: { properties: { url: { pattern: '^https?://' } } },
    },
    {
      if: { required: ['type'], properties: { type: { const: 'websocket' } } },
      then: { properties: { url: { pattern: '^wss?://' } } },
    },
  ],
}

const overrideEntry = {
  type: 'object',
  description:
    'Changes a server an earlier file defines, such as a global server in one project, and keeps the rest of it.',
  properties: Object.fromEntries(MCP_OVERRIDE_KEYS.map((key) => [key, baseProperties[key]])),
  additionalProperties: false,
}

export const MCP_SCHEMA_FILE = 'mcp.schema.json'

export function mcpConfigJsonSchema() {
  return publishedSchemaRoot(
    {
      fileName: MCP_SCHEMA_FILE,
      title: 'OpenWaggle mcp.json',
      description:
        "MCP servers in OpenWaggle's files, ~/.openwaggle/mcp.json and <project>/.openwaggle/mcp.json. Pi's format, plus SSE and WebSocket servers and secret references, which only these files may hold.",
    },
    {
      type: 'object',
      properties: {
        $schema: { type: 'string', description: 'The JSON Schema for this file.' },
        mcpServers: {
          type: 'object',
          description: 'Servers by name. Names that differ only in - and _ count as the same name.',
          propertyNames: { pattern: MCP_SERVER_NAME.source },
          additionalProperties: { $ref: '#/$defs/server' },
        },
        autoEnableCodemode: {
          type: 'boolean',
          description: 'false stops MCP servers from turning codemode on.',
        },
      },
      $defs: {
        server: {
          anyOf: [
            { $ref: '#/$defs/stdio' },
            { $ref: '#/$defs/remote' },
            { $ref: '#/$defs/override' },
          ],
        },
        stdio: stdioServer,
        remote: remoteServer,
        override: overrideEntry,
      },
    },
  )
}
