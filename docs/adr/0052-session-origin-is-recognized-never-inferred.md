# Session Origin Is Recognized, Never Inferred

Status: accepted

The Usage & Cost view needs to show users what they ran in each tool, but Pi does not record which client started a session. We use the **Session origin** filter's two buckets — **OpenWaggle** and **Other Pi clients** — and recognize OpenWaggle sessions only by OpenWaggle's own session entries (the `openwaggle-*` custom entries the Session Host has appended since the durable Session Host shipped, September 2026). We do not infer origin from directory names, paths, titles, or timing, because a wrong "OpenWaggle" label destroys trust in the totals faster than a coarse bucket does.

Considered and rejected: origin heuristics over cwd/agent-definition metadata (guesswork presented as fact), and an OpenWaggle-only totals mode (hides real spend the user can see on their provider's bill, contradicting the view's purpose). Consequence: any Pi session from before the Session Host stamp — including OpenWaggle's own oldest sessions — counts as **Other Pi clients**, a shrinking blind spot we accept rather than paper over with inference. If Pi later records a client identifier natively, the recognition rule can be widened without changing the two-bucket model.
