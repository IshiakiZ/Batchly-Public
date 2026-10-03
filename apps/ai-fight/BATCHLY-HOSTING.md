# Original UI hosting and shared MCP clock, r3

The custom r1 interface was rejected. The r3 release preserves the original public
HTML structure, all CSS, all JavaScript screens, and all four engines. Source in
D:/AI Fight and deployed r1 remain untouched. This document is the architecture
checkpoint. Verification evidence is recorded with each immutable release candidate.

## Exact original network surface

There is no WebSocket transport. `EventSource('/events')` carries `bootstrap`,
`state`, `card`, `feed`, `activity`, `presence`, `test`, `match`, and `toast` events.

| HTTP request | Original response/use |
| --- | --- |
| GET /api/bootstrap | Config, rules, modes, cards, state, feeds, tests, match, prompts |
| GET /api/replay/current | Current round replay |
| GET /api/replay/:match/:round | Archived round replay |
| GET /api/tests/:fighter | Practice replay |
| POST /api/exhibition {a,b,level} | Start isolated exhibition, return id |
| GET /api/exhibition/:id | Exhibition replay, last six retained |
| GET /api/match | Current match record |
| GET /api/match/:id | Prior match record |
| GET /api/history | Match history |
| GET /api/csv/:name | rounds, matches, or mode-rounds CSV download |
| POST /api/host/next | Advance after round |
| POST /api/host/end | End current match |
| POST /api/host/force-start | Lock valid current files and start |
| POST /api/host/new-match | New match, selected mode |
| POST /api/host/clock-start | Start build clock |
| POST /api/host/clock-pause | Pause build clock |
| POST /api/host/clock-resume | Resume build clock |
| POST /api/host/clock-add | Add original time increment |
| POST /api/host/settings | Original timing/impact-freeze settings |
| POST /api/host/predict | Spectator prediction |

## Hosting adapter

An adapter installed before original app.js implements only the original local
HTTP/SSE transport. The original server's state machine runs in a network-isolated
browser Worker with virtual, bounded in-memory files. No real Node server is exposed.
Simulation jobs use a separate disposable network-isolated Worker and watchdog.
All brain execution, including load checks and the original smoke checks, runs in
disposable Workers. The persistent server consumes cached validation data and has
an explicit `noBrainExecution` guard. Validation messages cannot become server SSE.
The outer coordinator has no credentials and treats Worker output as untrusted.
Original source files are copied unchanged; only generated asset URLs and the
entry script are adjusted for the /ext/ai-fight-r3/ hosting prefix. Original setup
prompt wording is adapted to the actual MCP connection and tool names.

The opaque outer frame delegates durable files to the Batchly parent's IndexedDB.
The parent scopes storage to the current account or guest without exposing account
IDs or credentials. Original history, replays, fighter files, settings and CSV data
are restored before the original server starts. A failed load never starts a fresh
server or overwrites unknown history. Only the explicit auth-hydration error is
retried, at most eight attempts spaced 500 ms apart.

The exact request is `{type:'ai-fight-storage-request',requestId,action,args}`.
Load uses `action:'load',args:{}` and returns
`{type:'ai-fight-storage-response',requestId,result:{ok:true,revision,files}}`, with
`files:null` only for genuinely new storage. Save uses
`action:'save',args:{expected_revision,files}` and returns `{ok:true,revision}`.
Errors return `{ok:false,error}`. The parent atomically compares revisions to
prevent another tab's history being overwritten. A conflict or save failure stops
further saves and appears in the original toast. Account changes remount the frame.
The file map permits only data/, fighters/, results/ and prompts/, at most 3000
files and 64 MiB of UTF-8 JSON. Ordinary mutations debounce for 800 ms; state,
round, match and explicit host-action boundaries request an immediate snapshot.
Session binding metadata is stored as data/batchly-host.json. No new UI is added.

## Shared account-session contract constraint

The live get/complete/next bridge supports build exchange and normal round advancement.
Migration 218 and the shared owner bridge implement the additive actions below for
original New Match, End Match and Force Start before both agents lock. Main and
Noether own that integration. Migration 217 is frozen. No backend/shared files are
edited in this restoration lane.
Setup prompt text is an MCP adaptation; it must explain actual available tools instead
of telling remote ChatGPT/Claude to run the local arena.js CLI.

## Exact additive owner host actions

