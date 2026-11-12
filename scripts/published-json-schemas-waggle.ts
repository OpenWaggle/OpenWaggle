import { wagglePresetSchema } from '@shared/schemas/waggle'
import { Schema } from 'effect'
import {
  type JsonSchemaNode,
  type JsonSchemaOverlay,
  jsonSchemaFromEffect,
  publishedSchemaRoot,
} from './published-json-schemas-effect'

const PRESET = '/properties/wagglePresets/items'
const AGENT_SLOT_DESCRIPTIONS = {
  label: { description: 'Name shown on the agent’s turns.' },
  model: {
    // `$inherit`, or `provider/model` with no space at either end and text on both sides of `/`.
    pattern: '^(?:\\$inherit|(?=\\S)(?![\\s\\S]*\\s$)[^/]+/[\\s\\S]+)$',
    description: '$inherit for the session model, or a provider/model id.',
  },
  roleDescription: { description: 'The agent’s role, given to it as instructions.' },
  color: { description: 'Color of the agent’s turns.' },
}

function agentSlotOverlay(index: number): JsonSchemaOverlay {
  const slot = `${PRESET}/properties/config/properties/agents/prefixItems/${String(index)}`
  return Object.fromEntries(
    Object.entries(AGENT_SLOT_DESCRIPTIONS).map(([field, patch]) => [
      `${slot}/properties/${field}`,
      patch,
    ]),
  )
}

/** The file around the presets, as `@openwaggle/pi-waggle` reads and writes it. */
function wagglePresetsFileSchema() {
  return Schema.Struct({
    wagglePresets: Schema.optionalWith(Schema.Array(wagglePresetSchema), { exact: true }),
    hiddenBuiltInPresetIds: Schema.optionalWith(
      Schema.Array(Schema.String.pipe(Schema.minLength(1))),
      { exact: true },
    ),
  })
}

const WAGGLE_OVERLAY: JsonSchemaOverlay = {
  '/properties/wagglePresets': {
    description:
      'Saved presets. A preset with the id of a built-in one, or of one in the user file, replaces it. Presets that do not match this schema are skipped.',
  },
  [`${PRESET}/properties/id`]: { description: 'Stable identifier.' },
  [`${PRESET}/properties/name`]: { description: 'Name shown in the / menu and in Settings.' },
  [`${PRESET}/properties/description`]: { description: 'What the preset is for.' },
  [`${PRESET}/properties/config/properties/mode`]: {
    description: 'How the agents work. Only sequential turns exist.',
  },
  [`${PRESET}/properties/config/properties/agents`]: {
    description: 'Agent A and Agent B, in turn order.',
  },
  ...agentSlotOverlay(0),
  ...agentSlotOverlay(1),
  [`${PRESET}/properties/config/properties/stop/properties/primary`]: {
    description:
      'consensus: stop when the agents agree (Consensus). user-stop: run until you stop it (Manual).',
  },
  [`${PRESET}/properties/config/properties/stop/properties/maxTurnsSafety`]: {
    description: 'Turn limit, a safety cap in either mode. The Settings slider offers 4 to 20.',
  },
  [`${PRESET}/properties/isBuiltIn`]: {
    description: 'false for your presets. OpenWaggle saves every preset with false.',
  },
  [`${PRESET}/properties/createdAt`]: {
    minimum: 0,
    description: 'Creation time, in milliseconds since 1970.',
  },
  [`${PRESET}/properties/updatedAt`]: {
    minimum: 0,
    description: 'Last change, in milliseconds since 1970.',
  },
  '/properties/hiddenBuiltInPresetIds': { description: 'Ids of built-in presets to hide.' },
}

export const WAGGLE_PRESETS_SCHEMA_FILE = 'waggle-presets.schema.json'

/** The Waggle presets file, from the schema the app keeps each preset with. */
export function wagglePresetsJsonSchema(): JsonSchemaNode {
  return publishedSchemaRoot(
    {
      fileName: WAGGLE_PRESETS_SCHEMA_FILE,
      title: 'OpenWaggle Waggle presets',
      description:
        'Waggle presets in <project>/.pi/waggle-presets.json or ~/.pi/agent/waggle-presets.json. Settings > Waggle Mode writes this file.',
    },
    jsonSchemaFromEffect(wagglePresetsFileSchema(), WAGGLE_OVERLAY),
  )
}
