// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.
//
// script.js - the stories, as data. No code runs here; runner.js plays them and explains the
// format. Three kinds:
//   'demo'  the film of docs/DEMO-SCRIPT.md, 29 seconds, shot by shot, for a screen recording
//   'tour'  a first-visit tour of the controls, about 90 seconds, which waits for the visitor
//   one short story per challenge target, saying what to look for there
//
// Captions follow the team voice: curious, direct, specific. No hype, no exclamation marks.
// A caption that quotes a measurement uses a placeholder ({motion}) that is filled from what the
// tool shows at that moment, and has a fallback for when there is nothing to quote: a caption
// must never claim more than the screen shows.

const TAGLINE = 'a blink comparator for the 102-color sky';
const DATA_CREDIT = 'Data: NASA SPHEREx via IRSA';
const TEAM = 'Missing Mass';

/** Barnard's Star, exposure by exposure, Gaia rings off: the first shot of the film. */
const SHOT_ONE = { view: 'exposures', det: 3, fov: 4, gaia: false, flags: false };

const demo = {
  id: 'demo',
  title: 'The 30-second film',
  description: 'See it, measure it, know it: the whole demonstration, performed at the pace of the script.',
  kind: 'film',
  maxSeconds: 29,
  maxCaptionWords: 9,
  startOnKey: true,
  restoreOnDone: true,
  holdEnd: true,
  // Everything the film shows is opened once before the clock starts, so nothing loads on camera.
  preload: {
    label: 'Preparing the demonstration',
    ready: 'Ready. Press Space to start recording',
    items: [
      { label: "Barnard's Star, passes", do: [{ type: 'goTo', target: 'barnard', state: { view: 'passes', det: 3, fov: 4, gaia: true, flags: false } }], waitFor: { cond: 'loaded', timeoutMs: 90000, settleMs: 300 } },
      { label: "Barnard's Star, residual", do: [{ type: 'set', state: { view: 'residual' } }], waitFor: { cond: 'frames', timeoutMs: 30000, settleMs: 200 } },
      { label: 'Spectrum and motion', do: [{ type: 'select', where: 'target' }], waitFor: { cond: 'selection', timeoutMs: 10000 } },
      { label: 'Epsilon Indi B, methane lens', do: [{ type: 'goTo', target: 'eps-indi-b', state: { view: 'lens', lens: 'methane', fov: 4, gaia: false } }], waitFor: { cond: 'loaded', timeoutMs: 120000, settleMs: 300 } },
      { label: 'Sky map', do: [{ type: 'fog' }, { type: 'wait', ms: 900 }, { type: 'fog', close: true }] },
      { label: "Barnard's Star, exposures", do: [{ type: 'goTo', target: 'barnard', state: SHOT_ONE }, { type: 'zoom', level: 1 }, { type: 'panel', id: 'spectrum' }], waitFor: { cond: 'loaded', timeoutMs: 60000, settleMs: 300 } },
    ],
  },
  steps: [
    {
      id: 'title',
      at: 0,
      duration: 1,
      caption: { card: 'title', title: 'TOMBAUGH', text: TAGLINE },
      do: [{ type: 'goTo', target: 'barnard', state: SHOT_ONE }, { type: 'zoom', level: 1 }, { type: 'play' }],
    },
    {
      // Shot 1. See it: the naive blink.
      id: 'flicker',
      at: 1,
      duration: 3.5,
      caption: { title: 'See it', text: 'Every exposure is a different colour, so blinking flickers.' },
      do: [{ type: 'play' }],
    },
    {
      // Shot 2. See it: per-pass stacks, first pass against last.
      id: 'passes',
      at: 4.5,
      duration: 4.5,
      caption: { title: 'See it', text: "Stacked by pass, Barnard's Star leaves its Gaia ring." },
      do: [{ type: 'pause' }, { type: 'set', state: { view: 'passes', gaia: true } }],
      waitFor: { cond: 'frames', timeoutMs: 1200 },
      then: [{ type: 'blink', times: 6, periodMs: 600 }],
      spotlight: { sky: 'target', label: "Barnard's Star" },
    },
    {
      // Shot 3. Measure it: predicted-sky subtraction.
      id: 'residual',
      at: 9,
      duration: 3.5,
      caption: { title: 'Measure it', text: 'Subtract the predicted sky. What moved is left.' },
      do: [{ type: 'set', state: { view: 'residual' } }],
      waitFor: { cond: 'frames', timeoutMs: 1200 },
      then: [{ type: 'blink', times: 5, periodMs: 600 }],
      spotlight: { sky: 'target', label: 'Bright and dark pair' },
    },
    {
      // Shot 4. Measure it: the motion meter beside Gaia's value. The numbers are read off the tool.
      id: 'motion',
      at: 12.5,
      duration: 3.5,
      caption: {
        title: 'Measure it',
        text: 'Tombaugh: {motion} arcsec/yr. Gaia: {gaiaMotion} arcsec/yr.',
        fallback: { text: 'Measured against Gaia, in the open.' },
      },
      do: [{ type: 'select', where: 'target' }, { type: 'panel', id: 'motion' }],
      waitFor: { cond: 'selection', timeoutMs: 1500 },
      spotlight: { element: 'panel-motion', label: 'Motion meter' },
    },
    {
      // Shot 5. Know it: the click spectrum.
      id: 'spectrum',
      at: 16,
      duration: 2.5,
      caption: { title: 'Know it', text: 'Click any point for its spectrum.' },
      do: [{ type: 'panel', id: 'spectrum' }],
      spotlight: { element: 'panel-spectrum', label: 'Spectrum' },
    },
    {
      // Shot 6. Know it: a molecule lens on a cold brown dwarf.
      id: 'lens',
      at: 18.5,
      duration: 3.5,
      caption: { title: 'Know it', text: 'The methane lens picks out a cold brown dwarf.' },
      do: [{ type: 'goTo', target: 'eps-indi-b', state: { view: 'lens', lens: 'methane', fov: 4, gaia: false } }],
      waitFor: { cond: 'frames', timeoutMs: 2000 },
      spotlight: { sky: 'target', label: 'Epsilon Indi B' },
    },
    {
      // Shot 7a. The address of this very view.
      id: 'link',
      at: 22,
      duration: 2.5,
      caption: { title: 'Share it', text: 'Every view is a link.' },
      do: [{ type: 'url' }],
    },
    {
      // Shot 7b. The shared map of where anyone has looked.
      id: 'map',
      at: 24.5,
      duration: 2.5,
      caption: { title: 'Your turn', text: 'Most of the sky is still dark.' },
      do: [{ type: 'url', show: false }, { type: 'fog' }],
    },
    {
      id: 'end',
      at: 27,
      duration: 2,
      caption: { card: 'end', title: 'TOMBAUGH', text: TAGLINE, url: '{url}', lines: [DATA_CREDIT, TEAM] },
      do: [{ type: 'fog', close: true }],
    },
  ],
};

