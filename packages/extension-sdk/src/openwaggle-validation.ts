import * as Schema from 'effect/Schema'
import { OPENWAGGLE_EXTENSION_BROKER } from './constants.js'
const { CAPABILITY, METHOD, SETTING_KEY, STATE_SELECTOR } = OPENWAGGLE_EXTENSION_BROKER

const nonEmptyString = Schema.String.pipe(
  Schema.filter((value) => value.trim().length > 0 || 'Must not be empty.'),
)

const invokeScopeSchema = Schema.Union(
  Schema.Struct({ kind: Schema.Literal('app') }),
  Schema.Struct({ kind: Schema.Literal('project'), projectPath: nonEmptyString }),
  Schema.Struct({
    kind: Schema.Literal('session'),
    projectPath: nonEmptyString,
    sessionId: nonEmptyString,
  }),
  Schema.Struct({
    kind: Schema.Literal('branch'),
    projectPath: nonEmptyString,
    sessionId: nonEmptyString,
    branchId: nonEmptyString,
  }),
)

const modelPreferencesSchema = Schema.Struct({
  selectedModel: Schema.String,
  favoriteModels: Schema.Array(Schema.String),
  enabledModels: Schema.Array(Schema.String),
  thinkingLevel: Schema.String,
})

const projectViewSchema = Schema.Struct({
  projectPath: nonEmptyString,
  displayName: Schema.NullOr(Schema.String),
  active: Schema.Boolean,
})

const sessionViewSchema = Schema.Struct({
  sessionId: nonEmptyString,
  title: nonEmptyString,
  projectPath: Schema.NullOr(Schema.String),
})

const branchViewSchema = Schema.Struct({
  branchId: nonEmptyString,
  sessionId: nonEmptyString,
  name: nonEmptyString,
  main: Schema.Boolean,
  archived: Schema.Boolean,
})

const sessionResourceViewSchema = Schema.Struct({
  id: nonEmptyString,
  title: nonEmptyString,
  kind: Schema.Literal(
    'image',
    'file',
    'link',
    'tool',
    'web-search',
    'site',
    'commit',
    'change-request',
  ),
  mimeType: Schema.NullOr(Schema.String),
  available: Schema.Boolean,
  isSource: Schema.Boolean,
  isOutput: Schema.Boolean,
})

/** The fields every OpenWaggle broker result carries, for one capability and method. */
function resultBase<TCapability extends string, TMethod extends string>(
  capability: TCapability,
  method: TMethod,
) {
  return {
    extensionId: nonEmptyString,
    contributionId: nonEmptyString,
    capability: Schema.Literal(capability),
    method: Schema.Literal(method),
  }
}

export const sessionResourcesListResultSchema = Schema.Struct({
  ...resultBase(CAPABILITY.RESOURCES, METHOD.LIST_RESOURCES),
  sessionId: nonEmptyString,
  resources: Schema.Array(sessionResourceViewSchema),
  total: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
  nextCursor: Schema.NullOr(Schema.String),
})

export const sessionResourcePublishResultSchema = Schema.Struct({
  ...resultBase(CAPABILITY.RESOURCES, METHOD.PUBLISH_RESOURCE),
  sessionId: nonEmptyString,
  resource: sessionResourceViewSchema,
})

export const stateReadResultSchema = Schema.Struct({
  ...resultBase(CAPABILITY.STATE, METHOD.GET_STATE),
  scope: invokeScopeSchema,
  activeProjectPath: Schema.NullOr(Schema.String),
  currentProject: Schema.NullOr(projectViewSchema),
  currentSession: Schema.NullOr(sessionViewSchema),
  currentBranch: Schema.NullOr(branchViewSchema),
  recentProjects: Schema.Array(Schema.String),
  modelPreferences: modelPreferencesSchema,
})

function selectedStateResult<TSelector extends string, TValue, TEncoded>(
  selector: TSelector,
  value: Schema.Schema<TValue, TEncoded>,
) {
  return Schema.Struct({
    ...resultBase(CAPABILITY.STATE, METHOD.READ_STATE),
    scope: invokeScopeSchema,
    selector: Schema.Literal(selector),
    value,
  })
}

export const actionSelectProjectResultSchema = Schema.Struct({
  ...resultBase(CAPABILITY.ACTIONS, METHOD.SELECT_PROJECT),
  previousProjectPath: Schema.NullOr(Schema.String),
  projectPath: nonEmptyString,
  recentProjects: Schema.Array(Schema.String),
})

const settingsViewSchema = Schema.Struct({
  modelPreferences: modelPreferencesSchema,
  projectDisplayNames: Schema.Record({ key: Schema.String, value: Schema.String }),
})

const settingsSelectedValueSchema = Schema.Union(
  Schema.Struct({
    key: Schema.Literal(SETTING_KEY.MODEL_PREFERENCES),
    value: modelPreferencesSchema,
  }),
  Schema.Struct({
    key: Schema.Literal(SETTING_KEY.PROJECT_DISPLAY_NAME),
    projectPath: nonEmptyString,
    value: Schema.NullOr(Schema.String),
  }),
)

export const stateCurrentProjectReadResultSchema = selectedStateResult(
  STATE_SELECTOR.CURRENT_PROJECT,
  Schema.NullOr(projectViewSchema),
)

export const stateCurrentSessionReadResultSchema = selectedStateResult(
  STATE_SELECTOR.CURRENT_SESSION,
  Schema.NullOr(sessionViewSchema),
)

export const stateCurrentBranchReadResultSchema = selectedStateResult(
  STATE_SELECTOR.CURRENT_BRANCH,
  Schema.NullOr(branchViewSchema),
)

export const stateRecentProjectsReadResultSchema = selectedStateResult(
  STATE_SELECTOR.RECENT_PROJECTS,
  Schema.Array(Schema.String),
)

export const stateModelPreferencesReadResultSchema = selectedStateResult(
  STATE_SELECTOR.MODEL_PREFERENCES,
  modelPreferencesSchema,
)

export const settingsGetResultSchema = Schema.Struct({
  ...resultBase(CAPABILITY.SETTINGS, METHOD.GET_SETTINGS),
  settings: settingsViewSchema,
})

export const settingsUpdateResultSchema = Schema.Struct({
  ...resultBase(CAPABILITY.SETTINGS, METHOD.UPDATE_SETTINGS),
  settings: settingsViewSchema,
})

export const settingsGetSettingResultSchema = Schema.Struct({
  ...resultBase(CAPABILITY.SETTINGS, METHOD.GET_SETTING),
  setting: settingsSelectedValueSchema,
})

export const settingsUpdateSettingResultSchema = Schema.Struct({
  ...resultBase(CAPABILITY.SETTINGS, METHOD.UPDATE_SETTING),
  setting: settingsSelectedValueSchema,
})
