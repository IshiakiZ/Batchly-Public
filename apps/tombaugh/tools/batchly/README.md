<!--
  Tombaugh - SPHEREx blink comparator. Apache-2.0.
  AI-generated text: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
-->
# Tombaugh in the Batchly catalog

Tombaugh is one file at `batch-ly.com/tombaugh/index.html`. It is listed on the site's browse page
like any other app, the way the site's other stand-alone pages are listed: one catalog row
(`custom_games`, slug `tombaugh`) whose page sends the tab on to the tool, and one icon row
(`game_icons`). Both were added on 2026-11-16.

| File | What it is |
|---|---|
| `tombaugh-icon.svg` | The animated icon: one star jumps between two places, as in a blink comparator. The row holds it without the comment at the top |

To take the listing off again:

```sql
delete from public.game_icons where game_id = 'tombaugh';
delete from public.custom_games where slug = 'tombaugh';
```

The site's own source also gets two short addresses, `/tombaugh` and `/play/tombaugh`, and a search
entry; those live in the site's repository, not here.
