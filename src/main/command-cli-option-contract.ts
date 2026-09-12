import type { ParsedArguments } from './mcp-cli-arguments'

interface CommandCliOptionContractInput {
  readonly surface: string
  readonly route: string
  readonly arguments: ParsedArguments
  readonly optionsByRoute: Readonly<Record<string, readonly string[]>>
  readonly commonOptions?: readonly string[]
  readonly booleanOptions?: ReadonlySet<string>
  readonly argumentsByRoute?: Readonly<Record<string, CommandCliArgumentContract>>
}

export interface CommandCliArgumentContract {
  readonly minimum: number
  readonly maximum?: number
  readonly allowPassthrough?: boolean
}

function allKnownOptions(input: CommandCliOptionContractInput) {
  return new Set([...(input.commonOptions ?? []), ...Object.values(input.optionsByRoute).flat()])
}

function optionList(names: readonly string[]) {
  return names.map((name) => `--${name}`).join(', ')
}

/** Rejects ignored CLI input before a command can perform filesystem or Host side effects. */
export function validateCommandCliOptions(input: CommandCliOptionContractInput) {
  const specific = input.optionsByRoute[input.route]
  if (!specific) throw new Error(`Unsupported ${input.surface} command: ${input.route}.`)

  const common = input.commonOptions ?? []
  const allowed = new Set([...specific, ...common])
  const known = allKnownOptions(input)
  const provided = [...input.arguments.options.keys()]
  const unknown = provided.filter((name) => !known.has(name)).sort()
  if (unknown.length > 0) {
    throw new Error(
      `Unknown option${unknown.length === 1 ? '' : 's'} for ${input.surface}: ${optionList(unknown)}.`,
    )
  }

  const unsupported = provided.filter((name) => !allowed.has(name)).sort()
  if (unsupported.length > 0) {
    throw new Error(
      `Unsupported option${unsupported.length === 1 ? '' : 's'} for ${input.surface} ${input.route}: ${optionList(unsupported)}.`,
    )
  }

  const booleans = input.booleanOptions ?? new Set<string>()
  const missing = [...input.arguments.options.entries()]
    .flatMap(([name, values]) =>
      !booleans.has(name) && values.some((value) => value === 'true') ? [name] : [],
    )
    .sort()
  if (missing.length > 0) throw new Error(`Missing value for ${optionList(missing)}.`)

  const valuedBooleans = [...input.arguments.options.entries()]
    .flatMap(([name, values]) =>
      booleans.has(name) && values.some((value) => value !== 'true') ? [name] : [],
    )
    .sort()
  if (valuedBooleans.length > 0) {
    throw new Error(`${optionList(valuedBooleans)} do not accept values.`)
  }

  const argumentContract = input.argumentsByRoute?.[input.route]
  if (input.argumentsByRoute && !argumentContract) {
    throw new Error(`Unsupported ${input.surface} command: ${input.route}.`)
  }
  if (argumentContract) {
    validateCommandCliArguments(input.surface, input.route, input.arguments, argumentContract)
  }
}

/** Enforces positional and `--` operands before a command can perform side effects. */
export function validateCommandCliArguments(
  surface: string,
  route: string,
  arguments_: ParsedArguments,
  contract: CommandCliArgumentContract,
) {
  if (!contract.allowPassthrough && arguments_.passthrough.length > 0) {
    throw new Error(`${surface} ${route} does not accept arguments after --.`)
  }
  const count = arguments_.positionals.length
  if (count < contract.minimum) {
    throw new Error(`${surface} ${route} requires more positional arguments.`)
  }
  if (contract.maximum !== undefined && count > contract.maximum) {
    throw new Error(`${surface} ${route} received unexpected positional arguments.`)
  }
}

/** Implicit help is valid only for an empty invocation, never for ignored options or passthrough. */
export function validateImplicitCliHelp(surface: string, arguments_: ParsedArguments) {
  const options = [...arguments_.options.keys()].sort().map((name) => `--${name}`)
  const passthrough = arguments_.passthrough.length > 0 ? ['--'] : []
  const provided = [...options, ...passthrough]
  if (provided.length === 0) return
  throw new Error(
    `Unsupported option-only invocation for ${surface}: ${provided.join(', ')}. Specify a command or use help.`,
  )
}

export function isCommandCliUsageError(error: unknown) {
  if (!(error instanceof Error)) return false
  return [
    'Unknown option',
    'Unsupported option',
    'Unsupported OpenWaggle',
    'Missing value',
    'do not accept values',
    'requires more positional arguments',
    'received unexpected positional arguments',
    'does not accept arguments after --',
  ].some((fragment) => error.message.includes(fragment))
}
