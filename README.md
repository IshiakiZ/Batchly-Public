# Batchly: public games and architecture

[Play on Batchly](https://batch-ly.com) · [Browse downloadable games](catalog/README.md) · [How Batchly is made](docs/how-batchly-works.md)

This is the public companion to Batchly. It contains reviewed, asset-free game and app source from both the admin catalog and the community, plus an approachable technical overview of how the platform fits together. It is a fresh repository, not an export of the private platform's source or Git history.

## Download

Open the [game directory](catalog/README.md), choose an app, then open its file and choose **Download raw file**. To download everything, use **Code > Download ZIP** at the top of this repository.

- `catalog/admin/`: explicitly reviewed versions of selected admin uploads.
- `catalog/community/`: explicitly reviewed versions of selected published community games. Pending edits and rejected drafts are not exported.
- Each folder has a `metadata.json` with a live play link, dependencies, source URLs, file sizes and SHA-256 checksums.
- Overclocked, Aetherdrift and all unreviewed or asset-based applications are excluded.

Many HTML games are self-contained. Others use online libraries, fonts, APIs, or Batchly's account, save and leaderboard bridge. Those integrations do not become a standalone backend when downloaded. Python apps need a compatible Python runtime and the listed dependencies. External embedded games remain links or launchers: their third-party servers and private code are not copied.

## Automatic updates

A GitHub Actions workflow checks the public catalog and approved version list every 15 minutes and can also be run manually from **Actions > Mirror published games > Run workflow**. Publication plus explicit redistribution review is the boundary. `approved-games.json` pins the exact source checksums that have been cleared. New apps and changed versions stay excluded until reviewed; a licensed asset added to an existing game cannot quietly enter this repository. The exporter uses the same public API access available to a signed-out visitor. It does not use a Batchly account, admin MCP token, database password or service key.

GitHub schedules can be delayed, so this is an eventual mirror, not an instant publication guarantee. The dated catalog records each day's successful verification, even if no game changed. This also maintains repository activity while the catalog is quiet. Failed reads leave the previous mirror intact and fail the workflow visibly. [GitHub documents scheduling limitations here](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).

Only the generated `catalog/` directory is replaced. Unpublished items disappear from its current version on the next successful refresh. Previous public versions remain in Git history and may exist in other people's downloads. Removing an item from Batchly cannot recall those copies.

## Scope and rights

Game files are preserved as published, including embedded credits and notices. This repository does **not** grant a new blanket license over contributed games, third-party libraries, artwork, audio or branding. Follow each work's existing license and ask its author when reuse permissions are unclear. Public visibility and permission to redistribute or modify are different things.

The mirror excludes account records, emails, saves, scores, admin messages, private uploads, debug games, unpublished drafts, deployment credentials and private platform source. It never downloads uploaded asset folders, cover images, audio packs, font packs, models, textures or separately hosted game builds. Only the reviewed source files are copied. Static checks stop publication on recognizable credentials; they are not a guarantee that arbitrary uploaded code is safe to execute. GitHub serves these files as downloads, not as a hosted game application.

## Maintaining the mirror

Node.js 22 or newer is sufficient; there are no package dependencies.

```sh
node --test scripts/sync.test.mjs
node scripts/sync.mjs
```

Run these commands from this repository's root. The exporter downloads files as data and never executes game code. The workflow commits only `catalog/`. No additional repository secret is needed; GitHub supplies a repository-scoped token for its own commit.

Before adding or updating an approval, inspect the complete source for bundled or externally referenced licensed media and confirm redistribution rights. A public URL or an active subscription alone is not sufficient. Never bulk-approve catalog entries.

To report a broken download or request correction of attribution, open an issue with the public game URL. Do not include passwords, access tokens or private player data.
