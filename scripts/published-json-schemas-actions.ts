import { actionManifestSchema } from '@shared/schemas/action-definitions'
import {
  type JsonSchemaNode,
  type JsonSchemaOverlay,
  jsonSchemaFromEffect,
  publishedSchemaRoot,
} from './published-json-schemas-effect'

/** Strings the runtime rejects when blank. JSON Schema cannot trim, so it asks for one non-space. */
const NON_BLANK = { pattern: '\\S' }

/**
 * A workspace-relative folder, as `actionRelativePathSchema` accepts it: `.`, or forward-slash
 * segments with no empty, `.`, or `..` segment, no leading `/`, and no `\` or `:`.
 */
const RELATIVE_PATH_PATTERN =
  '^(?:\\.|(?!\\.\\.?(?:/|$))[^/\\\\:\\u0000]+(?:/(?!\\.\\.?(?:/|$))[^/\\\\:\\u0000]+)*)$'

function invocationOverlay(pointer: string): JsonSchemaOverlay {
  const command = `${pointer}/anyOf/0`
  const task = `${pointer}/anyOf/1/properties/task`
  return {
    [pointer]: {
      description: 'What it runs: a command you typed (command) or a project script (task).',
    },
    [`${command}/properties/command`]: {
      ...NON_BLANK,
      description:
        'The command line, run by your shell. It receives OPENWAGGLE_PROJECT_ROOT and OPENWAGGLE_WORKTREE_PATH.',
    },
    [`${command}/properties/directory`]: {
      pattern: RELATIVE_PATH_PATTERN,
      description:
        'Working folder relative to the workspace root, with forward slashes. "." is the root.',
    },
    [task]: {
      description:
        'A script the project defines. It stays linked: later runs use the script as it is in the session workspace.',
    },
    [`${task}/properties/provider`]: {
      description:
        'package-script: a package.json script. hatch-script: a Hatch environment script. cargo-alias: a Cargo alias.',
    },
    [`${task}/properties/source`]: {
      pattern: RELATIVE_PATH_PATTERN,
      description:
        'The file that defines the script, relative to the workspace root, such as package.json or packages/web/package.json.',
    },
    [`${task}/properties/task`]: {
      ...NON_BLANK,
      description: 'The script or alias name, such as test.',
    },
    [`${task}/properties/directory`]: {
      pattern: RELATIVE_PATH_PATTERN,
      description:
        'Folder the script runs in, relative to the workspace root. For a package script, the folder of its package.json.',
    },
    [`${task}/properties/environment`]: {
      ...NON_BLANK,
      description: 'The Hatch environment of a hatch-script.',
    },
  }
}

const ID_DESCRIPTION =
  'Stable identifier: letters, digits, ".", "_", and "-", starting with a letter or digit.'
const ACTION = '/properties/actions/items'
const PREPARATION = '/properties/preparation/items'

const ACTIONS_OVERLAY: JsonSchemaOverlay = {
  '/properties/version': { description: 'File format version. Always 1.' },
  '/properties/actions': {
    description: 'Actions shown in the Project Actions panel. Each id must be different.',
  },
  [ACTION]: {
    allOf: [
      {
        if: { required: ['kind'], properties: { kind: { const: 'service' } } },
        then: { properties: { allowConcurrent: { const: false } } },
      },
    ],
  },
  [`${ACTION}/properties/id`]: { description: ID_DESCRIPTION },
  [`${ACTION}/properties/name`]: {
    ...NON_BLANK,
    description: 'Name shown in the panel. Give each action a different name.',
  },
  [`${ACTION}/properties/icon`]: { description: 'Icon shown beside the name.' },
  ...invocationOverlay(`${ACTION}/properties/invocation`),
  [`${ACTION}/properties/kind`]: {
    description:
      'task: finishes by itself, such as tests or a build (Stops when done). service: keeps running until stopped, such as a dev server (Keeps running).',
  },
  [`${ACTION}/properties/allowConcurrent`]: {
    description:
      'true starts another copy when you run it while it is still running. Must be false for a service.',
  },
  [`${ACTION}/properties/autoOpenPreview`]: {
    description: 'Open the browser preview when the server is ready.',
  },
  [`${ACTION}/properties/previewUrl`]: {
    description:
      'Address to preview instead of the one detected in the output. http or https, without a user name or password.',
  },
  [`${ACTION}/properties/shortcutRules`]: {
    description:
      'Keyboard shortcuts for the action, usually recorded in the action panel or Settings > Shortcuts. A project may have at most 256.',
  },
  [`${ACTION}/properties/shortcutRules/items/properties/when`]: {
    description: 'Condition for the binding, using context names with !, &&, ||, and parentheses.',
  },
  [`${ACTION}/properties/shortcutRules/items/properties/order`]: {
    description: 'Precedence among the project action shortcuts. A later order wins.',
  },
  '/properties/profiles': {
    description:
      'Setup profiles. The default profile, with id "default", exists without an entry here.',
  },
  '/properties/profiles/items/properties/id': { description: ID_DESCRIPTION },
  '/properties/profiles/items/properties/name': {
    ...NON_BLANK,
    description: 'Profile name shown when you create a worktree.',
  },
  '/properties/preparation': {
    description:
      'Setup and cleanup for managed worktrees: at most one of each per profile. A shared definition runs on a computer only after that person checks it and turns it on.',
  },
  [`${PREPARATION}/properties/id`]: { description: ID_DESCRIPTION },
  [`${PREPARATION}/properties/profileId`]: {
    description: 'The profile it belongs to: "default", or the id of an entry in profiles.',
  },
  [`${PREPARATION}/properties/phase`]: {
    description:
      'setup runs when a new managed worktree is created, before the first agent turn. cleanup runs before the worktree is removed.',
  },
  ...invocationOverlay(`${PREPARATION}/properties/invocation`),
}

export const PROJECT_ACTIONS_SCHEMA_FILE = 'project-actions-v1.schema.json'

/** `.openwaggle/actions.json`, from the schema `readActionManifest` decodes it with. */
export function projectActionsJsonSchema(): JsonSchemaNode {
  return publishedSchemaRoot(
    {
      fileName: PROJECT_ACTIONS_SCHEMA_FILE,
      title: 'OpenWaggle .openwaggle/actions.json',
      description:
        'Project actions and workspace preparation shared with everyone working on the project. Edit them in Settings > Project actions; OpenWaggle rejects a file with unknown keys.',
    },
    jsonSchemaFromEffect(actionManifestSchema, ACTIONS_OVERLAY),
  )
}
