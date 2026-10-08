import { Schema } from '@shared/schema'
import {
  CHANGE_REQUEST_OPEN_DESTINATIONS,
  SOURCE_CONTROL_PROJECT_DECLARATION_DECISIONS,
} from '@shared/types/source-control'

const MAX_HOST_LENGTH = 512
const MAX_PATH_LENGTH = 4096
const MAX_DECLARED_HOSTS = 100

const providerSchema = Schema.Literal('github', 'gitlab')
const hostSchema = Schema.String.pipe(Schema.minLength(1), Schema.maxLength(MAX_HOST_LENGTH))
const projectPathSchema = Schema.String.pipe(Schema.minLength(1), Schema.maxLength(MAX_PATH_LENGTH))

/** Runtime contract for `source-control:configure` and the agent's `configure` action. */
export const sourceControlConfigureRequestSchema = Schema.Union(
  Schema.Struct({
    kind: Schema.Literal('set-host-provider'),
    host: hostSchema,
    provider: Schema.NullOr(Schema.Literal('github', 'gitlab', 'unsupported')),
  }),
  Schema.Struct({
    kind: Schema.Literal('declare-project-host'),
    projectPath: projectPathSchema,
    workingPath: Schema.optional(projectPathSchema),
    host: hostSchema,
    provider: Schema.NullOr(providerSchema),
  }),
  Schema.Struct({
    kind: Schema.Literal('decide-project-declaration'),
    projectPath: projectPathSchema,
    decision: Schema.Literal(...SOURCE_CONTROL_PROJECT_DECLARATION_DECISIONS),
    hosts: Schema.Record({ key: hostSchema, value: providerSchema }).pipe(
      Schema.filter((hosts) => Object.keys(hosts).length <= MAX_DECLARED_HOSTS, {
        message: () => 'Too many declared hosts.',
      }),
    ),
  }),
  Schema.Struct({
    kind: Schema.Literal('set-open-destination'),
    scope: Schema.Literal('user', 'project-local', 'project-shared'),
    projectPath: Schema.optional(projectPathSchema),
    workingPath: Schema.optional(projectPathSchema),
    destination: Schema.NullOr(Schema.Literal(...CHANGE_REQUEST_OPEN_DESTINATIONS)),
  }),
  Schema.Struct({
    kind: Schema.Literal('set-repository-account'),
    repository: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(MAX_HOST_LENGTH)),
    login: Schema.NullOr(
      Schema.String.pipe(Schema.minLength(1), Schema.maxLength(MAX_HOST_LENGTH)),
    ),
  }),
)

const MAX_PATCH_ENTRIES = 100
const patchKeySchema = Schema.String.pipe(Schema.minLength(1), Schema.maxLength(MAX_HOST_LENGTH))

function patchRecord<V extends Schema.Schema.Any>(value: V) {
  return Schema.optional(
    Schema.Record({ key: patchKeySchema, value: Schema.NullOr(value) }).pipe(
      Schema.filter((record) => Object.keys(record).length <= MAX_PATCH_ENTRIES, {
        message: () => 'Too many source-control settings changes.',
      }),
    ),
  )
}

const destinationSchema = Schema.Literal(...CHANGE_REQUEST_OPEN_DESTINATIONS)

/** Runtime contract for `source-control:patch-settings`, the Host's atomic settings write. */
export const sourceControlSettingsPatchSchema = Schema.Struct({
  changeRequestOpenDestination: Schema.optional(Schema.NullOr(destinationSchema)),
  changeRequestOpenDestinationByProject: patchRecord(destinationSchema),
  sourceControlHostProviders: patchRecord(Schema.Literal('github', 'gitlab', 'unsupported')),
  sourceControlDetectedHostProviders: patchRecord(providerSchema),
  sourceControlRepositoryAccounts: patchRecord(hostSchema),
  sourceControlChangeRequestRepositories: patchRecord(patchKeySchema),
  sourceControlProjectDeclarations: patchRecord(
    Schema.Struct({
      approved: Schema.Record({ key: hostSchema, value: providerSchema }),
      declined: Schema.Record({ key: hostSchema, value: providerSchema }),
    }),
  ),
})

const cliSchema = Schema.Literal('gh', 'glab')
const textSchema = Schema.String.pipe(Schema.maxLength(MAX_PATH_LENGTH))

/** Runtime contract for a {@link SourceControlAttention} crossing the Host protocol. */
export const sourceControlAttentionSchema = Schema.Union(
  Schema.Struct({ kind: Schema.Literal('choose-provider'), host: hostSchema }),
  Schema.Struct({
    kind: Schema.Literal('approve-declaration'),
    projectPath: projectPathSchema,
    hosts: Schema.Record({ key: hostSchema, value: providerSchema }),
  }),
  Schema.Struct({
    kind: Schema.Literal('cli-missing'),
    provider: providerSchema,
    host: hostSchema,
    cli: cliSchema,
  }),
  Schema.Struct({
    kind: Schema.Literal('not-signed-in'),
    provider: providerSchema,
    host: hostSchema,
    cli: cliSchema,
    environmentTokenIgnored: Schema.Boolean,
    ignoredTokenVariables: Schema.Array(textSchema),
  }),
  Schema.Struct({
    kind: Schema.Literal('no-account-access'),
    provider: providerSchema,
    host: hostSchema,
    cli: cliSchema,
    repository: textSchema,
    accounts: Schema.Array(textSchema),
  }),
)
