# Use of AI in Tombaugh

The 2026 Space Apps guide calls AI tools "Super Intelligence (SI)". This file is the full
disclosure behind the short statement in the submission form.

## Summary

- **The idea is human.** The concept, its name and its five ideas are Pearce Harshbarger's,
  written in their design note "Tombaugh: a blink comparator for the 102-color sky" (13 November
  2026). AI was not the source of the idea.
- **The code is AI-generated.** All source code and tests in this repository were written by
  Claude, an AI model made by Anthropic (model "Claude Fable 5.2"), used through Claude Code, under
  Pearce Harshbarger's direction.
- **The text is AI-drafted.** AI helped research public documentation and drafted the
  documentation and the submission text, which the team owner reviewed and edited.
- **No AI-generated images, video or audio** are used in the tool or the demonstration.

## What came from the human

| Item | Detail |
|---|---|
| The concept | A blink comparator for SPHEREx, named for Clyde Tombaugh |
| The key insight | SPHEREx never photographs a patch in the same colour twice, because a linear variable filter makes wavelength a function of pixel position. A naive blink movie therefore flickers from colour, not change. And with 6.15 arcsec pixels against 10.4 arcsec/yr for Barnard's Star, blinking alone will not show it |
| Idea 1 | Predicted-sky subtraction |
| Idea 2 | A distance dial that shifts frames by the parallax expected for a chosen distance and stacks them |
| Idea 3 | Molecule lenses that colour the field by chemistry |
| Idea 4 | A 16-year movie splicing SPHEREx onto WISE epochs, modelled on WiseView (not built) |
| Idea 5 | Fog of war: an all-sky map darkened wherever no one has yet looked |
| Direction | What to build first, what to cut, the look and the voice of the tool |
| Decisions | Choice of challenge, hosting, license, which limits to state, what not to claim |
| Review | Reading and testing what the AI produced; accepting, rejecting or redirecting it |
| Demonstration | Recording the demo on the live tool |
| Submission | Final wording, the form, the links |

## What the AI did

| Activity | Detail | Where the result is |
|---|---|---|
| Research of documentation | Read public IRSA and SPHEREx documentation and tutorial notebooks, the FITS WCS, SIP and HEALPix papers, and the archive interfaces of IRSA, Gaia and CDS. Examined real SPHEREx Level 2 files to establish the file layout (verify who ran these measurements and when) | "Verified facts about the data" in `CONTRACT.md` |
| Architecture proposal | Proposed the split into an edge-function proxy and a dependency-free browser app, the TBF1 frame format, and the module interfaces. The team owner approved it | `CONTRACT.md`, `docs/ARCHITECTURE.md` |
| All code | Every file under `proxy/`, `web/`, `tools/` and `test/`: FITS reader, archive clients, cache, science library, viewer, plots, page, bundler. Written in several parallel Claude Code sessions, each owning a set of files and working to the shared interface contract | The repository |
| Tests | Unit tests beside each module, synthetic SPHEREx-style test files and a synthetic sky, and the end-to-end browser test | `*.test.js`, `proxy/fixtures/`, `test/` |
| Draft texts | README, the documents in `docs/`, the explainer cards and interface copy in the tool, and the draft of the submission text | `README.md`, `docs/`, `web/src/ui/` |

## What the AI did not do

- It did not choose the challenge or originate the concept or any of the five ideas.
- It did not generate images, video, audio or logos. Graphics in the tool are drawn by code from
  data or from simple procedures; the demonstration is a screen recording.
- It did not produce any of the measurements that will be reported. Results come from running the
  tool on real SPHEREx data, and the documents hold placeholders until that has been done.
- It is not used at run time. Tombaugh contains no AI model and makes no calls to one. Everything
  the tool shows is computed deterministically from archive data by code that can be read.

## How AI-generated material is marked

- **Source files.** Every source file begins with:

  ```js
  // Tombaugh - SPHEREx blink comparator. Apache-2.0.
  // AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
  ```

- **Repository metadata.** `NOTICE` carries the AI-generation statement. Commits made by the AI
  carry a `Co-Authored-By: Claude` trailer (verify in the commit history).
- **Descriptive text.** The README, this file and the submission's SI field state it.
- **Images and video.** None are AI-generated, so no watermark is needed. If any AI-generated
  image or video is added later, it must carry a visible watermark saying so.
- **No NASA branding.** No NASA logos, insignia or wording that implies endorsement appear in the
  tool, the documents or the demonstration.

## Why the AI-generated code can be trusted as far as it is checked, and no further

Generated code can be wrong in ways that look right. The safeguards here are ordinary ones:

1. Facts about the data were measured on real files and written down before code was written
   against them.
2. Each module has unit tests, including a coordinate test against a real file header.
3. A synthetic sky with a known mover, a known variable and a known absorber exercises the whole
   chain.
4. The tool checks itself against an independent catalogue: the proper motion it measures is shown
   beside the one Gaia measured. That comparison on real data is the test that matters, and its
   result is recorded in [SCIENCE.md](SCIENCE.md) once it has been run.

## Tools

| Tool | Version | Use |
|---|---|---|
| Claude (Anthropic) | Claude Fable 5.2 | Research, architecture proposal, code, tests, draft text |
| Claude Code | (verify version) | The interface through which the model read and wrote files and ran tests |

No other AI tools were used (verify with the team owner before submission).
