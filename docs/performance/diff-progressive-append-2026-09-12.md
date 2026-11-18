# Progressive diff append performance

## Observed failure

The Windows job in [Full CI run 34686235969](https://github.com/OpenWaggle/OpenWaggle/actions/runs/34686235969), at commit `19e34537`, passed only after two retries. The aggregate green result was not treated as readiness evidence.

The existing large-diff E2E scenario records the whole interval from the user's click through both first visible code and completion of progressive preparation. The Windows main-thread task budget remains 125 ms.

| Measurement | First attempt | Retry 1 | Retry 2 |
| --- | ---: | ---: | ---: |
| First feedback | 11.6 ms | 10.6 ms | 11.9 ms |
| First visible code | 929.1 ms | 962.7 ms | 1,137.8 ms |
| Preparation complete | 4,988.1 ms | 5,798.3 ms | 1,247.5 ms |
| Longest observed task | 2,187 ms | 2,284 ms | 0 ms |

Zero means the observer recorded no qualifying long task in that interval, not that rendering cost nothing. These measurements are from hidden hosted Electron, not a general user-facing latency guarantee.

CPU profiles attached to the Playwright report showed substantial `getScrollTop` and `replaceCodeColumns` work in failing attempts, reached through React layout effects and Pierre's immediate render path. The earlier change to bound Playwright shadow-DOM probes did not eliminate this application-side work.

## Cause and fix

Progressive preparation publishes one file first, then batches of up to four files. Decorating each publication recreated every earlier `CodeViewItem` object. Pierre's React adapter detects append-only updates by comparing the prefix items by identity. The recreated wrappers failed that check, so each batch invoked `setItems` and an immediate render of the existing list.

The fix gives each diff view its own decorator cache, keyed weakly by parsed item identity. An unchanged parsed item and unchanged annotations retain the same decorated item. Appended files therefore use Pierre's append path. Annotation changes and new parsed revisions still produce updated items. The cache is not global and does not retain obsolete parsed items indefinitely.

## Verification

A regression uses the real Pierre React adapter and item reconciliation. Only the final DOM rendering method is intercepted because jsdom does not implement layout. Before the fix, a 1+4+4 publication made zero append calls. Afterward, it makes one initial `setItems` call and two `addItems` calls without additional immediate-render requests. This proves the integration contract, not the native latency budget.

Local hidden macOS Electron validation passed the large-diff scenario three times and the oversized-patch scenario once. The existing E2E feedback, visibility, preparation-completion, worker, error, and long-task assertions remain unchanged. Hosted results are tracked in [PR 179](https://github.com/OpenWaggle/OpenWaggle/pull/179). A retry-free Full CI run on the final pushed commit is still required before declaring readiness.
