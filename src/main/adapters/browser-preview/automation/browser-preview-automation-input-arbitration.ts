import { uncheckedFields } from '@shared/utils/object-shape'
import type {
  BrowserPreviewAutomationKeyInput,
  BrowserPreviewAutomationMouseInput,
} from './browser-preview-automation-contents'
import type { CdpCommandParams, CdpInputEventParams } from './browser-preview-cdp-input-params'

/** A wheel event's scroll deltas, which only wheel events carry. */
interface WheelDeltas {
  readonly deltaX?: number
  readonly deltaY?: number
}

const EXPECTED_INPUT_TTL_MS = 1_000
const MAX_EXPECTED_INPUTS = 32
const POINTER_COORDINATE_TOLERANCE = 1
const ALT_MODIFIER_MASK = 1
const CONTROL_MODIFIER_MASK = 2
const META_MODIFIER_MASK = 4
const SHIFT_MODIFIER_MASK = 8

type InputPhase = 'keyDown' | 'keyUp' | 'mouseDown' | 'mouseMove' | 'mouseUp' | 'mouseWheel'

interface ExpectedInputBase {
  readonly id: number
  readonly expiresAt: number
  readonly modifiers: number
}

interface ExpectedKeyboardSignal extends ExpectedInputBase {
  readonly kind: 'keyboard'
  readonly phase: 'keyDown' | 'keyUp'
  readonly key: string
  readonly code: string
  readonly location: number
}

interface ExpectedMouseSignal extends ExpectedInputBase {
  readonly kind: 'mouse'
  readonly phase: InputPhase
  readonly x: number
  readonly y: number
  /** Absent when the dispatched event named no button, deltaX or deltaY; any value matches. */
  readonly button: string | undefined
  readonly deltaX: number | undefined
  readonly deltaY: number | undefined
}

type ExpectedInputSignal = ExpectedKeyboardSignal | ExpectedMouseSignal

const CDP_MOUSE_PHASES: Readonly<Record<string, InputPhase | undefined>> = {
  mousePressed: 'mouseDown',
  mouseReleased: 'mouseUp',
  mouseMoved: 'mouseMove',
  mouseWheel: 'mouseWheel',
}

function keyPhase(type: unknown) {
  if (type === 'keyDown' || type === 'rawKeyDown') {
    const signal: ExpectedKeyboardSignal['phase'] | null = 'keyDown'
    return signal
  }
  const signal: ExpectedKeyboardSignal['phase'] | null = type === 'keyUp' ? 'keyUp' : null
  return signal
}

function finiteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : undefined
}

function modifierMask(
  input: BrowserPreviewAutomationKeyInput | BrowserPreviewAutomationMouseInput,
) {
  if ('shift' in input) {
    return (
      (input.alt ? ALT_MODIFIER_MASK : 0) |
      (input.control ? CONTROL_MODIFIER_MASK : 0) |
      (input.meta ? META_MODIFIER_MASK : 0) |
      (input.shift ? SHIFT_MODIFIER_MASK : 0)
    )
  }
  const modifiers = new Set(input.modifiers ?? [])
  return (
    (modifiers.has('alt') ? ALT_MODIFIER_MASK : 0) |
    (modifiers.has('control') || modifiers.has('ctrl') ? CONTROL_MODIFIER_MASK : 0) |
    (modifiers.has('meta') || modifiers.has('command') || modifiers.has('cmd')
      ? META_MODIFIER_MASK
      : 0) |
    (modifiers.has('shift') ? SHIFT_MODIFIER_MASK : 0)
  )
}

