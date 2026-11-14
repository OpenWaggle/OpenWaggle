/**
 * The JSON Schemas published under `website/public/schemas/` for files whose format OpenWaggle
 * owns: project files and the extension package manifest. Each is generated from the schema the runtime parses the file with;
 * `bun run website:schemas` writes them and `published-json-schemas.unit.test.ts` fails when a
 * committed file drifts from what this module generates.
 */
import {
  PROJECT_ACTIONS_SCHEMA_FILE,
  projectActionsJsonSchema,
} from './published-json-schemas-actions'
import type { JsonSchemaNode } from './published-json-schemas-effect'
import {
  EXTENSION_MANIFEST_SCHEMA_FILE,
  extensionManifestJsonSchema,
} from './published-json-schemas-extension-manifest'
import { MCP_SCHEMA_FILE, mcpConfigJsonSchema } from './published-json-schemas-mcp'
import {
  PROJECT_SETTINGS_SCHEMA_FILE,
  projectSettingsJsonSchema,
} from './published-json-schemas-settings'
import {
  WAGGLE_PRESETS_SCHEMA_FILE,
  wagglePresetsJsonSchema,
} from './published-json-schemas-waggle'

interface PublishedJsonSchema {
  /** File name under `website/public/schemas/`. */
  readonly fileName: string
  readonly build: () => JsonSchemaNode
}

export const PUBLISHED_SCHEMA_DIRECTORY = 'website/public/schemas'
const JSON_INDENT_SPACES = 2

export const PUBLISHED_JSON_SCHEMAS: readonly PublishedJsonSchema[] = [
  { fileName: PROJECT_ACTIONS_SCHEMA_FILE, build: projectActionsJsonSchema },
  { fileName: PROJECT_SETTINGS_SCHEMA_FILE, build: projectSettingsJsonSchema },
  { fileName: MCP_SCHEMA_FILE, build: mcpConfigJsonSchema },
  { fileName: WAGGLE_PRESETS_SCHEMA_FILE, build: wagglePresetsJsonSchema },
  { fileName: EXTENSION_MANIFEST_SCHEMA_FILE, build: extensionManifestJsonSchema },
]

export function renderPublishedJsonSchema(schema: JsonSchemaNode) {
  return `${JSON.stringify(schema, null, JSON_INDENT_SPACES)}\n`
}
