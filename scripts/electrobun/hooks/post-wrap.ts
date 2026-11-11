// Electrobun postWrap hook (scripts/electrobun/app-config.ts). Hutch imports hook files instead of
// running them, so this entry does its work at import time; scripts/electrobun/hooks-steps.ts says what.
import { electrobunPostWrap } from '../hooks-steps'

for (const line of await electrobunPostWrap(process.env)) console.log(`[postWrap] ${line}`)
