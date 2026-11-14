# Main build split, re-measured on packaged apps (November 2026)

The main process stays one file (`codeSplitting: false` in `electron.vite.config.ts`). A-F6 made that call in October, when the split build was slower at every startup milestone of the packaged app (`.agents/memory/performance.md`, "What every process pays before OpenWaggle code runs"). This re-measurement on #450 confirms it. Splitting makes the window faster, but it makes the Session Host slower on every launch, and the Session list does not become ready any sooner.

## Result

Paired medians, split build minus one-file build. Negative is faster.

| Metric | Cold launch | Warm launch |
|---|---|---|
| Window ready | −156 to −262 ms | −53 to −72 ms |
| `main-window-created` mark | −175 to −233 ms | −54 to −56 ms |
| Host `host-file-logger-ready` → `host-listening` | +138 to +162 ms | +62 to +70 ms |
| Chat ready | −67, −79 and +142 ms | +11 and −6 ms |

Cold has three runs and warm has two (see [Runs](#runs)). Each range covers all of them. Chat ready is listed per run because it is not consistently better.

With the split, the Session Host loads 213 chunks at startup, 10.6 MB (10,606,954 bytes), from `app.asar`. The window loads 124 chunks, 3.1 MB (3,085,638 bytes). The build emits 305 main chunks, figures from `bun run check:main-bundle`. The Host's time from `host-file-logger-ready` to `host-listening` was slower in every pair of every run (0 of 8 or 10 faster). The window's gain is real, but the Host's loss lands on the same path to the Session list.

The split build also fails `check:main-bundle` as it stands. Two chunks are made only of virtual modules (`\0rolldown/runtime.js` and the lazy `better-sqlite3` stand-in), and they have no source map. Adopting the split would need the check to skip such chunks.

## A variant not built

One variant would split only the window's graph and keep a one-file entry for the Host. That could keep the window's gain without the Host's loss. The Host's entry would then carry its own copy of most of the bundle, about 16 MB more in the package. This is an estimate from the one-file bundle's size; the variant was not built or measured.

## When to revisit

Revisit the split once the Host's startup work becomes lazy. Today the Host imports and evaluates most of the bundle before it listens (`importSessionHostStartup` in `src/main/session-host-cli-entry.ts`), so with the split it reads 213 chunks first. A Host that listens after a small startup graph would stop paying for the chunks, and the window's gain would remain. At that point, re-run the measurement below.

## Method

- **Builds:** both builds come from #450 at `86bea7948`, packaged with `electron-builder --dir` for macOS arm64 without signing. The split build differs only by dropping `codeSplitting: false` from the main build's Rolldown output options. Electron 43.2.0.
- **Harness:** `launchUntilChatReady` from `scripts/perf-gate/ab-launch.ts` (the Performance Gate's launcher), driven by a throwaway script that alternates the two builds each round. Each round launches each build on a new scratch profile (`createScratchProfile`) with the fake provider. That first launch is the cold launch. After `host stop`, the same profile is launched again for the warm launch. Round 0 is a warm-up and is dropped.
- **What is read:** the harness's window-ready, backend-ready and chat-ready timings. The window's startup marks come from its output, and the Host's marks from the Host log in the profile. Both are process uptime.
- **Machine:** Apple M4 Max, 14 cores, 36 GB, macOS 26.6.2. 1-minute load averages were about 5 to 6, from unrelated work.

## Runs

All runs were on 2026-11-13.

| Run | Launches | Pairs | Notes |
|---|---|---|---|
| 1 | cold | 10 | |
| 2 | cold and warm | 8 | the app quit right after chat ready |
| 3 | cold and warm | 8 | the app idled 4.5 s after chat ready, so the compile cache's first write, 3 s after start, lands before it quits |

Run 1: window ready −234 ms, chat ready −67 ms, Host +148 ms.

Run 2: cold window ready −262 ms, chat ready −79 ms, Host +138 ms. Warm window ready −72 ms, chat ready +11 ms, Host +62 ms.

Run 3: cold window ready −156 ms, chat ready +142 ms, Host +162 ms. Warm window ready −53 ms, chat ready −6 ms, Host +71 ms.
