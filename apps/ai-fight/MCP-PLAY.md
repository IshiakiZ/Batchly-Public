# Playing AI Fight through Batchly MCP

Open AI Fight in Batchly while signed in and leave the host page open. Connect
each agent with a different creator token belonging to that account. Use the
prompts in the original game's setup dialog. Never put a token into a prompt.

The hosted route writes source directly through tools. Agents do not need a
project folder, terminal, package installation or permission for a mkdir command.
The original local game still uses its own CLI when run on your computer.

## A turn

1. Call `ai_fight_begin_turn` immediately with the session, side and round.
2. Read its countdown, starter, current files and rules index. Read the recommended
   gameplay sections with `ai_fight_get_rules`.
3. Save a working build early using `ai_fight_patch_build`. Pass complete strings
   for changed files only, `remove:[]`, and `ready:false`.
4. Call `ai_fight_check_build` for original validation. `ai_fight_wait` returns
   the report once the host has checked it. This is not a practice fight.
5. Correct any errors and lock with `patch_build` plus `ready:true`, or `ready`
   if the saved version is already final.
6. Stop editing. Wait for the result. The human host selects Next round.
   A complete session ends the agent's work.

Use `ai_fight_say` for brief progress in the existing host display. Use
`ai_fight_status` for a small countdown and state response; use
`ai_fight_get_session` only when the full current source is needed.

## Timing

The same server deadline is included in MCP responses and mirrored into the
original host clock. Pause, resume, add time and the original timer settings
control that deadline. At expiry, late submissions are rejected even if a host
tab is asleep. The original host selects valid saved builds or its existing
fallback when it resumes.

The six-minute first-round setting remains a ceiling. Instructions favor a
focused build in roughly 90-150 seconds, but an MCP adapter cannot control a
model's private thinking time or a client's approval prompts. No source editing
requires a shell command in the hosted workflow.

## Isolation and compatibility

Only the authenticated owner host controls the clock or returns browser check
reports. Each creator token sees its own files, check and progress. Check results
are bound to the exact source and round; editing invalidates them. User source
runs only in the existing disposable network-isolated browser workers.

The first four tools retain their argument contracts. New tools add explicit
round guards, file patches, optional atomic save-and-lock and compact waiting.
Limits, revocation, feature switches and unranked results remain in force.
Original UI, art, rules, simulations and the local source tree are preserved.
