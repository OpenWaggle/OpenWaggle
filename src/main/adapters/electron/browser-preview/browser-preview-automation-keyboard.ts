import { match } from '@diegogbrisa/ts-match'
import type {
  BrowserPreviewAutomationModifier,
  BrowserPreviewAutomationPressInput,
} from '@shared/types/browser-preview-automation'

interface KeyDefinition {
  readonly code: string
  readonly key: string
  readonly keyCode: number
  readonly text?: string
  readonly location?: number
  readonly shiftedKey?: string
}

export interface BrowserPreviewAutomationKeyEvent extends Readonly<Record<string, unknown>> {
  readonly type: 'keyDown' | 'rawKeyDown' | 'keyUp'
  readonly key: string
  readonly code: string
  readonly modifiers: number
  readonly windowsVirtualKeyCode: number
  readonly location: number
  readonly isKeypad: boolean
  readonly text?: string
  readonly unmodifiedText?: string
  readonly commands?: readonly string[]
}

export interface BrowserPreviewAutomationKeySequence {
  readonly keyDown: BrowserPreviewAutomationKeyEvent
  readonly keyUp: BrowserPreviewAutomationKeyEvent
}

const NAMED_KEYS: Readonly<Record<string, KeyDefinition>> = {
  Escape: { code: 'Escape', key: 'Escape', keyCode: 27 },
  Backspace: { code: 'Backspace', key: 'Backspace', keyCode: 8 },
  Tab: { code: 'Tab', key: 'Tab', keyCode: 9 },
  Enter: { code: 'Enter', key: 'Enter', keyCode: 13, text: '\r' },
  Shift: { code: 'ShiftLeft', key: 'Shift', keyCode: 16, location: 1 },
  Control: { code: 'ControlLeft', key: 'Control', keyCode: 17, location: 1 },
  Alt: { code: 'AltLeft', key: 'Alt', keyCode: 18, location: 1 },
  Meta: { code: 'MetaLeft', key: 'Meta', keyCode: 91, location: 1 },
  CapsLock: { code: 'CapsLock', key: 'CapsLock', keyCode: 20 },
  Space: { code: 'Space', key: ' ', keyCode: 32, text: ' ' },
  PageUp: { code: 'PageUp', key: 'PageUp', keyCode: 33 },
  PageDown: { code: 'PageDown', key: 'PageDown', keyCode: 34 },
  End: { code: 'End', key: 'End', keyCode: 35 },
  Home: { code: 'Home', key: 'Home', keyCode: 36 },
  ArrowLeft: { code: 'ArrowLeft', key: 'ArrowLeft', keyCode: 37 },
  ArrowUp: { code: 'ArrowUp', key: 'ArrowUp', keyCode: 38 },
  ArrowRight: { code: 'ArrowRight', key: 'ArrowRight', keyCode: 39 },
  ArrowDown: { code: 'ArrowDown', key: 'ArrowDown', keyCode: 40 },
  Insert: { code: 'Insert', key: 'Insert', keyCode: 45 },
  Delete: { code: 'Delete', key: 'Delete', keyCode: 46 },
}

const PRINTABLE_KEYS: readonly KeyDefinition[] = [
  { code: 'Backquote', key: '`', shiftedKey: '~', keyCode: 192 },
  { code: 'Digit1', key: '1', shiftedKey: '!', keyCode: 49 },
  { code: 'Digit2', key: '2', shiftedKey: '@', keyCode: 50 },
  { code: 'Digit3', key: '3', shiftedKey: '#', keyCode: 51 },
  { code: 'Digit4', key: '4', shiftedKey: '$', keyCode: 52 },
  { code: 'Digit5', key: '5', shiftedKey: '%', keyCode: 53 },
  { code: 'Digit6', key: '6', shiftedKey: '^', keyCode: 54 },
  { code: 'Digit7', key: '7', shiftedKey: '&', keyCode: 55 },
  { code: 'Digit8', key: '8', shiftedKey: '*', keyCode: 56 },
  { code: 'Digit9', key: '9', shiftedKey: '(', keyCode: 57 },
  { code: 'Digit0', key: '0', shiftedKey: ')', keyCode: 48 },
  { code: 'Minus', key: '-', shiftedKey: '_', keyCode: 189 },
  { code: 'Equal', key: '=', shiftedKey: '+', keyCode: 187 },
  { code: 'Backslash', key: '\\', shiftedKey: '|', keyCode: 220 },
  { code: 'BracketLeft', key: '[', shiftedKey: '{', keyCode: 219 },
  { code: 'BracketRight', key: ']', shiftedKey: '}', keyCode: 221 },
  { code: 'Semicolon', key: ';', shiftedKey: ':', keyCode: 186 },
  { code: 'Quote', key: "'", shiftedKey: '"', keyCode: 222 },
  { code: 'Comma', key: ',', shiftedKey: '<', keyCode: 188 },
  { code: 'Period', key: '.', shiftedKey: '>', keyCode: 190 },
  { code: 'Slash', key: '/', shiftedKey: '?', keyCode: 191 },
]

