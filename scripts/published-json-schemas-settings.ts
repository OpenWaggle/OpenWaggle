import { projectSettingsFileSchema } from '@shared/schemas/validation'
import { SOURCE_CONTROL_PROVIDER_IDS } from '@shared/types/change-request'
import { CHANGE_REQUEST_OPEN_DESTINATIONS } from '@shared/types/source-control'
import { Schema } from 'effect'
import {
  type JsonSchemaNode,
  type JsonSchemaOverlay,
  jsonSchemaFromEffect,
  publishedSchemaRoot,
} from './published-json-schemas-effect'

/** Fields the runtime keeps as open JSON objects; JSON Schema needs no recursive definition. */
const openJsonObject = Schema.Record({ key: Schema.String, value: Schema.Unknown })
/** Top-level keys whose runtime schema is a recursive JSON object. */
export const SETTINGS_OPEN_OBJECT_KEYS = ['pi', 'sourceControl'] as const

function projectSettingsForJsonSchema() {
  return Schema.Struct(
    {
      ...projectSettingsFileSchema.fields,
      ...Object.fromEntries(
        SETTINGS_OPEN_OBJECT_KEYS.map((key) => [key, Schema.optional(openJsonObject)]),
      ),
    },
    ...projectSettingsFileSchema.records,
  )
}

const SETTINGS_OVERLAY: JsonSchemaOverlay = {
  '/properties/preferences': {
    description: 'Project preferences OpenWaggle writes from Settings.',
  },
  '/properties/preferences/properties/model': {
    deprecated: true,
    description:
      'No longer used. OpenWaggle moves it into its own storage the next time it writes this file.',
  },
  '/properties/preferences/properties/authorizationMode': {
    description:
      'Access mode for this project, set under Settings > Permissions > Selected project: yolo (YOLO) or ask-for-approval (Ask for Approval).',
  },
  '/properties/sessionHost': { description: 'Worker limits for this project.' },
  '/properties/sessionHost/properties/multiAgentEnabled': {
    description: 'Lets agents create Worker sessions to share work in this project.',
  },
  '/properties/sessionHost/properties/parentConcurrencyLimit': {
    type: 'integer',
    minimum: 1,
    maximum: Number.MAX_SAFE_INTEGER,
    description: 'Most direct Worker runs one parent session can have at the same time.',
  },
  '/properties/authorizationGrants': {
    description:
      'Saved approvals, written when you choose Always allow. Revoke them in Settings > Permissions.',
  },
  '/properties/pi': {
    description:
      "Pi settings for this project, with Pi's JSON setting names, such as compaction and branchSummary.",
  },
  '/properties/actions': {
    deprecated: true,
    description:
      'Older Project actions format, read only to migrate. Shared actions now live in .openwaggle/actions.json.',
  },
  '/properties/sourceControl': {
    description: 'Source control hosts and where change requests open.',
    properties: {
      hosts: {
        type: 'object',
        description: 'Provider by host name, such as "git.acme.io": "gitlab".',
        additionalProperties: { enum: [...SOURCE_CONTROL_PROVIDER_IDS] },
      },
      changeRequestOpenDestination: {
        // The values parseProjectSourceControlConfig keeps (project-source-control-config.ts).
        enum: [...CHANGE_REQUEST_OPEN_DESTINATIONS],
        description: 'Where a pull or merge request opens: in the app or on the website.',
      },
    },
  },
}

/** Lets a file name its schema with a `$schema` key, for a file whose parser keeps unknown keys. */
function withSchemaKeyProperty(schema: JsonSchemaNode): JsonSchemaNode {
  const { properties, ...rest } = schema
  if (typeof properties !== 'object' || properties === null || Array.isArray(properties)) {
    throw new Error('Expected an object schema with properties.')
  }
  return {
    ...rest,
    properties: {
      $schema: { type: 'string', description: 'The JSON Schema for this file.' },
      ...properties,
    },
  }
}

export const PROJECT_SETTINGS_SCHEMA_FILE = 'project-settings.schema.json'

/** `.openwaggle/settings.json`, from the schema `loadProjectConfig` decodes it with. */
export function projectSettingsJsonSchema(): JsonSchemaNode {
  return publishedSchemaRoot(
    {
      fileName: PROJECT_SETTINGS_SCHEMA_FILE,
      title: 'OpenWaggle .openwaggle/settings.json',
      description:
        'Project settings. Top-level keys belong to OpenWaggle; Pi settings go in the pi object.',
    },
    withSchemaKeyProperty(jsonSchemaFromEffect(projectSettingsForJsonSchema(), SETTINGS_OVERLAY)),
  )
}
