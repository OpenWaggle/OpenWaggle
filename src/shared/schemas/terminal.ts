import { TERMINAL } from '@shared/constants/resource-limits'
import { Schema } from '@shared/schema'
import { isAllowedTerminalEnvironmentName } from '@shared/utils/terminal-environment'

const textEncoder = new TextEncoder()

const terminalEnvironmentValueSchema = Schema.String.pipe(
  Schema.maxLength(TERMINAL.ENV_VALUE_MAX_LENGTH),
  Schema.filter((value) => !value.includes('\0'), {
    message: () => 'Terminal environment values cannot contain NUL bytes.',
  }),
)

function environmentByteLength(environment: Readonly<Record<string, string>>) {
  let bytes = 0
  for (const [name, value] of Object.entries(environment)) {
    bytes += textEncoder.encode(name).byteLength + textEncoder.encode(value).byteLength
  }
  return bytes
}

export const terminalEnvironmentSchema = Schema.Record({
  key: Schema.String,
  value: terminalEnvironmentValueSchema,
}).pipe(
  Schema.filter(
    (environment) =>
      Object.keys(environment).every(
        (name) =>
          name.length <= TERMINAL.ENV_KEY_MAX_LENGTH && isAllowedTerminalEnvironmentName(name),
      ),
    { message: () => 'Terminal environment variable name is not allowed.' },
  ),
  Schema.filter((environment) => Object.keys(environment).length <= TERMINAL.ENV_MAX_ENTRIES, {
    message: () => 'Terminal environment has too many entries.',
  }),
  Schema.filter(
    (environment) => environmentByteLength(environment) <= TERMINAL.ENV_TOTAL_MAX_BYTES,
    { message: () => 'Terminal environment exceeds the byte limit.' },
  ),
)