const MAC_EDITING_COMMANDS: Readonly<Record<string, string>> = {
  'Meta+Backspace': 'deleteToBeginningOfLine',
  'Meta+ArrowUp': 'moveToBeginningOfDocument',
  'Meta+ArrowDown': 'moveToEndOfDocument',
  'Meta+ArrowLeft': 'moveToLeftEndOfLine',
  'Meta+ArrowRight': 'moveToRightEndOfLine',
  'Shift+Meta+ArrowUp': 'moveToBeginningOfDocumentAndModifySelection',
  'Shift+Meta+ArrowDown': 'moveToEndOfDocumentAndModifySelection',
  'Shift+Meta+ArrowLeft': 'moveToLeftEndOfLineAndModifySelection',
  'Shift+Meta+ArrowRight': 'moveToRightEndOfLineAndModifySelection',
  'Meta+KeyA': 'selectAll',
  'Meta+KeyC': 'copy',
  'Meta+KeyX': 'cut',
  'Meta+KeyV': 'paste',
  'Meta+KeyZ': 'undo',
  'Shift+Meta+KeyZ': 'redo',
}

const MODIFIER_ORDER = ['Shift', 'Control', 'Alt', 'Meta'] as const
const ALT_MODIFIER_MASK = 1
const CONTROL_MODIFIER_MASK = 2
const META_MODIFIER_MASK = 4
const SHIFT_MODIFIER_MASK = 8
const FUNCTION_KEY_CODE_OFFSET = 111
const KEYPAD_LOCATION = 3

function modifierMask(modifiers: readonly BrowserPreviewAutomationModifier[]) {
  return modifiers.reduce(
    (mask, modifier) =>
      mask |
      match(modifier)
        .with('Alt', () => ALT_MODIFIER_MASK)
        .with('Control', () => CONTROL_MODIFIER_MASK)
        .with('Meta', () => META_MODIFIER_MASK)
        .with('Shift', () => SHIFT_MODIFIER_MASK)
        .exhaustive(),
    0,
  )
}

function functionKeyDefinition(key: string): KeyDefinition | null {
  const functionKey = /^F([1-9]|1[0-2])$/u.exec(key)
  if (functionKey?.[1]) {
    return {
      code: key,
      key,
      keyCode: FUNCTION_KEY_CODE_OFFSET + Number(functionKey[1]),
    }
  }
  return null
}

function letterKeyDefinition(input: BrowserPreviewAutomationPressInput): KeyDefinition | null {
  if (/^[a-z]$/iu.test(input.key)) {
    const upper = input.key.toUpperCase()
    const shifted = input.modifiers?.includes('Shift') ?? false
    const key = shifted || input.key === upper ? upper : input.key
    return { code: `Key${upper}`, key, keyCode: upper.charCodeAt(0), text: key }
  }
  return null
}

function printableKeyDefinition(input: BrowserPreviewAutomationPressInput): KeyDefinition | null {
  const printable = PRINTABLE_KEYS.find(
    (definition) => definition.key === input.key || definition.shiftedKey === input.key,
  )
  if (printable) {
    const shifted = input.modifiers?.includes('Shift') ?? false
    const key =
      printable.shiftedKey && (shifted || input.key === printable.shiftedKey)
        ? printable.shiftedKey
        : printable.key
    return { ...printable, key, text: key }
  }
  return null
}

function resolveKeyDefinition(input: BrowserPreviewAutomationPressInput): KeyDefinition {
  const known =
    NAMED_KEYS[input.key] ??
    functionKeyDefinition(input.key) ??
    letterKeyDefinition(input) ??
    printableKeyDefinition(input)
  if (known) return known
  return {
    code: input.key.length > 1 ? input.key : '',
    key: input.key,
    keyCode: 0,
    ...(input.key.length === 1 ? { text: input.key } : {}),
  }
}

function macEditingCommands(code: string, modifiers: readonly BrowserPreviewAutomationModifier[]) {
  const shortcut = [
    ...MODIFIER_ORDER.filter((modifier) => modifiers.includes(modifier)),
    code,
  ].join('+')
  const command = MAC_EDITING_COMMANDS[shortcut]
  return command ? [command] : []
}

export function makeBrowserPreviewAutomationKeySequence(
  input: BrowserPreviewAutomationPressInput,
  options: { readonly isMac: boolean },
): BrowserPreviewAutomationKeySequence {
  const definition = resolveKeyDefinition(input)
  const inputModifiers = input.modifiers ?? []
  const modifiers = modifierMask(inputModifiers)
  const suppressText = inputModifiers.some((modifier) => modifier !== 'Shift')
  const text = suppressText ? '' : (definition.text ?? '')
  const location = definition.location ?? 0
  const commands = options.isMac ? macEditingCommands(definition.code, inputModifiers) : []
  const shared = {
    key: definition.key,
    code: definition.code,
    modifiers,
    windowsVirtualKeyCode: definition.keyCode,
    location,
    isKeypad: location === KEYPAD_LOCATION,
  }
  return {
    keyDown: {
      type: text ? 'keyDown' : 'rawKeyDown',
      ...shared,
      ...(text ? { text, unmodifiedText: text } : {}),
      ...(commands.length > 0 ? { commands } : {}),
    },
    keyUp: { type: 'keyUp', ...shared },
  }
}
