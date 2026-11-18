// The one-line installer, defined once. `website/public/_redirects` sends `INSTALL_SCRIPT_URL` to
// `RAW_INSTALL_SCRIPT_URL`. Docs pages write the placeholders below instead of the values;
// `remarkInstallCommand` fills them in on the website, `scripts/installed-docs-generator.ts` in the
// docs bundled into the app, and `scripts/package-documentation.ts` in the npm package READMEs.
// README.md and scripts/install.sh cannot read this file, so `installer-url.unit.test.ts` fails
// when they drift from it.

/** The short address of `scripts/install.sh` on `main`, the one the docs tell people to use. */
export const INSTALL_SCRIPT_URL = 'https://openwaggle.ai/install'

/** Where `INSTALL_SCRIPT_URL` redirects: the script itself, for reading it before running it. */
export const RAW_INSTALL_SCRIPT_URL =
  'https://raw.githubusercontent.com/OpenWaggle/OpenWaggle/main/scripts/install.sh'

/** The documented install command. */
export const INSTALL_COMMAND = `curl -fsSL ${INSTALL_SCRIPT_URL} | bash`

/** Placeholders a docs page may write, each replaced by its value. */
export const INSTALL_PLACEHOLDERS: ReadonlyMap<string, string> = new Map([
  ['{{install-command}}', INSTALL_COMMAND],
  ['{{install-url}}', INSTALL_SCRIPT_URL],
  ['{{install-script-raw-url}}', RAW_INSTALL_SCRIPT_URL],
])

const PLACEHOLDER = /\{\{install-[^{}]*\}\}/gu

/** Replaces every install placeholder in `text`. An unknown `{{install-…}}` placeholder throws. */
export function substituteInstallPlaceholders(text: string) {
  return text.replaceAll(PLACEHOLDER, (placeholder) => {
    const value = INSTALL_PLACEHOLDERS.get(placeholder)
    if (value === undefined) throw new Error(`Unknown install placeholder ${placeholder}.`)
    return value
  })
}
