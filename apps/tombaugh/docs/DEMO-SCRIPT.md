# Demo script

A 30-second screen recording of the live tool, and a seven-slide alternative. The 2026 guide allows
either: a video of 30 seconds or less, or a deck of at most seven slides including the title and
intro slides. Public link, in English.

## Ready-made demo

Both forms of the demo already exist in [demo/](demo/), made from screen captures of the live tool
on real SPHEREx data (15 November 2026). Nothing in them is simulated.

| File | What it is |
|---|---|
| [demo/tombaugh-demo.mp4](demo/tombaugh-demo.mp4) | The video: 29.6 seconds, 1920 x 1080, no sound. Pluto, Barnard's Star blink and residual, the motion measured against Gaia, the validation result, the link |
| [demo/tombaugh-slides.pdf](demo/tombaugh-slides.pdf) | Seven slides as a PDF |
| [demo/frames/](demo/frames/) | The captures both are built from |

Rebuild them with `node tools/demo/make-video.mjs` and `node tools/demo/make-slides.mjs`
(Playwright and ffmpeg). `--live <address>` changes the address on the video's last card.

The video is a composite: full-window captures of the tool, with the image area replaced frame by
frame by captures of the same view as the movie was stepped. The small frame counter under the
image is covered while frames are swapped. Captions sit outside the captures. To submit the video,
upload the file somewhere public (a video site or a shared drive) and use that link. The PDF opens
in the browser from its GitHub page and can be linked as it is.

The rest of this file is the shot list for anyone who wants to record their own take by hand.

**Rule for this recording.** Show only what the live tool shows on real SPHEREx data. If a shot
does not show what its caption says, change the caption or drop the shot. Do not adjust the
footage to fit the script. Anything recorded on the practice sky must say "simulated" on screen.

The story has three beats and a close: **Pluto, Barnard's Star, the validation result**, then the
link. Pluto comes first because it is the object Clyde Tombaugh found with a blink comparator, and
the tool is named after him.

## Before recording

1. Open each starting URL below once, an hour before, so the frames are in the proxy cache and
   load fast. The Pluto link loads 225 exposures; let it finish.
2. In the Validation tab press "Run the five challenge targets" and wait for it to finish. It
   visits each target in turn. Record the finished report and cut the wait.
3. The numbers in the captions are from the run of 15 November 2026 recorded in
   [docs/RESULTS.md](RESULTS.md). If the screen shows different numbers on the day, the caption uses
   the numbers on the screen.
4. Check each caption against the screen. Captions are the script; the voice-over is optional.

Starting URLs:

```
Shots 1-3   https://batch-ly.com/tombaugh/index.html?body=pluto
Shot 4      https://batch-ly.com/tombaugh/index.html?name=Barnard%27s%20Star&fov=4&det=3&view=residual&gaia=1
Shots 5-6   the same page as shot 4, Validation tab
```

Keys while recording: space play/pause, arrows step, `b` blink, `r` residual, `g` Gaia.

## Shot list (30 seconds)

| # | Time | On screen | Caption (exact text) | Voice-over (optional) |
|---|---|---|---|---|
| 1 | 0:00 - 0:04 | `?body=pluto`. The **Follow body** view, playing. Pluto sits at the centre of the image. Tombaugh wordmark visible in the corner | `Clyde Tombaugh found Pluto with a blink comparator.` | Clyde Tombaugh found Pluto with a blink comparator. |
| 2 | 0:04 - 0:08 | The same movie, a few more frames. Pluto holds still; the stars change place from visit to visit. Cursor circles Pluto once | `Pluto in real SPHEREx images. It holds still. The stars streak.` | This is Pluto in real SPHEREx images: it holds still while the stars streak. |
| 3 | 0:08 - 0:12 | The **Spectrum** panel: Pluto's spectrum across all six detectors with the "CH4 ice" marks. Cursor moves along the dips near 1.7 and 2.3 um | `225 exposures give its spectrum: methane ice.` | Two hundred twenty-five exposures give its spectrum, with methane ice. |
| 4 | 0:12 - 0:17 | Cut to Barnard's Star, **Residual** view, blinking first pass against last. The blue and red halves swap. The **Candidates** tab shows one entry, "Moved" | `Barnard's Star. Subtract the predicted sky. What moved is left.` | On Barnard's Star, subtract the predicted sky and what moved is left, |
| 5 | 0:17 - 0:22 | **Validation** tab, zoomed on the Barnard's Star row: measured motion beside the catalogue value | `Tombaugh: 11903 ± 2426 mas/yr at 355°. Gaia: 10380 mas/yr at 356°.` | measured here against Gaia. |
| 6 | 0:22 - 0:27 | **Validation** tab, the summary line under the buttons and the table of five targets | `Measured 5 of 5 targets. All 34 comparisons agree within 3 sigma.` | All five challenge targets agree with the catalogues within three sigma. |
| 7 | 0:27 - 0:30 | The address bar for one second, then the first screen. Hold the last frame for one second | `Tombaugh  ·  https://batch-ly.com/tombaugh/index.html  ·  team Missing Mass` | Try it. |

