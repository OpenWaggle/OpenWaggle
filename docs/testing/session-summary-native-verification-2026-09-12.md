# Local native verification incident, 2026-09-12

## Scope and status

Local macOS arm64 verification of the Session Summary merge hit a native
`better-sqlite3@12.11.1` assertion after `pnpm verify` rebuilt native dependencies.
The earlier preparation used Node 24.12.0; the failing preparation and test workers
used a Vite+ managed Node 24.21.0. This was a change of local runtime and build
headers, not evidence that an Electron binary was loaded into Node.

The coordinated recovery run used Node 24.12.0 for both compilation and tests.
Full `pnpm verify` passed, including 5,052 unit tests across 893 files and one
platform-specific skip. The complete log is
`/tmp/openwaggle-sep12-merge-verify-node2412.log`. CI's pinned Node 24.14.0 checks
remain authoritative for the pull request.

## Observed evidence

The following logs were captured outside the repository on the diagnosing machine.
They are local evidence, not portable CI artifacts.

- `/tmp/openwaggle-merge-node-abi.log`, lines 7 and 10, records native compilation
  with `node@24.12.0 | darwin | arm64`. Its compiler arguments reference
  `/Users/diego.garciabrisa/Library/Caches/node-gyp/24.12.0/include/node`.
  The preparation completed and the subsequent SQLite migration tests passed.
- `/tmp/openwaggle-sep12-merge-verify.log`, lines 19 and 24, records compilation
  with `node@24.21.0 | darwin | arm64` and headers under the corresponding
  `node-gyp/24.21.0` directory. The Unix PTY lifecycle probe passed at line 167;
  the SQLite assertion first appears at line 173 during the unit suite.
- The crashing executable was
  `/Users/diego.garciabrisa/.vite-plus/js_runtime/node/24.21.0/bin/node`.
  The other agent shell resolved `/usr/local/bin/node`, version `v24.12.0`.
- At inspection time, the native rebuild marker
  `node_modules/.cache/openwaggle/native-rebuild/node-0b833f012e41ad17164b6c98841f5104.json`
  recorded `runtimeVersion: "24.21.0"` and
  `cacheVersion: "electron-builder-native-rebuild-v3"`. The rebuild cache tracks
  the exact runtime version; this was not a stale 24.12.0 cache hit.

The repeated crash signature was:

```text
void node::RemoveEnvironmentCleanupHook(Isolate *, CleanupHook, void *)
at ../src/api/hooks.cc:142
Assertion failed: (env) != nullptr

Statement::~Statement()
  .../better-sqlite3/build/Release/better_sqlite3.node
v8::internal::GlobalHandles::InvokeFirstPassWeakCallbacks()
```

## Header-level explanation

A direct diff of the installed Node headers found a relevant change in
`include/node/node_object_wrap.h`. Node 24.21.0 calls `AddCleanupHook()` in the
`ObjectWrap` constructor and `RemoveCleanupHook()` in its destructor. The latter
calls:

```cpp
RemoveEnvironmentCleanupHook(v8::Isolate::GetCurrent(), CleanupHook, this);
```

Neither call exists in the inspected Node 24.12.0 header. SQLite's `Statement`
inherits `node::ObjectWrap`, so rebuilding against 24.21.0 introduces this inline
destructor path into the addon. The crashing stack matches that new path. This
explains why testing an older-header build is not equivalent to rebuilding the
same addon against the newer runtime's headers, even within Node major version 24.

This evidence identifies the build/runtime condition and matching failing path.
It does not establish every context in which Node 24.21.0 fails, nor prove that
all Node 24.21.0 or Electron applications are affected.

## Scoped recovery and validation

Stop the failing verification process and confirm its workers have exited before
rebuilding. Coordinate with other agents because native artifacts are shared by
all shells in this checkout. Do not rebuild while a native test suite is running.

On this machine, the following commands select the previously successful runtime
without changing the user's global configuration:

```sh
env PATH="/usr/local/bin:$PATH" pnpm exec node --version
env PATH="/usr/local/bin:$PATH" pnpm verify
```

The first command was checked and returns `v24.12.0`. `pnpm verify` must perform
its normal native preparation and complete the full checks. Use the same scoped
PATH for a subsequently authorized push so its pre-push hook uses that runtime
too. Do not disable the hook, skip native preparation, suppress assertions, patch
the SQLite destructor, or treat a green load probe as a passing unit suite.

This is a local environment remedy, not a source fix for Node 24.21.0. No global
Node setting, application code, or native dependency source was changed for it.
Hosted CI pins Node 24.14.0 in `.github/workflows/ci.yml`; its results, and the
separate Electron checks, still have to pass on the final commit.
