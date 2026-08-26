/** Contrast and host-source gate for the ADR 0024 public color contract. */
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import {
  DEFAULT_EXTENSION_THEME_TOKENS,
  SOURCE_EXTENSION_THEME_CSS_VARIABLES,
} from '../packages/extension-sdk/src/theme-data.js'

const GLOBALS_CSS_URL = new URL('../src/renderer/src/styles/globals.css', import.meta.url)

const TEXT_CONTRAST_FLOOR = 4.5
const NON_TEXT_CONTRAST_FLOOR = 3
const PUBLIC_COLOR_ROLE_COUNT = 23
const CHANNEL_MAX = 255
const S_RGB_BREAKPOINT = 0.04045
const S_RGB_SLOPE = 12.92
const S_RGB_OFFSET = 0.055
const S_RGB_EXPONENT = 1.055
const S_RGB_GAMMA = 2.4
const LUMA_RED = 0.2126
const LUMA_GREEN = 0.7152
const LUMA_BLUE = 0.0722
const LUMINANCE_OFFSET = 0.05
const HEX_BASE = 16
const HEX_CHANNEL_LENGTH = 2
const RED_CHANNEL_START = 1
const GREEN_CHANNEL_START = 3
const BLUE_CHANNEL_START = 5
const RATIO_DECIMALS = 2
const CSS_VALUE_CAPTURE_INDEX = 2
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i
const CSS_DECLARATION_PATTERN = /(--[a-z0-9-]+)\s*:\s*([^;]+);/gi
const CSS_VARIABLE_REFERENCE_PATTERN = /^var\(\s*(--[a-z0-9-]+)\s*\)$/i

export const SURFACE_COLOR_ROLES = [
  'background',
  'surface',
  'surfaceRaised',
  'surfaceHover',
  'surfaceActive',
] as const

export const DECORATIVE_BORDER_COLOR_ROLES = ['border', 'borderStrong'] as const

export const TEXT_COLOR_ROLES = [
  'text',
  'textSubtle',
  'textMuted',
  'textDim',
  'accent',
  'accentDim',
  'success',
  'dangerText',
  'warning',
  'infoText',
  'review',
  'plan',
  'progress',
  'neutral',
] as const

export const NON_TEXT_COLOR_ROLES = ['danger', 'info'] as const

export const PUBLIC_COLOR_ROLES = [
  ...SURFACE_COLOR_ROLES,
  ...DECORATIVE_BORDER_COLOR_ROLES,
  ...TEXT_COLOR_ROLES,
  ...NON_TEXT_COLOR_ROLES,
] as const

type ColorValues = Readonly<Record<string, string>>

export interface RgbColor {
  readonly red: number
  readonly green: number
  readonly blue: number
}

export interface ContrastFailure {
  readonly role: string
  readonly surface: string
  readonly ratio: number
  readonly floor: number
}

export function parseHexColor(hex: string): RgbColor {
  if (!HEX_COLOR_PATTERN.test(hex)) {
    throw new Error(`Invalid six-digit hex color: ${hex}`)
  }

  return {
    red: Number.parseInt(hex.slice(RED_CHANNEL_START, RED_CHANNEL_START + HEX_CHANNEL_LENGTH), HEX_BASE),
    green: Number.parseInt(
      hex.slice(GREEN_CHANNEL_START, GREEN_CHANNEL_START + HEX_CHANNEL_LENGTH),
      HEX_BASE,
    ),
    blue: Number.parseInt(
      hex.slice(BLUE_CHANNEL_START, BLUE_CHANNEL_START + HEX_CHANNEL_LENGTH),
      HEX_BASE,
    ),
  }
}

function channelToLinear(channel: number) {
  const normalized = channel / CHANNEL_MAX
  return normalized <= S_RGB_BREAKPOINT
    ? normalized / S_RGB_SLOPE
    : ((normalized + S_RGB_OFFSET) / S_RGB_EXPONENT) ** S_RGB_GAMMA
}

function relativeLuminance(hex: string) {
  const color = parseHexColor(hex)
  return (
    LUMA_RED * channelToLinear(color.red) +
    LUMA_GREEN * channelToLinear(color.green) +
    LUMA_BLUE * channelToLinear(color.blue)
  )
}

export function contrastRatio(first: string, second: string) {
  const firstLuminance = relativeLuminance(first)
  const secondLuminance = relativeLuminance(second)
  const lighter = Math.max(firstLuminance, secondLuminance)
  const darker = Math.min(firstLuminance, secondLuminance)
  return (lighter + LUMINANCE_OFFSET) / (darker + LUMINANCE_OFFSET)
}

function colorValue(colors: ColorValues, role: string) {
  const value = colors[role]
  if (value === undefined) {
    throw new Error(`Missing SDK color role: ${role}`)
  }
  return value
}

function failuresForRoles(
  colors: ColorValues,
  roles: readonly string[],
  floor: number,
): ContrastFailure[] {
  const failures: ContrastFailure[] = []

  for (const role of roles) {
    const foreground = colorValue(colors, role)
    for (const surface of SURFACE_COLOR_ROLES) {
      const ratio = contrastRatio(foreground, colorValue(colors, surface))
      if (ratio < floor) {
        failures.push({ role, surface, ratio, floor })
      }
    }
  }

  return failures
}

