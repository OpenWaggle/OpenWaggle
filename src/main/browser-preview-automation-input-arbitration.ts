import type { Input, MouseInputEvent } from 'electron'

const EXPECTED_INPUT_TTL_MS = 1_000
const MAX_EXPECTED_INPUTS = 32
const POINTER_COORDINATE_TOLERANCE = 1
const ALT_MODIFIER_MASK = 1
const CONTROL_MODIFIER_MASK = 2
const META_MODIFIER_MASK = 4
const SHIFT_MODIFIER_MASK = 8

type InputPhase = 'keyDown' | 'keyUp' | 'mouseDown' | 'mouseMove' | 'mouseUp' | 'mouseWheel'

interface ExpectedInputSignal {
  readonly id: number
  readonly phase: InputPhase
  readonly expiresAt: number
  readonly key?: string
  readonly code?: string
  readonly location?: number
  readonly modifiers?: number
  readonly button?: string
  readonly x?: number
  readonly y?: number
  readonly deltaX?: number
  readonly deltaY?: number
}

const CDP_MOUSE_PHASES: Readonly<Record<string, InputPhase | undefined>> = {
  mousePressed: 'mouseDown',
  mouseReleased: 'mouseUp',
  mouseMoved: 'mouseMove',
  mouseWheel: 'mouseWheel',
}

function keyPhase(type: unknown): InputPhase | null {
  if (type === 'keyDown' || type === 'rawKeyDown') return 'keyDown'
  return type === 'keyUp' ? 'keyUp' : null
}

function finiteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : undefined
}

function modifierMask(input: Input | MouseInputEvent) {
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

function expectedSignal(
  id: number,
  method: string,
  params: Readonly<Record<string, unknown>>,
  now: number,
): ExpectedInputSignal | null {
  if (method === 'Input.dispatchKeyEvent') {
    const phase = keyPhase(params.type)
    const key = stringValue(params.key)
    const code = stringValue(params.code)
    if (!phase || key === undefined || code === undefined) return null
    return {
      id,
      phase,
      expiresAt: now + EXPECTED_INPUT_TTL_MS,
      key,
      code,
      location: finiteNumber(params.location) ?? 0,
      modifiers: finiteNumber(params.modifiers) ?? 0,
    }
  }
  if (method !== 'Input.dispatchMouseEvent') return null
  const phase = stringValue(params.type) ? CDP_MOUSE_PHASES[String(params.type)] : undefined
  const x = finiteNumber(params.x)
  const y = finiteNumber(params.y)
  if (!phase || x === undefined || y === undefined) return null
  return {
    id,
    phase,
    expiresAt: now + EXPECTED_INPUT_TTL_MS,
    x,
    y,
    button: stringValue(params.button),
    modifiers: finiteNumber(params.modifiers) ?? 0,
    deltaX: finiteNumber(params.deltaX),
    deltaY: finiteNumber(params.deltaY),
  }
}

function matchesKeyboard(expected: ExpectedInputSignal, input: Input) {
  const phase = keyPhase(input.type)
  return (
    phase === expected.phase &&
    input.key === expected.key &&
    input.code === expected.code &&
    input.location === expected.location &&
    modifierMask(input) === expected.modifiers
  )
}

function matchesMouse(expected: ExpectedInputSignal, input: MouseInputEvent) {
  if (
    input.type !== expected.phase ||
    expected.x === undefined ||
    expected.y === undefined ||
    Math.abs(input.x - expected.x) > POINTER_COORDINATE_TOLERANCE ||
    Math.abs(input.y - expected.y) > POINTER_COORDINATE_TOLERANCE ||
    modifierMask(input) !== expected.modifiers
  ) {
    return false
  }
  if (expected.button !== undefined && input.button !== expected.button) return false
  if (expected.deltaX !== undefined && Reflect.get(input, 'deltaX') !== expected.deltaX)
    return false
  if (expected.deltaY !== undefined && Reflect.get(input, 'deltaY') !== expected.deltaY)
    return false
  return true
}

export class BrowserPreviewAutomationInputArbitrator {
  private readonly expected: ExpectedInputSignal[] = []
  private nextId = 1

  expect(
    method: string,
    params: Readonly<Record<string, unknown>> = {},
    now = Date.now(),
  ): number | null {
    this.prune(now)
    const signal = expectedSignal(this.nextId, method, params, now)
    if (!signal) return null
    this.nextId += 1
    this.expected.push(signal)
    if (this.expected.length > MAX_EXPECTED_INPUTS) this.expected.shift()
    return signal.id
  }

  cancel(id: number | null) {
    if (id === null) return
    const index = this.expected.findIndex((signal) => signal.id === id)
    if (index >= 0) this.expected.splice(index, 1)
  }

  consumeKeyboard(input: Input, now = Date.now()) {
    return this.consume((signal) => matchesKeyboard(signal, input), now)
  }

  consumeMouse(input: MouseInputEvent, now = Date.now()) {
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
    while (expired < this.expected.length && this.expected[expired]?.expiresAt < now) expired += 1
    if (expired > 0) this.expected.splice(0, expired)
  }
}
