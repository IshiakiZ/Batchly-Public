# Demo script

A 30-second screen recording of the live tool, and a seven-slide alternative. The 2026 guide allows
either: a video of 30 seconds or less, or a deck of at most seven slides including the title and
intro slides. Public link, in English.

**Rule for this recording.** Show only what the live tool shows on real SPHEREx data. If a shot
does not show what its caption says, change the caption or drop the shot. Do not adjust the
footage to fit the script. Anything recorded on the synthetic development sky must say "synthetic
data" on screen.

The story has three beats and a close: **see it, measure it, know it**, then the link and the map.

## Before recording

1. Open each view below once, an hour before, so the frames are in the proxy cache and load fast.
2. Choose the detector for Barnard's Star by looking: use the one where the star's core has the
   fewest flagged frames (turn on `f` to check). The script assumes detector 3.
3. Write down what the motion meter shows. That number goes into the caption of shot 4.
4. Check each caption against the screen. Captions are the script; the voice-over is optional.

Starting URLs:

```
Shot 1   [LIVE-URL]?name=Barnard%27s%20Star&fov=4&det=3&view=exposures&gaia=0
Shot 2   [LIVE-URL]?name=Barnard%27s%20Star&fov=4&det=3&view=passes&gaia=1
Shot 3   [LIVE-URL]?name=Barnard%27s%20Star&fov=4&det=3&view=residual&gaia=1
Shot 6   [LIVE-URL]?name=Epsilon%20Indi%20B&fov=4&view=lens&lens=methane
```

Keys while recording: space play/pause, arrows step, `b` blink, `r` residual, `g` Gaia.

## Shot list (30 seconds)