Voice-over total: 61 words. Read at an even pace it fits in 28 seconds. The recording works
without it.

Notes on individual shots:

- **Shots 1 and 2.** The frame follows Pluto, so Pluto stays at the centre and the background
  changes. The caption under the image says "frame follows the body; stars streak". If the stars
  are hard to see, press the "Fixed on stars" comparison in the Solar system tab for one second.
- **Shot 3.** The marks are drawn at 0.89, 1.16, 1.38, 1.72, 2.3 and 3.3 um. The panel title
  reads "Pluto, followed across 225 exposures"; the caption number must match it.
- **Shot 4.** Barnard's Star saturates the detector, so its core is masked and the residual is a
  large halo, blue on one side and red on the other. That is the picture; do not change detector
  to hide it. The candidate text reads "Saturated star: its halo shifted north between the
  passes".
- **Shot 5.** The caption quotes the Validation tab. If the Motion tab is recorded instead, use
  what the meter shows there: `Tombaugh: 11 ± 3 arcsec/yr at 357°. Gaia: 10.39 arcsec/yr at 356°.`
- **Shot 6.** The caption is the tool's own summary line, word for word.

The tool can also play a film by itself (`?story=demo&record=1`). That is an older cut: Barnard's
Star, the methane lens and the sky map, without Pluto or the Validation tab. Record the shot list
above by hand.

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
only where they were measured. The screenshots in [real/](real/) are from the run on real
data and can be used as they are.

| # | Title | Content in one line |
|---|---|---|
| 1 | Tombaugh: a blink comparator for the 102-color sky | Team Missing Mass; challenge "Planet X and SPHEREx"; `https://batch-ly.com/tombaugh/index.html`; screenshot `real/pluto-spectrum.jpg` |
| 2 | SPHEREx never photographs a patch in the same colour twice | Intro: the linear variable filter makes wavelength depend on pixel position, so a plain blink flickers; pixels are 6.15 arcsec and Barnard's Star moves 10.4 arcsec a year |
| 3 | Predict the sky, subtract it, see what is left | The method in one diagram: per-pixel smooth spectrum, predicted frame, residual; movers leave a pair, variables leave a pulse |
| 4 | Pluto, the object Clyde Tombaugh found | `?body=pluto`: followed across 225 real exposures in 4 visits; Pluto holds still while the stars streak; spectrum from 0.76 to 4.97 um with methane-ice bands. Screenshots `real/pluto-followed.jpg`, `real/pluto-spectrum.jpg` |
| 5 | Barnard's Star, measured against Gaia | Residual view, one candidate, "Moved" (`real/barnard-residual-one-mover.jpg`); 11903 ± 2426 mas/yr at 355 deg against 10380 mas/yr at 356 deg |
| 6 | Five of five targets, 34 comparisons within 3 sigma | The table of the five targets from [docs/RESULTS.md](RESULTS.md) section 2; RW Aurigae ×1.397 ± 0.041; R Draconis ×0.717 ± 0.056 (`real/r-draconis-faded.jpg`); field stars within 0.3 arcsec of Gaia; control field: 0 candidates |
| 7 | How it is built, and what it cannot do | Browser app plus small proxy reading NASA's public SPHEREx bucket through an index of 272,963 exposures; limits (pixel size, three or four passes, saturated stars, no new object claimed, Planet X probably too faint, WISE movie not built); data credits; AI-generated code under human direction; Apache 2.0; not affiliated with or endorsed by NASA |

Slide rules: English; no NASA logos; screenshots of the tool need no watermark; any AI-generated
image must carry a visible one; every source on slide 7 or in the form; export to PDF and host at
a public link that opens without sign-in.