const HOLD_FRAMES = { cond: 'frames', timeoutMs: 30000, hold: true };

const tour = {
  id: 'tour',
  title: 'Guided tour',
  description: 'A walk round the controls on Barnard’s Star, about a minute and a half. It waits for you where there is something to try.',
  kind: 'tour',
  maxCaptionWords: 16,
  steps: [
    {
      id: 'welcome',
      duration: 7,
      caption: { title: 'Welcome', text: 'This is one patch of sky, photographed by SPHEREx again and again.' },
      do: [{ type: 'goTo', target: 'barnard', state: { view: 'passes', det: 3, fov: 4, gaia: true, flags: false } }, { type: 'zoom', level: 1 }],
      waitFor: HOLD_FRAMES,
    },
    {
      id: 'player',
      duration: 7,
      caption: { title: 'The movie', text: 'Play it. Each frame here is one six-month pass, stacked.' },
      do: [{ type: 'play' }],
      spotlight: { element: 'player', label: 'Player' },
    },
    {
      id: 'blink',
      duration: 7,
      caption: { title: 'Blink', text: 'Flip between the first pass and the last. One star steps north.' },
      do: [{ type: 'pause' }, { type: 'blink', times: 9, periodMs: 700 }],
      spotlight: { sky: 'target', label: "Barnard's Star" },
    },
    {
      id: 'views',
      duration: 6,
      caption: { title: 'View modes', text: 'These buttons change what each frame shows.' },
      spotlight: { element: 'view-seg', label: 'View modes' },
    },
    {
      id: 'exposures',
      duration: 8,
      caption: { title: 'Exposures', text: 'Single exposures flicker, because each one is taken in a different colour.' },
      do: [{ type: 'set', state: { view: 'exposures' } }],
      waitFor: HOLD_FRAMES,
      then: [{ type: 'play' }],
    },
    {
      id: 'residual',
      duration: 8,
      caption: { title: 'Residual', text: 'Subtract the sky each pixel’s spectrum predicts. What moved or changed remains.' },
      do: [{ type: 'pause' }, { type: 'set', state: { view: 'residual' } }],
      waitFor: HOLD_FRAMES,
      then: [{ type: 'blink', times: 9, periodMs: 700 }],
      spotlight: { sky: 'target', label: 'What moved' },
    },
    {
      id: 'gaia',
      duration: 6,
      caption: { title: 'Gaia rings', text: 'Rings mark where the Gaia catalogue puts each star. G hides them.' },
      do: [{ type: 'set', state: { view: 'passes', gaia: true } }],
      waitFor: HOLD_FRAMES,
      then: [{ type: 'frame', index: 'last' }],
    },
    {
      id: 'detectors',
      duration: 7,
      caption: { title: 'Detectors', text: 'Six detectors cover 0.75 to 5 micrometres. Keys 1 to 6 switch between them.' },
      spotlight: { element: 'controls', label: 'Display controls' },
    },
    {
      id: 'click',
      duration: 8,
      caption: { title: 'Measure', text: 'Click any source for its spectrum, light curve and motion.' },
      do: [{ type: 'select', where: 'target' }, { type: 'panel', id: 'spectrum' }],
      spotlight: { element: 'panel-spectrum', label: 'Spectrum' },
    },
    {
      id: 'motion',
      duration: 7,
      caption: { title: 'Motion', text: 'The motion meter sets your measurement beside the Gaia value.' },
      do: [{ type: 'panel', id: 'motion' }],
      spotlight: { element: 'panel-motion', label: 'Motion meter' },
    },
    {
      id: 'lens',
      duration: 8,
      caption: { title: 'Molecule lenses', text: 'A lens colours the sky by one absorption band: methane, water, carbon dioxide.' },
      do: [{ type: 'set', state: { view: 'lens', lens: 'methane' } }],
      waitFor: { cond: 'frames', timeoutMs: 20000, hold: true },
    },
    {
      id: 'map',
      duration: 7,
      caption: { title: 'Sky map', text: 'The map shows which patches anyone has opened. Most are still dark.' },
      do: [{ type: 'set', state: { view: 'passes' } }, { type: 'fog' }],
    },
    {
      id: 'finish',
      duration: 6,
      caption: { title: 'Your turn', text: 'Every view is a link. Type a position, or press ? for the keys.' },
      do: [{ type: 'fog', close: true }, { type: 'panel', id: 'spectrum' }],
    },
  ],
};

