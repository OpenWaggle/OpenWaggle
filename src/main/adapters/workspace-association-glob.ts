import { matchBy } from '@diegogbrisa/ts-match'

const CHARACTER_RANGE_END_OFFSET = 2
const GLOBSTAR_DIRECTORY_END_OFFSET = 2
export const MAX_WORKSPACE_ASSOCIATION_GLOB_CODE_UNITS = 4_096
const SEARCH_PARTITION_COUNT = 2

export interface GlobMatchOperationBudget {
  remaining: number
}

interface CharacterRange {
  readonly start: number
  readonly end: number
}

type GlobToken =
  | { readonly kind: 'literal'; readonly value: string }
  | { readonly kind: 'star' }
  | { readonly kind: 'globstar' }
  | { readonly kind: 'globstar-directory' }
  | { readonly kind: 'question' }
  | {
      readonly kind: 'character-class'
      readonly negated: boolean
      readonly ranges: readonly CharacterRange[]
    }

function normalizedCharacterRanges(ranges: readonly CharacterRange[]) {
  const sorted = ranges.toSorted((left, right) => left.start - right.start || left.end - right.end)
  const normalized: CharacterRange[] = []
  for (const range of sorted) {
    const previous = normalized.at(-1)
    if (!previous || range.start > previous.end + 1) {
      normalized.push(range)
      continue
    }
    normalized[normalized.length - 1] = {
      start: previous.start,
      end: Math.max(previous.end, range.end),
    }
  }
  return normalized
}

function characterClassToken(glob: readonly string[], opening: number) {
  const closing = glob.indexOf(']', opening + 1)
  if (closing <= opening + 1) return null
  const rawClass = glob.slice(opening + 1, closing)
  const negated = rawClass[0] === '!'
  const members = negated ? rawClass.slice(1) : rawClass
  if (members.length === 0) return null
  const ranges: CharacterRange[] = []
  for (let index = 0; index < members.length; index += 1) {
    const start = members[index]?.codePointAt(0)
    if (start === undefined) return { invalid: true } as const
    if (members[index + 1] === '-' && index + CHARACTER_RANGE_END_OFFSET < members.length) {
      const end = members[index + CHARACTER_RANGE_END_OFFSET]?.codePointAt(0)
      if (end === undefined) return { invalid: true } as const
      if (start > end) return { invalid: true } as const
      ranges.push({ start, end })
      index += CHARACTER_RANGE_END_OFFSET
    } else {
      ranges.push({ start, end: start })
    }
  }
  return {
    end: closing,
    token: {
      kind: 'character-class',
      negated,
      ranges: normalizedCharacterRanges(ranges),
    } satisfies GlobToken,
  }
}

function globTokens(glob: string): readonly GlobToken[] | null {
  if (glob.length > MAX_WORKSPACE_ASSOCIATION_GLOB_CODE_UNITS) return null
  const characters = Array.from(glob)
  const tokens: GlobToken[] = []
  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index]
    if (character === '*') {
      if (characters[index + 1] === '*') {
        if (characters[index + GLOBSTAR_DIRECTORY_END_OFFSET] === '/') {
          tokens.push({ kind: 'globstar-directory' })
          index += GLOBSTAR_DIRECTORY_END_OFFSET
        } else {
          tokens.push({ kind: 'globstar' })
          index += 1
        }
      } else {
        tokens.push({ kind: 'star' })
      }
      continue
    }
    if (character === '?') {
      tokens.push({ kind: 'question' })
      continue
    }
    if (character === '[') {
      const characterClass = characterClassToken(characters, index)
      if (characterClass && 'invalid' in characterClass) return null
      if (characterClass) {
        tokens.push(characterClass.token)
        index = characterClass.end
        continue
      }
    }
    tokens.push({ kind: 'literal', value: character ?? '' })
  }
  return tokens
}

