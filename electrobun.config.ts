/**
 * OpenWaggle's Electrobun build (ADR 0064). Hutch reads this file; the configuration itself lives in
 * scripts/electrobun/app-config.ts. Package with `bun scripts/electrobun/package.ts`, which stages
 * the app first (docs/release-and-versioning.md, "Electrobun packaging").
 */
import { currentElectrobunAppConfig, packageVersion } from './scripts/electrobun/app-config'

export default currentElectrobunAppConfig(process.env, packageVersion(import.meta.dirname))
