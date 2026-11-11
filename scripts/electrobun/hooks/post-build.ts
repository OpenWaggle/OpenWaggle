// Electrobun postBuild hook (scripts/electrobun/app-config.ts). Hutch imports hook files instead of
// running them, so this entry does its work at import time; scripts/electrobun/hooks-steps.ts says what.
import { electrobunPostBuild } from '../hooks-steps'

for (const line of await electrobunPostBuild(process.env)) console.log(`[postBuild] ${line}`)