/** A short "what to look for" story: open the target, then three or four captions. */
function targetStory({ id, name, state, steps }) {
  return {
    id,
    title: name,
    description: `What to look for at ${name}.`,
    kind: 'target',
    target: id,
    maxCaptionWords: 16,
    steps: steps.map((s, i) => ({
      id: s.id || `${id}-${i + 1}`,
      duration: s.duration || 5,
      caption: { title: i === 0 ? name : s.title || name, text: s.text, fallback: s.fallback },
      do: i === 0 ? [{ type: 'goTo', target: id, state }, { type: 'zoom', level: 1 }, ...(s.do || [])] : s.do || [],
      waitFor: s.waitFor === undefined ? (i === 0 ? HOLD_FRAMES : undefined) : s.waitFor,
      then: s.then,
      spotlight: s.spotlight,
    })),
  };
}

const barnard = targetStory({
  id: 'barnard',
  name: "Barnard's Star",
  state: { view: 'passes', det: 3, fov: 4, gaia: true },
  steps: [
    { text: 'The fastest star in the sky: 10.4 arcsec a year, about 1.7 pixels.', then: [{ type: 'blink', times: 7, periodMs: 700 }], spotlight: { sky: 'target', label: "Barnard's Star" } },
    { title: 'Residual', text: 'With the predicted sky subtracted, a mover leaves a bright and dark pair.', do: [{ type: 'set', state: { view: 'residual' } }], waitFor: HOLD_FRAMES, then: [{ type: 'blink', times: 7, periodMs: 700 }], spotlight: { sky: 'target', label: 'Bright and dark pair' } },
    { title: 'Motion', text: 'Tombaugh measures {motion} arcsec/yr here. Gaia says {gaiaMotion}.', fallback: { text: 'Click the star: the motion meter should land near Gaia’s 10.39 arcsec/yr.' }, do: [{ type: 'select', where: 'target' }, { type: 'panel', id: 'motion' }], waitFor: { cond: 'selection', timeoutMs: 4000 }, spotlight: { element: 'panel-motion', label: 'Motion meter' } },
  ],
});