export function findContrastFailures(colors: ColorValues): ContrastFailure[] {
  return [
    ...failuresForRoles(colors, TEXT_COLOR_ROLES, TEXT_CONTRAST_FLOOR),
    ...failuresForRoles(colors, NON_TEXT_COLOR_ROLES, NON_TEXT_CONTRAST_FLOOR),
  ]
}

function compareContractKeys(label: string, values: ColorValues) {
  const issues: string[] = []
  const expected = new Set<string>(PUBLIC_COLOR_ROLES)
  const actual = Object.keys(values)
  const missing = PUBLIC_COLOR_ROLES.filter((role) => !(role in values))
  const unexpected = actual.filter((role) => !expected.has(role)).sort()

  if (missing.length > 0) issues.push(`${label} is missing roles: ${missing.join(', ')}`)
  if (unexpected.length > 0) issues.push(`${label} has unexpected roles: ${unexpected.join(', ')}`)
  return issues
}

export function validatePublicColorContract(colors: ColorValues, sourceVariables: ColorValues) {
  const issues: string[] = []
  if (PUBLIC_COLOR_ROLES.length !== PUBLIC_COLOR_ROLE_COUNT) {
    issues.push(
      `Contrast gate defines ${PUBLIC_COLOR_ROLES.length} roles; ADR 0024 requires ${PUBLIC_COLOR_ROLE_COUNT}`,
    )
  }
  issues.push(...compareContractKeys('SDK color contract', colors))
  issues.push(...compareContractKeys('Host color mapping', sourceVariables))
  return issues
}

export function parseThemeStaticVariables(css: string) {
  const opening = /@theme\s+static\s*\{/i.exec(css)
  if (opening?.index === undefined) {
    throw new Error('Host stylesheet has no @theme static block')
  }

  const blockStart = opening.index + opening[0].length
  const blockEnd = css.indexOf('\n}', blockStart)
  if (blockEnd === -1) {
    throw new Error('Host stylesheet has an unterminated @theme static block')
  }

  const variables = new Map<string, string>()
  for (const match of css.slice(blockStart, blockEnd).matchAll(CSS_DECLARATION_PATTERN)) {
    const name = match[1]
    const value = match[CSS_VALUE_CAPTURE_INDEX]
    if (name !== undefined && value !== undefined) variables.set(name, value.trim())
  }
  return variables
}

function resolveCssVariable(
  name: string,
  variables: ReadonlyMap<string, string>,
  visited = new Set<string>(),
): string | undefined {
  if (visited.has(name)) return undefined
  const value = variables.get(name)
  if (value === undefined) return undefined

  const reference = CSS_VARIABLE_REFERENCE_PATTERN.exec(value)
  if (reference === null) return value
  const target = reference[1]
  if (target === undefined) return undefined

  const nextVisited = new Set(visited)
  nextVisited.add(name)
  return resolveCssVariable(target, variables, nextVisited)
}

function comparableColor(value: string) {
  const trimmed = value.trim()
  return HEX_COLOR_PATTERN.test(trimmed) ? trimmed.toLowerCase() : trimmed
}

export function validateHostColorVariables(
  css: string,
  colors: ColorValues,
  sourceVariables: ColorValues,
) {
  let variables: ReadonlyMap<string, string>
  try {
    variables = parseThemeStaticVariables(css)
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)]
  }

  const issues: string[] = []
  for (const role of PUBLIC_COLOR_ROLES) {
    const variableName = sourceVariables[role]
    const expected = colors[role]
    if (variableName === undefined || expected === undefined) continue

    const actual = resolveCssVariable(variableName, variables)
    if (actual === undefined) {
      issues.push(`Host variable ${variableName} for ${role} is missing or unresolved`)
      continue
    }
    if (comparableColor(actual) !== comparableColor(expected)) {
      issues.push(`Host variable ${variableName} for ${role} is ${actual}; SDK default is ${expected}`)
    }
  }
  return issues
}

export function checkContrastGate(
  css: string,
  colors: ColorValues = DEFAULT_EXTENSION_THEME_TOKENS.color,
  sourceVariables: ColorValues = SOURCE_EXTENSION_THEME_CSS_VARIABLES.color,
) {
  const contractIssues = validatePublicColorContract(colors, sourceVariables)
  const issues = [...contractIssues, ...validateHostColorVariables(css, colors, sourceVariables)]
  if (contractIssues.length > 0) return issues

  try {
    for (const failure of findContrastFailures(colors)) {
      issues.push(
        `${failure.role} on ${failure.surface} is ${failure.ratio.toFixed(RATIO_DECIMALS)}:1; requires ${failure.floor}:1`,
      )
    }
  } catch (error) {
    issues.push(error instanceof Error ? error.message : String(error))
  }
  return issues
}

function main() {
  const issues = checkContrastGate(readFileSync(GLOBALS_CSS_URL, 'utf8'))
  if (issues.length > 0) {
    console.error(`Contrast check failed (${issues.length}):`)
    for (const issue of issues) console.error(`- ${issue}`)
    process.exitCode = 1
    return
  }

  console.log('Contrast check passed: 16 contrast roles, 5 surfaces, 23 host defaults.')
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
