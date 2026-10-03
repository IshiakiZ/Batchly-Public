// This edition deliberately has no audio. Keep the renderer's cue interface so
// visual effects run normally without loading recordings or starting Web Audio.
function silentCue() { return false; }
export const sfx = Object.freeze(Object.fromEntries([
  'click', 'hit', 'count', 'fight', 'whoosh', 'levelUp', 'callout', 'ooh',
  'draw', 'victory',
].map(name => [name, silentCue])));
export const unlock = silentCue;
export const setMusic = silentCue;
export const setMuted = silentCue;
export const setMusicOn = silentCue;
export const setVolume = silentCue;
export const playEvent = silentCue;
export const modeEvent = silentCue;
export const ui = silentCue;
export function musicTrackFor() { return null; }
export function musicFor() { return null; }
export function currentMusic() { return null; }
export function musicTracks() { return {}; }
export function isMuted() { return true; }
export function isMusicOn() { return false; }
export function getVolume() { return 0; }
export function traceSounds(on) { return on ? [] : null; }
export function soundStatus() {
  return {
    edition: 'silent', context: 'none',
    samples: { total: 0, requested: false, loaded: 0, pending: 0, failed: {} },
    tracks: { total: 0, families: {}, ok: [], failed: [] },
    music: { want: null, playing: [] }, voices: 0,
  };
}
export async function verifyAudio() {
  return { edition: 'silent', ok: 0, failed: [], samples: 0, tracks: 0, seconds: {} };
}
