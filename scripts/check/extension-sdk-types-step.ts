/** The `extension-sdk-types` check step: the SDK's printed public types match their schemas. */
import { bunScript } from './step-helpers'
import type { CheckStep } from './step-model'

export const EXTENSION_SDK_TYPES_STEP: CheckStep = {
  id: 'extension-sdk-types',
  summary: "the extension SDK's public types match the schemas they are printed from",
  commands: [bunScript('scripts/generate-extension-sdk-types.ts', '--check')],
  inputs: [
    'packages/extension-sdk/src/**',
    'scripts/generate-extension-sdk-types.ts',
    'scripts/extension-sdk-types-printer.ts',
    // The generator compiles with this project and formats its output with oxfmt, whose version
    // the lockfile pins.
    'packages/extension-sdk/tsconfig.build.json',
    'tsconfig.package.base.json',
    '.oxfmtrc.json',
    'bun.lock',
  ],
  findings: 'generic',
  hint: 'bun run extension-sdk-types:generate',
}
