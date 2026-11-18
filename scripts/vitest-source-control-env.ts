import { resolve } from 'node:path'

/**
 * Source-control host resolution reads the gh and glab config files (ADR 0048). Tests point both
 * CLIs at a directory that does not exist, so no test reads the developer's own sign-ins.
 */
export const ISOLATED_SOURCE_CONTROL_CLI_ENV = {
  GH_CONFIG_DIR: resolve('.vitest-no-source-control-cli-config/gh'),
  GLAB_CONFIG_DIR: resolve('.vitest-no-source-control-cli-config/glab'),
}