Keep existing get/complete/next and their response contracts unchanged. New actions
on the same JWT endpoint use `{action,args}` and return `{ok:true,session}` or
`{ok:false,error}`. They are browser-owner actions, never creator-token actions.

- `create`: `{mode}`. Create a fresh session under current quotas. Return the new
  session ID; mode is fighter/army/war/business. New token claims start empty. The
  original New Match adapter calls end, then create. A quota failure remains visible
  in the original UI and leaves the prior match ended, with its results preserved.
- `end`: `{session_id, expected_revision}`. Complete the owned session. Preserve
  its last result and build data. No deletion.
- `force_start`: `{session_id, expected_revision, files:[files0,files1]}`. While
  building, freeze the supplied validated local snapshots, set ready to both true,
  phase ready, increment revision. Preserve existing token bindings. Each file map
  uses existing path, file-count and 64 KiB byte limits. The browser owns execution
  validation; backend never executes source. The build-clock timeout can choose
  previous valid files or the starter, which is why exact locked builds are supplied.

All require a current owner, current account/feature gates, and existing rate limits;
end and force_start require matching revision. Explicit Force Start rejects invalid
current files. Clock expiry falls back to previous valid files, then starter. Missing
database files use the original local starter installed for that side. Update the
parent session query after create without reloading this
running game. The adapter retains durable original history across new matches.

Each simulation is bound to its original local match ID, account session ID, round,
ready revision and exact confirmed build contents. A newer remotely locked build
causes the original locks/job to be rebuilt before execution. Completion captures
that target before reading a replay and discards continuations after a match or
round generation changes. Browser results remain unranked.

## Shared timing and efficient MCP turns

Migration 219 adds server-authoritative timing without changing the RPC signature or
existing account/token permissions. Every session response carries clock, clock_settings,
host_online, checks and activity. Token responses expose only that token's side data.
The original clock controls call the authenticated owner endpoint with action clock,
expected_round and command start/pause/resume/add/settings. Prediction stays local.
Changing future settings never revives an expired current clock. Adds before start,
paused time and automatic expiry match the original game's semantics.

Agents call begin_turn first, patch only changed file strings, and optionally set ready
in the same patch. No shell, mkdir or local CLI is involved. Legacy submit/ready remain
compatible. A shared deadline rejects late writes even if the host tab is sleeping.
Round and revision guards prevent a delayed reply from editing the next round.

check_build queues a job bound to the exact source hash and round. The host runs the
original validator and smoke check in the existing disposable network-isolated worker,
then posts check_result. The database validates the binding again. Reports are bounded
below 8192 JSON bytes and cannot change a build. say mirrors actual agent progress in
the original feed. There are no simulated agent messages.

Host heartbeat polls update only clock/status when source is unchanged. They do not
revalidate the same source or repeatedly persist entire histories. Compact status and
bounded wait omit sources; wait checks at four-second intervals for up to twenty seconds.
Gameplay rules are selectable by section, with obsolete local setup instructions removed.
Practice sparring remains local-only. The adapter cannot control a model's thinking time.
See MCP-PLAY.md for setup and the complete hosted workflow.

## Assets

Public source excludes licensed audio recordings. Original sound code and controls
are preserved. Original bundled fonts with their OFL notice are retained. A separate
private hosted build includes existing recordings, as explicitly authorized by the
user for the original game online. Hosted manifests set `includeAudio:true` and
list hashes in `packaged`; the public source build sets `includeAudio:false` and
contains original UI in web/, unchanged original source, adapter source and OFL.
No asset is uploaded by this lane. No private data/results/fighters/prompts folders
or recordings are copied into the public package.

## Verification and restore

Run `node --test game-src/ai-fight/original-ui/*.test.mjs` for focused
session-transition, exact locked-string, no-brain-server and storage retry checks.
The local QA host uses the same opaque outer sandbox and recorded parent CSP;
positive API checks exercise all four original engines, clock controls, automatic
lock, prediction, settings, exhibitions and unranked replay results. Main owns
live account-token verification and publication. Independent final adversarial
review was stopped and is not claimed complete.

The original D:/AI Fight tree and live r1 remain untouched. Publish r3 only to the
fresh /ext/ai-fight-r3/ prefix, then change the catalog URL separately. Rollback is
the prior catalog URL; keep both asset prefixes and existing migrations/data.
