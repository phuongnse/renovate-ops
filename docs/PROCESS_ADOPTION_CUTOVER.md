# Process adoption policy cutover

The immutable verifier and the repository adoption rule cannot change in one pull
request. Use three independently mergeable stages:

1. Merge this bridge while every engineering-process rule remains disabled and the
   global command allowlist remains empty. The previously pinned verifier approves
   this state. Resolve the exact resulting commit on protected main.
2. In separate pull requests, update each reusable-workflow caller to that exact main
   commit while keeping its process rule disabled. The bridge accepts both the legacy
   disabled state and the exact active state.
3. Only after every required caller pin is merged, enable the exact adoption rule and
   the single anchored global command. Merge consumer PRs before publishing 1.0.

Never combine stages, pin an unmerged verifier commit, use a mutable ref, or weaken a
required check. A later cleanup may remove legacy-disabled acceptance only after every
protected caller and repository config is active.
