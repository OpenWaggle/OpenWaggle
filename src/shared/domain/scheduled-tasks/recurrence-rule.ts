import {
  RECURRENCE_FREQUENCIES,
  type RecurrenceFrequency,
  type RecurrenceRule,
  type RecurrenceRuleParse,
  type RecurrenceWeekday,
} from './recurrence-types'

/** RFC 5545 weekday codes and their ISO weekday numbers. */
const WEEKDAY_NUMBERS: ReadonlyMap<string, number> = new Map(
  ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'].map((code, index) => [code, index + 1]),
)

const MAX_INTERVAL = 1000
const MAX_LIST_ITEMS = 60
const MAX_ORDINAL = 5
const MAX_HOUR = 23
const MAX_MINUTE = 59
const MAX_MONTH = 12
const MAX_MONTH_DAY = 31

function parseIntegerList(value: string, minimum: number, maximum: number, allowNegative = false) {
  const items = value.split(',')
  if (items.length === 0 || items.length > MAX_LIST_ITEMS) return null
  const parsed: number[] = []
  for (const item of items) {
    if (!/^[+-]?\d{1,3}$/.test(item)) return null
    const number = Number(item)
    const magnitude = Math.abs(number)
    if (number < 0 && !allowNegative) return null
    if (magnitude < minimum || magnitude > maximum) return null
    parsed.push(number)
  }
  return [...new Set(parsed)].sort((left, right) => left - right)
}

function parseWeekdays(value: string) {
  const items = value.split(',')
  if (items.length === 0 || items.length > MAX_LIST_ITEMS) return null
  const parsed: RecurrenceWeekday[] = []
  for (const item of items) {
    const match = /^(?<ordinal>[+-]?\d)?(?<code>MO|TU|WE|TH|FR|SA|SU)$/.exec(item)
    const weekday = WEEKDAY_NUMBERS.get(match?.groups?.code ?? '')
    if (weekday === undefined) return null
    const ordinalText = match?.groups?.ordinal
    if (ordinalText === undefined) {
      parsed.push({ weekday })
      continue
    }
    const ordinal = Number(ordinalText)
    if (ordinal === 0 || Math.abs(ordinal) > MAX_ORDINAL) return null
    parsed.push({ weekday, ordinal })
  }
  return parsed
}

function parseFrequency(value: string) {
  return RECURRENCE_FREQUENCIES.find((frequency) => frequency === value)
}

interface MutableRule {
  frequency?: RecurrenceFrequency
  interval: number
  byWeekday?: readonly RecurrenceWeekday[]
  byMonthDay?: readonly number[]
  byMonth?: readonly number[]
  byHour?: readonly number[]
  byMinute?: readonly number[]
}

type PartParser = (rule: MutableRule, value: string) => string | null

function listPart(
  key: 'byMonthDay' | 'byMonth' | 'byHour' | 'byMinute',
  name: string,
  range: { readonly minimum: number; readonly maximum: number; readonly negative?: boolean },
): PartParser {
  return (rule, value) => {
    const parsed = parseIntegerList(value, range.minimum, range.maximum, range.negative)
    if (!parsed) return `${name}=${value} is not valid.`
    rule[key] = parsed
    return null
  }
}

function unsupportedEnd(name: string): PartParser {
  return () => `${name} is not supported: use the task's end date or run count instead.`
}

const PART_PARSERS: Readonly<Record<string, PartParser>> = {
  FREQ: (rule, value) => {
    const frequency = parseFrequency(value)
    if (!frequency) return `FREQ=${value} is not supported.`
    rule.frequency = frequency
    return null
  },
  INTERVAL: (rule, value) => {
    if (!/^\d{1,4}$/.test(value) || Number(value) < 1 || Number(value) > MAX_INTERVAL) {
      return 'INTERVAL must be a whole number from 1 to 1000.'
    }
    rule.interval = Number(value)
    return null
  },
  BYDAY: (rule, value) => {
    const weekdays = parseWeekdays(value)
    if (!weekdays) return `BYDAY=${value} is not valid.`
    rule.byWeekday = weekdays
    return null
  },
  BYMONTHDAY: listPart('byMonthDay', 'BYMONTHDAY', {
    minimum: 1,
    maximum: MAX_MONTH_DAY,
    negative: true,
  }),
  BYMONTH: listPart('byMonth', 'BYMONTH', { minimum: 1, maximum: MAX_MONTH }),
  BYHOUR: listPart('byHour', 'BYHOUR', { minimum: 0, maximum: MAX_HOUR }),
  BYMINUTE: listPart('byMinute', 'BYMINUTE', { minimum: 0, maximum: MAX_MINUTE }),
  BYSECOND: (_rule, value) => (value === '0' ? null : 'BYSECOND must be 0.'),
  WKST: (_rule, value) => (value === 'MO' ? null : 'WKST must be MO.'),
  DTSTART: unsupportedEnd('DTSTART'),
  UNTIL: unsupportedEnd('UNTIL'),
  COUNT: unsupportedEnd('COUNT'),
}

function applyPart(rule: MutableRule, name: string, value: string) {
  const parser = PART_PARSERS[name]
  return parser ? parser(rule, value) : `${name} is not supported.`
}

function validateCombination(rule: RecurrenceRule): string | null {
  const ordinalWeekdays = rule.byWeekday?.some((weekday) => weekday.ordinal !== undefined)
  if (ordinalWeekdays && rule.frequency !== 'MONTHLY' && rule.frequency !== 'YEARLY') {
    return 'A numbered BYDAY such as 2TU needs FREQ=MONTHLY or FREQ=YEARLY.'
  }
  if (ordinalWeekdays && rule.frequency === 'YEARLY' && !rule.byMonth) {
    return 'A numbered BYDAY with FREQ=YEARLY needs BYMONTH.'
  }
  if (rule.frequency === 'MINUTELY' && rule.byMinute) {
    return 'FREQ=MINUTELY cannot be combined with BYMINUTE.'
  }
  if ((rule.frequency === 'MINUTELY' || rule.frequency === 'HOURLY') && rule.byMonthDay) {
    return `FREQ=${rule.frequency} cannot be combined with BYMONTHDAY.`
  }
  return null
}

/** Parses a recurrence rule, with or without its `RRULE:` prefix. */
export function parseRecurrenceRule(text: string): RecurrenceRuleParse {
  const body = text.trim().replace(/^RRULE:/i, '')
  if (!body) return { ok: false, message: 'The recurrence rule is empty.' }
  const rule: MutableRule = { interval: 1 }
  const seen = new Set<string>()
  for (const part of body.split(';')) {
    if (!part) continue
    const separator = part.indexOf('=')
    if (separator <= 0) return { ok: false, message: `"${part}" is not NAME=VALUE.` }
    const name = part.slice(0, separator).toUpperCase()
    const value = part.slice(separator + 1).toUpperCase()
    if (seen.has(name)) return { ok: false, message: `${name} appears twice.` }
    seen.add(name)
    const error = applyPart(rule, name, value)
    if (error) return { ok: false, message: error }
  }
  if (!rule.frequency) return { ok: false, message: 'The recurrence rule needs FREQ.' }
  const parsed: RecurrenceRule = { ...rule, frequency: rule.frequency }
  const combination = validateCombination(parsed)
  return combination ? { ok: false, message: combination } : { ok: true, rule: parsed }
}
