import { isRecord } from '@shared/utils/validation'

const SECRET_NAME_SEPARATORS = /[^A-Za-z0-9_]+/g
const VALUE_MAPS = ['env', 'headers'] as const

/**
 * The vault secret one server's field reads: `<SERVER>_<FIELD>`, so two servers with an
 * `Authorization` header or an `API_KEY` never read each other's secret.
 */
export function mcpServerSecretName(serverName: string, fieldName: string) {
  return `${serverName}_${fieldName}`.replace(SECRET_NAME_SEPARATORS, '_').toUpperCase()
}

function scopedValues(values: unknown, serverName: string, secrets: Set<string>) {
  if (!isRecord(values)) return values
  return Object.fromEntries(
    Object.entries(values).map(([field, value]) => {
      if (!isRecord(value) || typeof value.secret !== 'string') return [field, value]
      const secret = mcpServerSecretName(serverName, value.secret)
      secrets.add(secret)
      return [field, { secret }]
    }),
  )
}

/**
 * An entry whose `env` and `headers` vault references (named after their field) are named after
 * the server it is saved as, with the secrets it then reads.
 */
export function withServerSecretNames(
  entry: Readonly<Record<string, unknown>>,
  serverName: string,
) {
  const secrets = new Set<string>()
  const scoped: Record<string, unknown> = { ...entry }
  for (const map of VALUE_MAPS) {
    if (map in entry) scoped[map] = scopedValues(entry[map], serverName, secrets)
  }
  return { entry: scoped, secrets: [...secrets].sort() }
}
