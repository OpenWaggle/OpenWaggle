import {
  DEFAULT_CODE_FONT_FAMILY,
  DEFAULT_INTERFACE_FONT_FAMILY,
} from '@shared/types/appearance-preferences'

export interface FontChoice {
  readonly id: string
  readonly label: string
  readonly fontFamily: string
  readonly availabilityName?: string
}

export const INTERFACE_FONT_CHOICES = [
  { id: 'system-ui', label: 'System UI', fontFamily: DEFAULT_INTERFACE_FONT_FAMILY },
  {
    id: 'inter',
    label: 'Inter',
    fontFamily: 'Inter, system-ui, sans-serif',
    availabilityName: 'Inter',
  },
  {
    id: 'geist',
    label: 'Geist',
    fontFamily: 'Geist, system-ui, sans-serif',
    availabilityName: 'Geist',
  },
  { id: 'arial', label: 'Arial', fontFamily: 'Arial, sans-serif', availabilityName: 'Arial' },
  { id: 'georgia', label: 'Georgia', fontFamily: 'Georgia, serif', availabilityName: 'Georgia' },
] as const satisfies readonly FontChoice[]

export const CODE_FONT_CHOICES = [
  { id: 'system-mono', label: 'System monospace', fontFamily: DEFAULT_CODE_FONT_FAMILY },
  {
    id: 'jetbrains-mono',
    label: 'JetBrains Mono',
    fontFamily: `"JetBrains Mono", ${DEFAULT_CODE_FONT_FAMILY}`,
    availabilityName: 'JetBrains Mono',
  },
  {
    id: 'fira-code',
    label: 'Fira Code',
    fontFamily: `"Fira Code", ${DEFAULT_CODE_FONT_FAMILY}`,
    availabilityName: 'Fira Code',
  },
  {
    id: 'cascadia-code',
    label: 'Cascadia Code',
    fontFamily: `"Cascadia Code", ${DEFAULT_CODE_FONT_FAMILY}`,
    availabilityName: 'Cascadia Code',
  },
  {
    id: 'ibm-plex-mono',
    label: 'IBM Plex Mono',
    fontFamily: `"IBM Plex Mono", ${DEFAULT_CODE_FONT_FAMILY}`,
    availabilityName: 'IBM Plex Mono',
  },
  {
    id: 'menlo',
    label: 'Menlo',
    fontFamily: `Menlo, ${DEFAULT_CODE_FONT_FAMILY}`,
    availabilityName: 'Menlo',
  },
] as const satisfies readonly FontChoice[]

const FONT_PROBE_SIZE_PX = 72
const FONT_PROBE_SAMPLES = ['mmmmmmlli', 'WW@#1', '{}[]() =>'] as const
const FONT_PROBE_FALLBACKS = ['monospace', 'sans-serif', 'serif'] as const
const fontAvailabilityCache = new Map<string, boolean>()

function fontSignature(context: CanvasRenderingContext2D, family: string) {
  context.font = `${String(FONT_PROBE_SIZE_PX)}px ${family}`
  return FONT_PROBE_SAMPLES.map((sample) => {
    const metrics = context.measureText(sample)
    return `${String(metrics.width)}:${String(metrics.actualBoundingBoxAscent)}:${String(
      metrics.actualBoundingBoxDescent,
    )}`
  }).join('|')
}

function installedFont(name: string) {
  const cached = fontAvailabilityCache.get(name)
  if (cached !== undefined) return cached
  if (typeof document === 'undefined' || navigator.userAgent.includes('jsdom')) return true
  const context = document.createElement('canvas').getContext('2d')
  if (!context) return true
  const quotedName = JSON.stringify(name)
  const available = FONT_PROBE_FALLBACKS.some(
    (fallback) =>
      fontSignature(context, `${quotedName}, ${fallback}`) !== fontSignature(context, fallback),
  )
  fontAvailabilityCache.set(name, available)
  return available
}

export function fontChoiceAvailable(choice: FontChoice) {
  return choice.availabilityName ? installedFont(choice.availabilityName) : true
}