function characterClassMatches(
  token: Extract<GlobToken, { kind: 'character-class' }>,
  value: string,
) {
  const code = value.codePointAt(0)
  if (code === undefined) return false
  let lower = 0
  let upper = token.ranges.length - 1
  let member = false
  while (lower <= upper) {
    const middle = Math.floor((lower + upper) / SEARCH_PARTITION_COUNT)
    const range = token.ranges[middle]
    if (!range) break
    if (code < range.start) {
      upper = middle - 1
      continue
    }
    if (code > range.end) {
      lower = middle + 1
      continue
    }
    member = true
    break
  }
  return token.negated ? !member : member
}

function consumeMatchOperation(budget: GlobMatchOperationBudget) {
  if (budget.remaining <= 0) return false
  budget.remaining -= 1
  return true
}

function repeatingTokenRow(
  token: Extract<GlobToken, { kind: 'star' | 'globstar' }>,
  candidate: readonly string[],
  next: Uint8Array,
  budget: GlobMatchOperationBudget,
) {
  const current = new Uint8Array(candidate.length + 1)
  current[candidate.length] = next[candidate.length] ?? 0
  for (let index = candidate.length - 1; index >= 0; index -= 1) {
    if (!consumeMatchOperation(budget)) return null
    const canConsume = token.kind === 'globstar' || candidate[index] !== '/'
    current[index] = next[index] || (canConsume && current[index + 1]) ? 1 : 0
  }
  return current
}

function globstarDirectoryRow(
  candidate: readonly string[],
  next: Uint8Array,
  budget: GlobMatchOperationBudget,
) {
  const current = new Uint8Array(candidate.length + 1)
  let matchesAtLaterSlash = false
  current[candidate.length] = next[candidate.length] ?? 0
  for (let index = candidate.length - 1; index >= 0; index -= 1) {
    if (!consumeMatchOperation(budget)) return null
    if (candidate[index] === '/' && next[index + 1]) matchesAtLaterSlash = true
    current[index] = next[index] || matchesAtLaterSlash ? 1 : 0
  }
  return current
}

function singleCharacterRow(
  token: Extract<GlobToken, { kind: 'literal' | 'question' | 'character-class' }>,
  candidate: readonly string[],
  next: Uint8Array,
  budget: GlobMatchOperationBudget,
) {
  const current = new Uint8Array(candidate.length + 1)
  const matchesValue = matchBy(token, 'kind')
    .with('literal', (literal) => (value: string) => value === literal.value)
    .with('question', () => (value: string) => value !== '/')
    .with(
      'character-class',
      (characterClass) => (value: string) => characterClassMatches(characterClass, value),
    )
    .exhaustive()
  for (let index = candidate.length - 1; index >= 0; index -= 1) {
    if (!consumeMatchOperation(budget)) return null
    const value = candidate[index] ?? ''
    current[index] = matchesValue(value) && next[index + 1] ? 1 : 0
  }
  return current
}

function deterministicGlobMatch(
  tokens: readonly GlobToken[],
  candidate: readonly string[],
  budget: GlobMatchOperationBudget,
) {
  let next = new Uint8Array(candidate.length + 1)
  next[candidate.length] = 1
  for (let tokenIndex = tokens.length - 1; tokenIndex >= 0; tokenIndex -= 1) {
    const token = tokens[tokenIndex]
    if (!token) return false
    const current = matchBy(token, 'kind')
      .with('star', 'globstar', (repeating) =>
        repeatingTokenRow(repeating, candidate, next, budget),
      )
      .with('globstar-directory', () => globstarDirectoryRow(candidate, next, budget))
      .with('literal', 'question', 'character-class', (singleCharacter) =>
        singleCharacterRow(singleCharacter, candidate, next, budget),
      )
      .exhaustive()
    if (!current) return false
    next = current
  }
  return next[0] === 1
}

export function matchesWorkspaceAssociationGlob(
  glob: string,
  candidate: string,
  budget: GlobMatchOperationBudget,
) {
  const tokens = globTokens(glob)
  return tokens ? deterministicGlobMatch(tokens, Array.from(candidate), budget) : false
}
