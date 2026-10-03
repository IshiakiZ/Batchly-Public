# AI Fight, silent source edition

Two AI agents design fighters, armies or companies, then compete through 12 evolving
rounds. Includes the original Fighter Duel, Army Battle, Modern Warfare and Business
Tycoon engines, JavaScript brains, built-in opponents and procedural renderers.
No audio, bundled fonts or external font downloads.

## Play the browser edition

Serve `web/` from a static HTTP server and open its index.html. It needs no account for
local play. Each simulation runs in a disposable browser Worker inside an opaque iframe
with network access blocked. Export/import builds to preserve them, especially when
embedded in Batchly's opaque game frame, which cannot use localStorage.

The hosted asset prefix is `/ext/ai-fight-r1/`. Serve every file with the correct MIME
type and `Access-Control-Allow-Origin: *` because the outer game frame is opaque too.
Do not add a restrictive CSP that prevents inline srcdoc scripts, blob Workers or
browser compilation of brain JavaScript. The inner frame applies its stricter CSP.
No credentials enter either frame. Results are unranked and may be forged by a brain.

For Batchly MCP sessions, connect each agent with a separate creator token belonging
to the same account, create a session, and open its host URL while signed in. Keep the
host page open to validate and simulate both ready builds. Account transport requires
the Batchly host bridge, migration and endpoint; this source package does not deploy them.

## Run locally

Install Node.js, extract this package into a new folder, and run `node server.js`.
Open http://localhost:3000. No dependency installation is needed. The server binds
to 127.0.0.1. Use `AIFIGHT_PORT` to select a different unused port if needed.

Open Menu, then Setup & prompts. Use trusted local coding agents with filesystem
access to this extracted folder. Read LOCAL-GUIDE.md and the mode's rulebook.
The server creates fresh fighters, data, prompts and results in this folder.
Those folders are deliberately excluded from publication and from source control.

Only run fighter code you trust. See SECURITY.md. The Node VM contexts limit runtime
but do not make arbitrary internet-submitted code safe.

## Rebuild the browser edition

Run `node build-web.mjs . ./web-rebuilt` from this folder with Node 22 or newer.
The output must be a fresh directory. No package installation is needed.
Original source hashes are pinned in source-inputs.json; intentionally changing
the original source requires reviewing and updating those hashes before rebuilding.

The original local server is retained for trusted local coding-agent play only.
Do not expose server.js to the internet. Opening public/index.html alone does not
run either edition; `web/index.html` is the portable static browser entry.

## Source and assets

LICENSE-MANIFEST.json lists every packaged file with its SHA-256 and provenance.
Audio recordings, bundled fonts, font-generation tools, match histories and user
fighters are excluded. The renderer uses procedural canvas drawings and SVG source.
See LICENSE-NOTICE.md for the source-license status. This package makes no claim
that external asset rights were independently audited.
