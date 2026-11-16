// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

// The data citation line, its copy button, "Download PNG", and links to other archives for the
// same coordinates.

/**
 * DOIs in one place so they are easy to correct. Read from IRSA's release pages on 2026-11-15:
 * https://irsa.ipac.caltech.edu/data/SPHEREx/docs/overview_qr.html (QR1, QR2, QR3) and
 * https://irsa.ipac.caltech.edu/data/SPHEREx/docs/overview_dr1.html (DR1 spectral images).
 */
export const DOIS = Object.freeze({
  releases: Object.freeze({
    qr1: '10.26131/IRSA629',
    qr2: '10.26131/IRSA652',
    qr3: '10.26131/IRSA662',
    dr1: '10.26131/IRSA678',
  }),
});

const RELEASE_NAMES = { qr1: 'QR1', qr2: 'QR2', qr3: 'QR3', dr1: 'DR1', dr2: 'DR2' };

export function releaseLabel(release) {
  const key = String(release || '').toLowerCase();
  return RELEASE_NAMES[key] || String(release || '').toUpperCase();
}

/**
 * citationText({ releases, retrieved }) -> the contract's citation line.
 * releases: e.g. ['qr3', 'dr1']; retrieved: Date | ISO string (defaults to today).
 */
export function citationText({ releases = [], retrieved = null } = {}) {
  const list = [...new Set(releases.filter(Boolean).map((r) => String(r).toLowerCase()))].sort();
  const names = list.length ? list.map(releaseLabel).join(', ') : 'quick release';
  // IRSA asks for the DOI of each release used. With no release known yet, name the current ones.
  const cited = list.filter((r) => DOIS.releases[r]);
  const extra = (cited.length ? cited : ['dr1', 'qr3']).map(
    (r) => `${releaseLabel(r)} DOI ${DOIS.releases[r]}`,
  );
  let date = retrieved instanceof Date ? retrieved : retrieved ? new Date(retrieved) : new Date();
  if (Number.isNaN(date.getTime())) date = new Date();
  const day = date.toISOString().slice(0, 10);
  return `SPHEREx Level 2 spectral images, ${names} (NASA/IPAC Infrared Science Archive; ${extra.join('; ')}), retrieved ${day}. Gaia DR3.`;
}

const WISEVIEW_TAIL =
  '&size=176&band=3&speed=20&minbright=-50&maxbright=500&window=0.5&diff_window=1&linear=1&color=&zoom=9&border=0&gaia=0&invert=0&maxdyr=0&scandir=0&neowise=0&diff=0&outer_epochs=0&unique_window=1&smooth_scan=0&shift=0&pmra=0&pmdec=0&synth_a=0&synth_a_sub=0&synth_a_ra=&synth_a_dec=&synth_a_w1=&synth_a_w2=&synth_a_pmra=0&synth_a_pmdec=0&synth_a_mjd=&synth_b=0&synth_b_sub=0&synth_b_ra=&synth_b_dec=&synth_b_w1=&synth_b_w2=&synth_b_pmra=0&synth_b_pmdec=0&synth_b_mjd=';

function fix(value, digits) {
  return String(Number(Number(value).toFixed(digits)));
}

/** Links to the same spot in other tools: WiseView (16 years of WISE), SIMBAD, IRSA SPHEREx. */
export function externalLinks(ra, dec) {
  const r = fix(ra, 5);
  const d = fix(dec, 5);
  const sign = Number(dec) >= 0 ? '+' : '';
  return [
    {
      id: 'wiseview',
      label: 'Open in WiseView',
      title: 'The same spot in 16 years of WISE images',
      href: `http://byw.tools/wiseview#ra=${r}&dec=${d}${WISEVIEW_TAIL}`,
    },
    {
      id: 'simbad',
      label: 'SIMBAD',
      title: 'Known objects within 2 arcmin',
      href: `https://simbad.cds.unistra.fr/simbad/sim-coo?Coord=${encodeURIComponent(`${r} ${sign}${d}`)}&CooFrame=ICRS&CooEpoch=2000&CooEqui=2000&Radius=2&Radius.unit=arcmin&submit=submit+query`,
    },
    {
      id: 'irsa',
      label: 'IRSA SPHEREx',
      title: 'The SPHEREx archive at IRSA for these coordinates',
      href: `https://irsa.ipac.caltech.edu/applications/spherex/?__action=layout.showDropDown&view=Search&initArgs=${encodeURIComponent(JSON.stringify({ ra: Number(r), dec: Number(d) }))}`,
    },
  ];
}

/**
 * createCitation(container, { onCopy(text), onPng(), onGif? }) -> { update({ releases, retrieved, ra, dec, canPng }) , text() }
 */
export function createCitation(container, { onCopy = () => {}, onPng = () => {} } = {}) {
  const doc = container.ownerDocument;
  container.textContent = '';

  const text = doc.createElement('p');
  text.className = 'cite-text';
  text.id = 'cite-text';

  const row = doc.createElement('div');
  row.className = 'cite-row';

  const copy = doc.createElement('button');
  copy.type = 'button';
  copy.className = 'btn btn-small';
  copy.textContent = 'Copy citation';
  copy.setAttribute('aria-describedby', 'cite-text');
  copy.addEventListener('click', () => onCopy(current));

  const png = doc.createElement('button');
  png.type = 'button';
  png.className = 'btn btn-small';
  png.textContent = 'Download PNG';
  png.title = 'Save the current frame as an image';
  png.addEventListener('click', () => onPng());

  const links = doc.createElement('div');
  links.className = 'cite-links';

  row.append(copy, png, links);
  container.append(text, row);

  let current = citationText({});
  text.textContent = current;
  text.title = current;

  function update({ releases = [], retrieved = null, ra = null, dec = null, canPng = true } = {}) {
    current = citationText({ releases, retrieved });
    text.textContent = current;
    text.title = current;
    png.disabled = !canPng;
    png.title = canPng ? 'Save the current frame as an image' : 'Nothing to save yet: no frame is showing';
    links.textContent = '';
    if (Number.isFinite(ra) && Number.isFinite(dec)) {
      for (const link of externalLinks(ra, dec)) {
        const a = doc.createElement('a');
        a.href = link.href;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = link.label;
        a.title = link.title;
        links.append(a);
      }
    }
  }

  return { update, text: () => current };
}