function expectedSignal(id: number, method: string, params: CdpCommandParams, now: number) {
  const fields = uncheckedFields<CdpInputEventParams>(params)
  if (method === 'Input.dispatchKeyEvent') {
    const phase = keyPhase(fields.type)
    const key = stringValue(fields.key)
    const code = stringValue(fields.code)
    if (!phase || key === undefined || code === undefined) return null
    const signal: ExpectedInputSignal | null = {
      kind: 'keyboard',
      id,
      phase,
      expiresAt: now + EXPECTED_INPUT_TTL_MS,
      key,
      code,
      location: finiteNumber(fields.location) ?? 0,
      modifiers: finiteNumber(fields.modifiers) ?? 0,
    }
    return signal
  }
  if (method !== 'Input.dispatchMouseEvent') return null
  const phase = stringValue(fields.type) ? CDP_MOUSE_PHASES[String(fields.type)] : undefined
  const x = finiteNumber(fields.x)
  const y = finiteNumber(fields.y)
  if (!phase || x === undefined || y === undefined) return null
  const signal: ExpectedInputSignal | null = {
    kind: 'mouse',
    id,
    phase,
    expiresAt: now + EXPECTED_INPUT_TTL_MS,
    x,
    y,
    button: stringValue(fields.button),
    modifiers: finiteNumber(fields.modifiers) ?? 0,
    deltaX: finiteNumber(fields.deltaX),
    deltaY: finiteNumber(fields.deltaY),
  }
  return signal
}

function matchesKeyboard(expected: ExpectedInputSignal, input: BrowserPreviewAutomationKeyInput) {
  const phase = keyPhase(input.type)
  return (
    expected.kind === 'keyboard' &&
    phase === expected.phase &&
    input.key === expected.key &&
    input.code === expected.code &&
    input.location === expected.location &&
    modifierMask(input) === expected.modifiers
  )
}

function matchesMouse(expected: ExpectedInputSignal, input: BrowserPreviewAutomationMouseInput) {
  if (
    expected.kind !== 'mouse' ||
    input.type !== expected.phase ||
    Math.abs(input.x - expected.x) > POINTER_COORDINATE_TOLERANCE ||
    Math.abs(input.y - expected.y) > POINTER_COORDINATE_TOLERANCE ||
    modifierMask(input) !== expected.modifiers
  ) {
    return false
  }
  if (expected.button !== undefined && input.button !== expected.button) return false
  if (
    expected.deltaX !== undefined &&
    uncheckedFields<WheelDeltas>(input).deltaX !== expected.deltaX
  ) {
    return false
  }
  if (
    expected.deltaY !== undefined &&
    uncheckedFields<WheelDeltas>(input).deltaY !== expected.deltaY
  ) {
    return false
  }
  return true
}

export class BrowserPreviewAutomationInputArbitrator {
  private readonly expected: ExpectedInputSignal[] = []
  private nextId = 1

  expect(method: string, params: CdpCommandParams = {}, now = Date.now()) {
    this.prune(now)
    const signal = expectedSignal(this.nextId, method, params, now)
    if (!signal) return null
    this.nextId += 1
    this.expected.push(signal)
    if (this.expected.length > MAX_EXPECTED_INPUTS) this.expected.shift()
    const result: number | null = signal.id
    return result
  }

  cancel(id: number | null) {
    if (id === null) return
    const index = this.expected.findIndex((signal) => signal.id === id)
    if (index >= 0) this.expected.splice(index, 1)
  }

  consumeKeyboard(input: BrowserPreviewAutomationKeyInput, now = Date.now()) {
    return this.consume((signal) => matchesKeyboard(signal, input), now)
  }

  consumeMouse(input: BrowserPreviewAutomationMouseInput, now = Date.now()) {
    return this.consume((signal) => matchesMouse(signal, input), now)
  }

  clear() {
    this.expected.length = 0
  }

  private consume(matches: (signal: ExpectedInputSignal) => boolean, now: number) {
    this.prune(now)
    const index = this.expected.findIndex(matches)
    if (index < 0) return false
    this.expected.splice(index, 1)
    return true
  }

  private prune(now: number) {
    let expired = 0
    for (const signal of this.expected) {
      if (signal.expiresAt >= now) break
      expired += 1
    }
    if (expired > 0) this.expected.splice(0, expired)
  }
}
