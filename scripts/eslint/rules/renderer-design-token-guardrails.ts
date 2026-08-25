import type { Rule } from 'eslint'
import {
  isUnknownArray,
  nodeType,
  normalizedFilename,
  property,
} from '../ast-helpers'

type FindingMessageId = 'arbitraryValue' | 'paletteColor' | 'rawHexColor'

interface Finding {
  readonly detail: string
  readonly messageId: FindingMessageId
  readonly node: Rule.Node
}

const RENDERER_PATH_PREFIX = 'src/renderer/src/'
const RENDERER_PATH_MARKER = `/${RENDERER_PATH_PREFIX}`

const RAW_HEX_COLOR = /(?<![0-9A-Fa-f])#(?:[0-9A-Fa-f]{8}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{4}|[0-9A-Fa-f]{3})(?![0-9A-Fa-f])/gu

const ARBITRARY_VALUE_UTILITY = /^(?:text|leading|tracking|indent|p[xysetrlb]?|m[xysetrlb]?|gap(?:-[xy])?|space-[xy]|inset(?:-[xyse])?|top|right|bottom|left|start|end|scroll-[mp][xysetrlb]?|border-spacing(?:-[xy])?|translate-[xy]|size|w|min-w|max-w|h|min-h|max-h|basis|rounded(?:-[setrlb]|-[setb][se]?|-[tblr][lr])?)-\[.+\](?:\/.+)?$/u

const ARBITRARY_CSS_PROPERTY = /^\[(?:font-size|line-height|letter-spacing|text-indent|padding(?:-(?:inline|block)(?:-(?:start|end))?|-(?:top|right|bottom|left))?|margin(?:-(?:inline|block)(?:-(?:start|end))?|-(?:top|right|bottom|left))?|gap|row-gap|column-gap|inset(?:-(?:inline|block)(?:-(?:start|end))?)?|top|right|bottom|left|translate|width|min-width|max-width|height|min-height|max-height|flex-basis|border-radius|border-(?:start|end)-(?:start|end)-radius|border-(?:top|right|bottom|left)-(?:left|right)-radius):.+\]$/u

const TAILWIND_PALETTE =
  '(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)'
const TAILWIND_SHADE = '(?:50|100|200|300|400|500|600|700|800|900|950)'
const COLOR_UTILITY_FAMILY =
  '(?:bg|text|border(?:-[xysetrlb])?|divide|outline|ring(?:-offset)?|shadow|drop-shadow|fill|stroke|decoration|accent|caret|placeholder|from|via|to)'
const TAILWIND_PALETTE_UTILITY = new RegExp(
  `^${COLOR_UTILITY_FAMILY}-(?:${TAILWIND_PALETTE}-${TAILWIND_SHADE}|black|white)(?:\\/(?:[0-9.]+|\\[.+\\]))?$`,
  'u',
)

export function repositoryRelativeRendererFilename(filename: string) {
  const normalized = normalizedFilename(filename)
  if (normalized.startsWith(RENDERER_PATH_PREFIX)) {
    return normalized
  }

  const markerIndex = normalized.lastIndexOf(RENDERER_PATH_MARKER)
  return markerIndex >= 0 ? normalized.slice(markerIndex + 1) : normalized
}

function exemptionSet(context: Rule.RuleContext) {
  const entries = property(context.options[0], 'exemptFiles')
  if (!isUnknownArray(entries)) {
    return new Set<string>()
  }

  return new Set(entries.filter((entry): entry is string => typeof entry === 'string'))
}

function staticStringValue(node: Rule.Node) {
  if (nodeType(node) === 'Literal') {
    const value = property(node, 'value')
    return typeof value === 'string' ? value : null
  }

  if (nodeType(node) === 'TemplateElement') {
    const cooked = property(property(node, 'value'), 'cooked')
    return typeof cooked === 'string' ? cooked : null
  }

  return null
}

function stripVariants(candidate: string) {
  let bracketDepth = 0
  let lastVariantSeparator = -1

  for (const [index, character] of [...candidate].entries()) {
    if (character === '[') bracketDepth += 1
    if (character === ']') bracketDepth -= 1
    if (character === ':' && bracketDepth === 0) lastVariantSeparator = index
  }

  return candidate
    .slice(lastVariantSeparator + 1)
    .replace(/^!/u, '')
    .replace(/!$/u, '')
    .replace(/^-/u, '')
}

function collectTailwindFindings(node: Rule.Node, value: string) {
  const findings: Finding[] = []

  for (const rawCandidate of value.split(/\s+/u)) {
    const candidate = stripVariants(rawCandidate)
    if (ARBITRARY_VALUE_UTILITY.test(candidate) || ARBITRARY_CSS_PROPERTY.test(candidate)) {
      findings.push({
        detail: rawCandidate,
        messageId: 'arbitraryValue',
        node,
      })
    }

    if (TAILWIND_PALETTE_UTILITY.test(candidate)) {
      findings.push({
        detail: rawCandidate,
        messageId: 'paletteColor',
        node,
      })
    }
  }

  return findings
}

function collectStringFindings(node: Rule.Node) {
  const value = staticStringValue(node)
  if (value === null) {
    return []
  }

  const findings = collectTailwindFindings(node, value)
  for (const match of value.matchAll(RAW_HEX_COLOR)) {
    findings.push({
      detail: match[0],
      messageId: 'rawHexColor',
      node,
    })
  }

  return findings
}

export const rendererDesignTokenGuardrailsRule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    schema: [
      {
        type: 'object',
        properties: {
          exemptFiles: {
            type: 'array',
            items: { type: 'string' },
            uniqueItems: true,
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      arbitraryValue:
        'Use Tailwind v4 standard text, spacing, sizing, and radius utilities instead of arbitrary value "{{detail}}".',
      paletteColor:
        'Use an OpenWaggle semantic color role instead of Tailwind palette utility "{{detail}}".',
      rawHexColor:
        'Use an OpenWaggle semantic color role instead of raw color "{{detail}}" in renderer code.',
      staleExemption:
        'This file no longer violates renderer design-token guardrails. Remove it from scripts/renderer-design-token-exemptions.json.',
    },
  },
  create(context) {
    const exemptFiles = exemptionSet(context)
    const filename = repositoryRelativeRendererFilename(context.filename)
    const findings: Finding[] = []

    return {
      Literal(node: Rule.Node) {
        findings.push(...collectStringFindings(node))
      },
      'Program:exit'() {
        const isExempt = exemptFiles.has(filename)
        if (isExempt && findings.length === 0) {
          context.report({ loc: { line: 1, column: 0 }, messageId: 'staleExemption' })
          return
        }

        if (isExempt) {
          return
        }

        for (const finding of findings) {
          context.report({
            node: finding.node,
            messageId: finding.messageId,
            data: { detail: finding.detail },
          })
        }
      },
      TemplateElement(node: Rule.Node) {
        findings.push(...collectStringFindings(node))
      },
    }
  },
}
