// Spectator view for the hidden tug-of-war test mode (exercises the game-mode plumbing).
export function createView(canvas) {
  const ctx = canvas.getContext('2d');
  let rep = null, colors = ['#e8825c', '#2fc58e'];
  const frameAt = (t) => {
    const f = rep.frames;
    let lo = 0, hi = f.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (f[m][0] <= t) lo = m; else hi = m - 1; }
    const a = f[lo], b = f[Math.min(f.length - 1, lo + 1)];
    const k = b[0] > a[0] ? Math.max(0, Math.min(1, (t - a[0]) / (b[0] - a[0]))) : 0;
    return [t, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k, a[3] + (b[3] - a[3]) * k];
  };
  function bg(anim) {
    const w = canvas.width, h = canvas.height;
    ctx.fillStyle = '#10131f'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#1c2236';
    for (let x = ((anim * 20) % 40) - 40; x < w; x += 40) ctx.fillRect(x, h * 0.62, 20, 6);
  }
  return {
    setReplay(r, c) { rep = r; if (c) colors = c; },
    get duration() { return rep ? rep.duration : 0; },
    render(t, anim) {
      if (!rep) return this.renderIdle(anim);
      bg(anim);
      const w = canvas.width, h = canvas.height;
      const [, pos] = frameAt(Math.max(0, Math.min(rep.duration, t)));
      const cx = w / 2 - (pos / 100) * (w * 0.3);
      ctx.fillStyle = '#c8a878'; ctx.fillRect(w * 0.1, h * 0.5 - 3, w * 0.8, 6);
      ctx.fillStyle = '#ff5d5d'; ctx.fillRect(cx - 4, h * 0.5 - 18, 8, 36);
      ctx.fillStyle = colors[0]; ctx.fillRect(w * 0.08, h * 0.5 - 30, 40, 60);
      ctx.fillStyle = colors[1]; ctx.fillRect(w * 0.92 - 40, h * 0.5 - 30, 40, 60);
      ctx.fillStyle = '#ffffff'; ctx.fillRect(w / 2 - 1, h * 0.3, 2, h * 0.4);
    },
    renderIdle(anim) { bg(anim); },
    resize() {},
    hudAt(t) {
      if (!rep) return [null, null];
      const [, pos, sa, sb] = frameAt(Math.max(0, Math.min(rep.duration, t)));
      return [0, 1].map(s => ({ title: rep.sides[s].name, sub: `rope ${Math.round(s === 0 ? pos : -pos)}`, bars: [{ label: 'Stamina', value: s === 0 ? sa : sb, max: 100, color: colors[s] }], chips: [] }));
    },
    eventsBetween(t0, t1) { return rep ? rep.events.filter(e => e.t > t0 && e.t <= t1).map(e => ({ k: e.k, side: e.side, big: true, text: `${rep.sides[e.side].name} wins the pull!` })) : []; },
  };
}
