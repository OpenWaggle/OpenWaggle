import type { JsonObject } from '@shared/types/json'
import {
  label,
  numberArg,
  objectArg,
  stringArg,
  type ToolLabel,
  type Verbs,
} from './tool-label-parts'

const BROWSER_TITLE = 'browser preview'

function previewTarget(args: JsonObject) {
  const element = stringArg(args, 'locator') ?? stringArg(args, 'selector')
  if (element) return element
  const x = numberArg(args, 'x')
  const y = numberArg(args, 'y')
  return x !== null && y !== null ? `(${String(x)}, ${String(y)})` : null
}

function previewUrl(args: JsonObject) {
  const url = stringArg(args, 'url')
  if (url) return url
  const target = objectArg(args, 'target')
  if (!target) return null
  const targetUrl = stringArg(target, 'url')
  if (targetUrl) return targetUrl
  const port = numberArg(target, 'port')
  if (port === null) return null
  // The Host resolves a relative path against the origin, so `a` and `/a` are the same page.
  const path = stringArg(target, 'path')
  const shownPath = path === null ? '' : path.startsWith('/') ? path : `/${path}`
  return `port ${String(port)}${shownPath}`
}

function previewKey(args: JsonObject) {
  const key = stringArg(args, 'key')
  if (!key) return null
  const modifiers = args.modifiers
  const held = Array.isArray(modifiers)
    ? modifiers.filter((modifier): modifier is string => typeof modifier === 'string')
    : []
  return [...held, key].join('+')
}

function previewSize(args: JsonObject) {
  const preset = stringArg(args, 'preset')
  if (preset) return preset
  const width = numberArg(args, 'width')
  const height = numberArg(args, 'height')
  if (width !== null && height !== null) return `${String(width)}×${String(height)}`
  return stringArg(args, 'mode')
}

function previewWaitTarget(args: JsonObject) {
  return (
    stringArg(args, 'text') ??
    stringArg(args, 'locator') ??
    stringArg(args, 'selector') ??
    stringArg(args, 'urlIncludes')
  )
}

interface PreviewLabel {
  readonly verbs: Verbs
  readonly detail: (args: JsonObject) => string | null
  /** Verbs that read as whole when there is no detail, as "Navigated to" does not. */
  readonly bare?: Verbs
}

function previewLabels(): ReadonlyMap<string, PreviewLabel> {
  const fixed = (running: string, done: string): PreviewLabel => ({
    verbs: { running, done },
    detail: () => null,
  })
  return new Map<string, PreviewLabel>([
    [
      'preview_open',
      {
        verbs: { running: 'Opening browser preview', done: 'Opened browser preview' },
        detail: previewUrl,
      },
    ],
    [
      'preview_navigate',
      {
        verbs: { running: 'Navigating to', done: 'Navigated to' },
        detail: previewUrl,
        bare: { running: 'Navigating browser preview', done: 'Navigated browser preview' },
      },
    ],
    [
      'preview_click',
      {
        verbs: { running: 'Clicking', done: 'Clicked' },
        detail: previewTarget,
        bare: { running: 'Clicking in page', done: 'Clicked in page' },
      },
    ],
    [
      'preview_type',
      {
        verbs: { running: 'Typing into', done: 'Typed into' },
        detail: previewTarget,
        bare: { running: 'Typing in page', done: 'Typed in page' },
      },
    ],
    [
      'preview_press',
      {
        verbs: { running: 'Pressing', done: 'Pressed' },
        detail: previewKey,
        bare: { running: 'Pressing a key', done: 'Pressed a key' },
      },
    ],
    ['preview_scroll', fixed('Scrolling page', 'Scrolled page')],
    ['preview_snapshot', fixed('Taking page snapshot', 'Took page snapshot')],
    ['preview_evaluate', fixed('Evaluating script in page', 'Evaluated script in page')],
    [
      'preview_wait_for',
      {
        verbs: { running: 'Waiting for page', done: 'Waited for page' },
        detail: previewWaitTarget,
      },
    ],
    [
      'preview_resize',
      { verbs: { running: 'Resizing preview', done: 'Resized preview' }, detail: previewSize },
    ],
    [
      'preview_set_appearance',
      {
        verbs: { running: 'Setting appearance', done: 'Set appearance' },
        detail: (args) => stringArg(args, 'colorScheme'),
      },
    ],
    ['preview_recording_start', fixed('Starting recording', 'Started recording')],
    ['preview_recording_stop', fixed('Stopping recording', 'Stopped recording')],
    ['preview_status', fixed('Checking preview', 'Checked preview')],
  ])
}

const PREVIEW_LABELS = previewLabels()

/** The `preview_*` tools that drive the Session's browser preview. */
export function previewLabel(name: string, args: JsonObject): ToolLabel | null {
  const entry = PREVIEW_LABELS.get(name)
  if (!entry) return null
  const target = entry.detail(args)
  if (entry.bare) {
    return target
      ? label(entry.verbs, target, BROWSER_TITLE, ' ')
      : label(entry.bare, null, BROWSER_TITLE)
  }
  return label(entry.verbs, target, BROWSER_TITLE)
}