const epsIndiB = targetStory({
  id: 'eps-indi-b',
  name: 'Epsilon Indi B',
  state: { view: 'passes', det: 6, fov: 4, gaia: true },
  steps: [
    { text: 'Two methane-rich brown dwarfs, 12 light-years away, sharing one pixel.', spotlight: { sky: 'target', label: 'Epsilon Indi Ba, Bb' } },
    { title: 'Methane lens', text: 'The methane lens should mark the pair: dark at 3.3 micrometres, neutral elsewhere.', do: [{ type: 'set', state: { view: 'lens', lens: 'methane' } }], waitFor: { cond: 'frames', timeoutMs: 30000, hold: true }, spotlight: { sky: 'target', label: 'Epsilon Indi Ba, Bb' } },
    { title: 'Spectrum', text: 'Click it and look for the dip near 3.3 micrometres, where methane absorbs.', do: [{ type: 'select', where: 'target' }, { type: 'panel', id: 'spectrum' }], spotlight: { element: 'panel-spectrum', label: 'Spectrum' } },
    { title: 'Motion', text: 'The pair drifts 4.7 arcsec a year, in step with Epsilon Indi A.', do: [{ type: 'set', state: { view: 'passes' } }], waitFor: HOLD_FRAMES, then: [{ type: 'blink', times: 6, periodMs: 700 }] },
  ],
});

const wise0855 = targetStory({
  id: 'wise0855',
  name: 'WISE 0855-0714',
  state: { view: 'passes', det: 6, fov: 4, gaia: true },
  steps: [
    { text: 'The coldest brown dwarf known: about 250 K, 7.4 light-years away.', spotlight: { sky: 'target', label: 'Where it should be' } },
    { title: 'Where to look', text: 'It shows, if at all, only on detector 6, between 4.5 and 5 micrometres.', then: [{ type: 'blink', times: 6, periodMs: 700 }] },
    { title: 'A fair test', text: 'One exposure is near the limit. It moves 8.1 arcsec a year, so compare the passes.', do: [{ type: 'select', where: 'target' }, { type: 'panel', id: 'spectrum' }], spotlight: { element: 'panel-spectrum', label: 'Spectrum' } },
  ],
});

const rwAur = targetStory({
  id: 'rw-aur',
  name: 'RW Aurigae',
  state: { view: 'passes', det: 2, fov: 4, gaia: true },
  steps: [
    { text: 'A young star that brightens and fades with no fixed period.', then: [{ type: 'blink', times: 6, periodMs: 700 }], spotlight: { sky: 'target', label: 'RW Aurigae' } },
    { title: 'Residual', text: 'Nothing moves here. A variable leaves a single pulse, not a pair.', do: [{ type: 'set', state: { view: 'residual' } }], waitFor: HOLD_FRAMES, then: [{ type: 'blink', times: 6, periodMs: 700 }], spotlight: { sky: 'target', label: 'One star changes' } },
    { title: 'Light curve', text: 'Click it: its brightness should differ between passes while the neighbours stay flat.', do: [{ type: 'select', where: 'target' }, { type: 'panel', id: 'lightcurve' }], spotlight: { element: 'panel-lightcurve', label: 'Light curve' } },
  ],
});

const rDra = targetStory({
  id: 'r-dra',
  name: 'R Draconis',
  state: { view: 'passes', det: 3, fov: 4, gaia: true },
  steps: [
    { text: 'A Mira-type red giant that swells and fades over about 245 days.', spotlight: { sky: 'target', label: 'R Draconis' } },
    { title: 'Between passes', text: 'Passes six months apart catch it at different points of its cycle.', then: [{ type: 'blink', times: 7, periodMs: 700 }], waitFor: HOLD_FRAMES },
    { title: 'Spectrum', text: 'Click it: the water band near 1.9 micrometres should change depth with the cycle.', do: [{ type: 'select', where: 'target' }, { type: 'panel', id: 'spectrum' }], spotlight: { element: 'panel-spectrum', label: 'Spectrum' } },
  ],
});

/** Every story, in the order the launcher lists them. */
export const STORIES = Object.freeze([tour, demo, barnard, epsIndiB, wise0855, rwAur, rDra]);

/** Story ids for the five challenge targets (they equal the target ids in core/targets.js). */
export const TARGET_STORY_IDS = Object.freeze(['barnard', 'eps-indi-b', 'wise0855', 'rw-aur', 'r-dra']);

/** A story by id (case-insensitive), or null. */
export function getStory(id) {
  const q = String(id ?? '').trim().toLowerCase();
  if (!q) return null;
  return STORIES.find((s) => s.id === q) || null;
}

/** Every target id a story visits (for checking against core/targets.js). */
export function storyTargets(story) {
  const ids = new Set();
  const scan = (actions) => {
    for (const a of actions || []) if (a && a.type === 'goTo' && typeof a.target === 'string') ids.add(a.target);
  };
  for (const step of story.steps || []) {
    scan(step.do);
    scan(step.then);
  }
  if (story.preload) for (const item of story.preload.items || []) scan(item.do);
  return [...ids];
}
