import * as Schema from 'effect/Schema'
import {
  EXTENSION_THEME_COLOR_KEYS,
  EXTENSION_THEME_FOCUS_KEYS,
  EXTENSION_THEME_RADIUS_KEYS,
  EXTENSION_THEME_SHADOW_KEYS,
  EXTENSION_THEME_SPACING_KEYS,
  EXTENSION_THEME_TYPE_SCALE_ENTRY_KEYS,
  EXTENSION_THEME_TYPE_SCALE_KEYS,
} from '../theme-data.js'

/** An object with exactly these keys, each holding a value of `value`. */
function exactKeys<const TKey extends string, TValue, TEncoded>(
  keys: readonly [TKey, ...TKey[]],
  value: Schema.Schema<TValue, TEncoded>,
) {
  return Schema.Record({ key: Schema.Literal(...keys), value })
}

const themeTokensSchema = Schema.Struct({
  color: exactKeys(EXTENSION_THEME_COLOR_KEYS, Schema.String),
  typography: Schema.Struct({
    sansFamily: Schema.String,
    monoFamily: Schema.String,
    typeScale: exactKeys(
      EXTENSION_THEME_TYPE_SCALE_KEYS,
      exactKeys(EXTENSION_THEME_TYPE_SCALE_ENTRY_KEYS, Schema.String),
    ),
  }),
  spacing: exactKeys(EXTENSION_THEME_SPACING_KEYS, Schema.String),
  radius: exactKeys(EXTENSION_THEME_RADIUS_KEYS, Schema.String),
  shadow: exactKeys(EXTENSION_THEME_SHADOW_KEYS, Schema.String),
  focus: exactKeys(EXTENSION_THEME_FOCUS_KEYS, Schema.String),
})

/** Every token group holds exactly its declared keys; the theme itself may carry more fields. */
const exactThemeTokensSchema = themeTokensSchema.annotations({
  parseOptions: { onExcessProperty: 'error' },
})

export const extensionThemeSchema = Schema.Struct({
  colorScheme: Schema.Literal('dark', 'light', 'high-contrast-dark', 'high-contrast-light'),
  tokens: exactThemeTokensSchema,
  cssVariables: exactThemeTokensSchema,
})
