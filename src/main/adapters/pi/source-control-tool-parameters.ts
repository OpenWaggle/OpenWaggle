import { type Static, type TSchema, Type } from 'typebox'
import { Check, Errors } from 'typebox/value'

const MAX_HOST_LENGTH = 512
const MAX_LOGIN_LENGTH = 512

const host = Type.String({
  minLength: 1,
  maxLength: MAX_HOST_LENGTH,
  description: 'Hostname from the git remote, e.g. "git.acme.io". No scheme, user, or path.',
})
const provider = Type.Union([Type.Literal('github'), Type.Literal('gitlab'), Type.Null()], {
  description: 'Which software the host runs. null forgets the choice.',
})
const hostChoice = Type.Union(
  [Type.Literal('github'), Type.Literal('gitlab'), Type.Literal('unsupported'), Type.Null()],
  {
    description:
      'Which software the host runs; "unsupported" when it is neither GitHub nor GitLab, so OpenWaggle stops asking. null forgets the choice. "unsupported" is only valid for set-host-provider.',
  },
)
const scope = Type.Union(
  [Type.Literal('user'), Type.Literal('project-local'), Type.Literal('project-shared')],
  {
    description:
      '"user": the user\'s default for every project. "project-local": this project, only on this machine. "project-shared": this project for everyone, written to .openwaggle/settings.json in the Session\'s working tree.',
  },
)
const destination = Type.Union([Type.Literal('inspector'), Type.Literal('website'), Type.Null()], {
  description:
    'Where opening a change request goes: "inspector" (in OpenWaggle) or "website" (the provider\'s page). null clears the override at that scope.',
})
const login = Type.Union(
  [Type.String({ minLength: 1, maxLength: MAX_LOGIN_LENGTH }), Type.Null()],
  {
    description:
      'A signed-in Provider account login from status "accounts". null returns to automatic choice.',
  },
)

const configure = Type.Literal('configure')
const parameterVariants = [
  Type.Object({ action: Type.Literal('status') }),
  Type.Object({
    action: configure,
    change: Type.Literal('set-host-provider'),
    host,
    provider: hostChoice,
  }),
  Type.Object({ action: configure, change: Type.Literal('declare-project-host'), host, provider }),
  Type.Object({
    action: configure,
    change: Type.Literal('set-open-destination'),
    scope,
    destination,
  }),
  Type.Object({ action: configure, change: Type.Literal('set-repository-account'), login }),
] as const

export type SourceControlToolParameters = Static<(typeof parameterVariants)[number]>
export type SourceControlChangeParameters = Extract<
  SourceControlToolParameters,
  { action: 'configure' }
>

// Providers that emit `{}` for a root-level anyOf get one object; each variant is checked below.
export const sourceControlToolParameters = Type.Unsafe<SourceControlToolParameters>({
  type: 'object',
  properties: {
    action: Type.Union([Type.Literal('status'), configure], {
      description:
        '"status" diagnoses source control (read-only). "configure" applies exactly one change and asks the user to authorize it.',
    }),
    change: Type.Optional(
      Type.Union(
        parameterVariants.flatMap((variant) =>
          'change' in variant.properties ? [variant.properties.change] : [],
        ),
        {
          description:
            'Required for configure. "set-host-provider" (host, provider): the user\'s own choice for every project. "declare-project-host" (host, provider): shared with everyone on this project. "set-open-destination" (scope, destination). "set-repository-account" (login): account for this Session\'s repository.',
        },
      ),
    ),
    host: Type.Optional(host),
    provider: Type.Optional(hostChoice),
    scope: Type.Optional(scope),
    destination: Type.Optional(destination),
    login: Type.Optional(login),
  },
  required: ['action'],
})

function errorDetails(schema: TSchema, value: unknown) {
  return [...Errors(schema, value)]
    .map((error) => `${error.instancePath || 'arguments'}: ${error.message}`)
    .join('; ')
}

export function assertSourceControlArguments(
  params: unknown,
): asserts params is SourceControlToolParameters {
  if (!Check(sourceControlToolParameters, params)) {
    throw new Error(
      `Invalid source_control arguments: ${errorDetails(sourceControlToolParameters, params)}`,
    )
  }
  const { action } = params
  const change = 'change' in params ? params.change : undefined
  if (action === 'configure' && change === undefined) {
    throw new Error('Invalid source_control arguments: configure requires "change".')
  }
  const variant = parameterVariants.find(
    (candidate) =>
      candidate.properties.action.const === action &&
      (!('change' in candidate.properties) || candidate.properties.change.const === change),
  )
  if (variant === undefined) throw new Error(`Unknown source_control action "${action}".`)
  if (Check(variant, params)) return
  const label = change ?? action
  throw new Error(
    `Invalid source_control arguments for "${label}": ${errorDetails(variant, params)}`,
  )
}
