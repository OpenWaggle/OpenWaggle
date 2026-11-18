/**
 * A {@link BuildChannel} is the release stage a build belongs to. It is the
 * single axis that drives a build's identity (name, appId, icon, userData) and
 * the update feed it follows. See docs/adr/0032.
 *
 * The channel is provenance-gated: only the App release workflow stamps a
 * non-dev channel. Any build produced without that signal is `dev`. The channel
 * is never inferred from the version string, because every build off the
 * release train carries the same prerelease version whether released or not.
 */
export type BuildChannel = 'stable' | 'alpha' | 'beta' | 'rc' | 'dev'