| # | Time | On screen | Caption (exact text) | Voice-over (optional) |
|---|---|---|---|---|
| 1 | 0:00 - 0:05 | Barnard's Star, **Exposures** view, playing fast. The whole field flickers; the caption strip under the image shows the wavelength changing with every frame. Tombaugh wordmark visible in the corner | `SPHEREx never images a patch in the same colour twice. A plain blink flickers.` | SPHEREx never photographs a patch in the same colour twice, so a plain blink movie flickers. |
| 2 | 0:05 - 0:10 | Switch to **Passes**. Gaia rings on. Blink first pass against last pass, three or four flips. Field stars sit in their rings; Barnard's Star is well outside its ring and steps north between flips. Cursor circles the star once | `Stack each six-month pass. Barnard's Star has left its Gaia ring.` | Stack each pass, and Barnard's Star steps out of its Gaia ring. |
| 3 | 0:10 - 0:15 | Press `r`: **Residual** view. Field stars fade out. At Barnard's Star a bright and dark pair remains and flips sign between the first and last pass. The candidate list shows one entry | `Subtract the sky its spectrum predicts. What moved is what is left.` | Subtract the sky its spectrum predicts. The motion is what remains, |
| 4 | 0:15 - 0:19 | Zoom or crop to the **motion meter**: two arrows, Tombaugh's and Gaia's, with the numbers beside them | `Tombaugh: [RESULT: measured value] arcsec/yr. Gaia: 10.39 arcsec/yr.` | measured here against Gaia. |
| 5 | 0:19 - 0:22 | Click a star. The **spectrum** panel fills with points across the detector bands | `Click any point for its spectrum.` | Click for a spectrum. |
| 6 | 0:22 - 0:26 | Cut to Epsilon Indi B with the **methane lens**. One source is coloured as a deep methane absorber; field stars are neutral. Cursor points at it | `The methane lens picks out a brown dwarf.` | Colour by methane to find a brown dwarf. |
| 7 | 0:26 - 0:30 | The address bar, highlighted for one second, showing coordinates and view in the URL. Then the **fog-of-war** map: mostly dark sky, a few lit cells, the count of patches opened. Hold the last frame for one second | `Every view is a link. Most of the sky is still dark.` then `Tombaugh  ·  [LIVE-URL]  ·  team Missing Mass` | Every view is a link. Most of the sky is still dark. |

Voice-over total: 67 words. Read at an even pace it fits in 28 seconds. The recording works
without it.

Notes on individual shots:

- **Shot 2.** The Gaia value 10.39 arcsec/yr and the statement that the star has left its ring
  depend only on Gaia and on the date, so they are safe. What must be checked on screen is that
  the ring is drawn at the catalogue position and the star is visibly elsewhere.
- **Shot 3.** If the residual at Barnard's Star is dominated by a masked or saturated core and
  does not show a clean pair, change detector, or use the caption
  `Subtract the sky its spectrum predicts. Steady stars cancel.` and let the picture speak.
- **Shot 4.** Replace the placeholder with the number on screen, to the precision the meter
  shows, including its error if there is room: for example `10.x ± y.y`. If the measurement is
  far from Gaia's, show it anyway and use the caption `Measured against Gaia, in the open.`
- **Shot 6.** If the methane lens is not convincing on Epsilon Indi B, show its click-spectrum
  with the dip at 3.3 um and use the caption `A brown dwarf, dark where methane absorbs.` If
  neither works on real data, cut the shot and lengthen shots 2 and 3.
- **Shot 7.** The fog map must show real counts.

## Recording tips

- **Resolution.** Record at 1920 x 1080, 30 frames per second. Set the browser window to exactly
  that size or record full screen. Export as MP4 (H.264). Check the duration of the exported file:
  it must be 30.0 seconds or less.
- **Browser.** A clean profile or a private window. Hide the bookmarks bar and extensions. Close
  other tabs. Zoom the page so that numbers are readable at 720p, usually 110 to 125 percent.
- **Cursor.** Use a large cursor, move it slowly and only when it points at something. Do not
  wave it. A cursor highlight is fine; click sounds are not needed.
- **Captions.** Burn them in. White on a dark strip in the lower third, a plain sans-serif, at
  least 40 pixels tall at 1080p, no more than two lines, on screen for at least 2.5 seconds each.
  These are also the English subtitles, so the video works with the sound off.
- **Language.** English on screen and in any voice-over. If there is speech, the captions above
  serve as English subtitles; keep them in sync.
- **Sound.** Voice-over only, or silence. If music is used it must be licensed for this use and
  listed in the references.
- **People.** No persons under 18 on screen or in the audio. The recording needs no people at all.
- **AI content.** A screen capture of the real tool is not AI-generated imagery and needs no
  watermark. Any AI-generated image or video that is added, for a title card for example, must
  carry a visible watermark saying it is AI-generated. A synthetic voice, if used, should be
  disclosed in the SI field.
- **Branding.** No NASA logos or insignia, in the tool, in the title card or in browser tabs. Do
  not show other sites' pages. The closing card says "team Missing Mass" and the link, nothing
  more.
- **Editing.** Record each shot separately at a relaxed pace and cut the waits. Do not speed up
  the movie playback itself beyond what the tool's speed control does, so that what is shown is
  what a visitor gets.
- **Hosting.** Upload where anyone can play it without signing in. Open the link in a private
  window before pasting it into the form.

## Seven-slide alternative

Seven slides including the title and intro slides. One idea per slide, real screenshots, numbers
only where they were measured.

| # | Title | Content in one line |
|---|---|---|
| 1 | Tombaugh: a blink comparator for the 102-color sky | Team Missing Mass; challenge "Planet X and SPHEREx"; `[LIVE-URL]`; one screenshot of the tool on Barnard's Star |
| 2 | SPHEREx never photographs a patch in the same colour twice | Intro: the linear variable filter makes wavelength depend on pixel position, so a plain blink flickers; pixels are 6.15 arcsec and Barnard's Star moves 10.4 arcsec a year |
| 3 | Predict the sky, subtract it, see what is left | The method in one diagram: per-pixel smooth spectrum, predicted frame, residual; movers leave a pair, variables leave a pulse |
| 4 | See it: Barnard's Star leaves its Gaia ring | Screenshots: passes blink with Gaia rings, and the residual pair |
| 5 | Measure it: checked against Gaia | Motion meter screenshot and the validation table for the five targets, with measured values `[RESULT: from docs/SCIENCE.md]` |
| 6 | Know it: spectra, molecules, distance | Click-spectrum, methane lens on a brown dwarf, distance dial (2 AU at 500 AU is 13.75 arcmin), fog-of-war map |
| 7 | How it is built, and what it cannot do | Browser app plus small proxy, live IRSA queries so new releases appear; limits (pixel size, three passes, WISE 0855 marginal, Planet X probably too faint, WISE movie not built); data credits; AI-generated code under human direction; Apache 2.0; not affiliated with or endorsed by NASA |

Slide rules: English; no NASA logos; screenshots of the tool need no watermark; any AI-generated
image must carry a visible one; every source on slide 7 or in the form; export to PDF and host at
a public link that opens without sign-in.
