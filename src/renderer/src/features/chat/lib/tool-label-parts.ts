import type { JsonObject, JsonValue } from '@shared/types/json'

/** The text a transcript row shows for one tool call, by the call's phase. */
export interface ToolLabel {
  readonly running: string
  readonly done: string
  readonly requested: string
}

export interface Verbs {
  readonly running: string
  readonly done: string
}

const DETAIL_SEPARATOR = ' · '

export function stringArg(args: JsonObject, key: string) {
  const value = args[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function numberArg(args: JsonObject, key: string) {
  const value = args[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function objectArg(args: JsonObject, key: string): JsonObject | null {
  const value: JsonValue | undefined = args[key]
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null
}

export function arrayLength(args: JsonObject, key: string) {
  const value = args[key]
  return Array.isArray(value) ? value.length : null
}

export function withDetail(text: string, detail: string | null, separator = DETAIL_SEPARATOR) {
  return detail ? `${text}${separator}${detail}` : text
}

export function label(
  verbs: Verbs,
  detail: string | null,
  title: string,
  separator?: string,
): ToolLabel {
  return {
    running: `${withDetail(verbs.running, detail, separator)}...`,
    done: withDetail(verbs.done, detail, separator),
    requested: withDetail(`Requested ${title}`, detail),
  }
}

export function plural(count: number, noun: string) {
  return count === 1 ? `1 ${noun}` : `${String(count)} ${noun}s`
}
