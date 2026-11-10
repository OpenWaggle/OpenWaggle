import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import vm from 'node:vm'

const require = createRequire(import.meta.url)
const PLAYWRIGHT_CORE_PACKAGE = 'playwright-core/package.json'
const PLAYWRIGHT_PACKAGE = 'playwright/package.json'
const CORE_BUNDLE_PATH = 'lib/coreBundle.js'
const INJECTED_SOURCE_SECTION = '// packages/playwright-core/src/generated/injectedScriptSource.ts'
const SOURCE_ASSIGNMENT = /source\d+ = /
const SOURCE_TERMINATOR = ';\n  }\n});'
const MINIMUM_SOURCE_LENGTH = 100_000
const SOURCE_EVALUATION_TIMEOUT_MS = 1_000

let installationExpression: Promise<string> | null = null

function resolvePlaywrightCorePackage() {
  try {
    return require.resolve(PLAYWRIGHT_CORE_PACKAGE)
  } catch (directError) {
    try {
      const playwrightPackage = require.resolve(PLAYWRIGHT_PACKAGE)
      return path.join(path.dirname(path.dirname(playwrightPackage)), PLAYWRIGHT_CORE_PACKAGE)
    } catch {
      throw new Error('The packaged Playwright core runtime could not be resolved.', {
        cause: directError,
      })
    }
  }
}

export function extractPlaywrightInjectedSource(
  coreBundle: string,
  minimumLength = MINIMUM_SOURCE_LENGTH,
) {
  const sectionIndex = coreBundle.indexOf(INJECTED_SOURCE_SECTION)
  if (sectionIndex < 0) throw new Error('Playwright injected-runtime section was not found.')
  const sourceSection = coreBundle.slice(sectionIndex)
  const assignment = SOURCE_ASSIGNMENT.exec(sourceSection)
  if (assignment?.index === undefined) {
    throw new Error('Playwright injected-runtime assignment was not found.')
  }
  const literalStart = sectionIndex + assignment.index + assignment[0].length
  const literalEnd = coreBundle.indexOf(SOURCE_TERMINATOR, literalStart)
  if (literalEnd < 0) throw new Error('Playwright injected-runtime terminator was not found.')
  const literal = coreBundle.slice(literalStart, literalEnd)
  const source: unknown = vm.runInContext(literal, vm.createContext(), {
    timeout: SOURCE_EVALUATION_TIMEOUT_MS,
  })
  if (typeof source !== 'string' || source.length < minimumLength) {
    throw new Error('Playwright injected runtime was malformed or unexpectedly small.')
  }
  return source
}

async function buildInstallationExpression() {
  const packageJsonPath = resolvePlaywrightCorePackage()
  const bundlePath = path.join(path.dirname(packageJsonPath), CORE_BUNDLE_PATH)
  const coreBundle = await fs.readFile(bundlePath, 'utf8')
  const source = extractPlaywrightInjectedSource(coreBundle)
  const options = JSON.stringify({
    isUnderTest: false,
    sdkLanguage: 'javascript',
    testIdAttributeName: 'data-testid',
    stableRafCount: 1,
    browserName: 'chromium',
    shouldPrependErrorPrefix: false,
    isUtilityWorld: false,
    customEngines: [],
  })
  return `(() => {
    if (globalThis.__openWagglePlaywrightInjected) return true;
    const module = { exports: {} };
    ${source}
    globalThis.__openWagglePlaywrightInjected = new (module.exports.InjectedScript())(globalThis, ${options});
    return true;
  })()`
}

export function playwrightInjectedRuntimeInstallExpression() {
  installationExpression ??= buildInstallationExpression().catch((error: unknown) => {
    installationExpression = null
    throw error
  })
  return installationExpression
}
