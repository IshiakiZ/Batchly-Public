// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

import test from 'node:test';
import assert from 'node:assert/strict';
import { viewBasis, planeScale, project, unproject, viewRadius, degPerPixel, orderForView, magLimit, labelLimit, dotAlpha, starColor, nearestPoint, clampView, MIN_FOV, MAX_FOV, SKY_SURVEYS, DEPTH_REACH, depthReach, depthLimit, parallaxDir, leanTarget, glowBucket, bucketBv, glowRadius } from './globe.js';
import { radecToVec, vecToRadec } from './healpix.js';
import { starList, namedStars, STARS, STAR_FIELDS, STAR_NAMES, SKY_FIGURES, STAR_DATA_CREDIT } from './stardata.js';

const close = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) < tol, `${a} vs ${b}`);

test('the centre of the view projects to the centre of the screen', () => {
  const basis = viewBasis(84, 2);
  const p = project(radecToVec(84, 2), basis, 300, 640, 400);
  close(p.x, 640);
  close(p.y, 400);
  close(p.z, 1);
});

test('north is up and east is to the left, as the sky looks from the ground', () => {
  const basis = viewBasis(100, 10);
  const scale = planeScale(60, 800);
  const north = project(radecToVec(100, 15), basis, scale, 640, 400);
  const east = project(radecToVec(105, 10), basis, scale, 640, 400);
  assert.ok(north.y < 400 && Math.abs(north.x - 640) < 1e-6);
  assert.ok(east.x < 640);
});

test('unproject undoes project', () => {
  const basis = viewBasis(210, -35);
  const scale = planeScale(40, 700);
  for (const [ra, dec] of [[210, -35], [215, -30], [200, -42], [190, -20]]) {
    const p = project(radecToVec(ra, dec), basis, scale, 500, 350);
    const back = vecToRadec(unproject(p.x, p.y, basis, scale, 500, 350));
    close(back.ra, ra, 1e-7);
    close(back.dec, dec, 1e-7);
  }
});

test('the field of view spans the short side of the screen', () => {
  const basis = viewBasis(0, 0);
  const scale = planeScale(60, 800);
  const edge = project(radecToVec(0, 30), basis, scale, 640, 400);
  close(edge.y, 0, 1e-6);
  close(degPerPixel(planeScale(1, 1000)), 0.001, 2e-6);
  // The corner of the screen is farther out than the edge.
  assert.ok(viewRadius(1280, 800, scale) > (30 * Math.PI) / 180);
  assert.ok(viewRadius(1280, 800, planeScale(120, 800)) <= Math.PI);
});

test('sharper tiles are asked for as the view zooms in, never past what a survey has', () => {
  assert.equal(orderForView(0.14), null); // the whole-sky overview is enough
  assert.equal(orderForView(0.04), 3);
  const orders = [0.04, 0.02, 0.01, 0.004, 0.002, 0.001, 0.0005, 0.0001].map((d) => orderForView(d, 3, 9));
  for (let i = 1; i < orders.length; i += 1) assert.ok(orders[i] >= orders[i - 1], orders.join(','));
  assert.equal(orders[orders.length - 1], 9);
  assert.equal(orderForView(0.0001, 3, 5), 5);
  assert.equal(orderForView(0), null);
});

test('more stars and more names appear on the way in; dots hand over to the photos', () => {
  assert.ok(magLimit(120) < magLimit(60));
  assert.ok(magLimit(60) <= magLimit(20));
  assert.ok(labelLimit(100) < labelLimit(40));
  assert.ok(labelLimit(5) > 20);
  assert.equal(dotAlpha(60, true), 1);
  assert.equal(dotAlpha(5, true), 0);
  assert.equal(dotAlpha(5, false), 1);
  assert.ok(dotAlpha(20, true) > 0 && dotAlpha(20, true) < 1);
  assert.match(starColor(-0.2), /^rgb\(\d+,\d+,\d+\)$/);
  assert.notEqual(starColor(-0.2), starColor(1.6));
});

test('nearestPoint picks the closest thing in reach, places of ours first', () => {
  const pts = [
    { x: 100, y: 100, rank: 1, name: 'star' },
    { x: 104, y: 100, rank: 0, name: 'target' },
    { x: 300, y: 300, rank: 1, name: 'far' },
  ];
  assert.equal(nearestPoint(pts, 101, 100).name, 'target');
  assert.equal(nearestPoint(pts, 96, 100).name, 'star');
  assert.equal(nearestPoint(pts, 200, 200), null);
  assert.equal(nearestPoint(pts, 290, 300, 16).name, 'far');
});

test('clampView keeps the view inside its limits', () => {
  assert.deepEqual(clampView({ ra: -10, dec: 95, fov: 500 }), { ra: 350, dec: 89.5, fov: MAX_FOV });
  assert.deepEqual(clampView({ ra: 725, dec: -95, fov: 0 }), { ra: 5, dec: -89.5, fov: MIN_FOV });
});

test('the sky pictures come from IRSA', () => {
  for (const s of Object.values(SKY_SURVEYS)) {
    assert.match(s.base, /^https:\/\/irsa\.ipac\.caltech\.edu\/data\/hips\//);
    assert.ok(s.maxOrder >= s.minOrder);
    assert.ok(s.credit.length > 5);
  }
});

test('the star list: brightest first, named, with the licence notice', () => {
  assert.equal(STARS.length % STAR_FIELDS, 0);
  const stars = starList();
  assert.ok(stars.length > 5000);
  assert.equal(stars[0].name, 'Sirius');
  close(stars[0].ra, 101.287, 0.01);
  close(stars[0].dec, -16.716, 0.01);
  for (let i = 1; i < stars.length; i += 1) assert.ok(stars[i].mag >= stars[i - 1].mag);
  for (const s of stars) assert.ok(s.ra >= 0 && s.ra < 360 && s.dec >= -90 && s.dec <= 90);
  const vega = stars.find((s) => s.name === 'Vega');
  close(vega.ra, 279.235, 0.01);
  close(vega.dec, 38.784, 0.01);
  const named = namedStars();
  assert.equal(named.length, STAR_NAMES.length);
  assert.ok(named.length > 400);
  assert.deepEqual([...named].map((s) => s.name), named.map((s) => s.name).sort((a, b) => a.localeCompare(b)));
  assert.equal(new Set(named.map((s) => s.name.toLowerCase())).size, named.length);
  assert.ok(SKY_FIGURES.length > 100);
  assert.match(STAR_DATA_CREDIT, /Olaf Frohn/);
  assert.match(STAR_DATA_CREDIT, /BSD/);
});

test('the star list carries real distances, with their own credit', () => {
  assert.equal(STAR_FIELDS, 5);
  const stars = starList();
  const dist = (name) => stars.find((s) => s.name === name).dist;
  close(dist('Sirius'), 2.6, 0.15);
  close(dist('Vega'), 7.7, 0.2);
  close(dist('Rigil Kentaurus'), 1.3, 0.1);
  assert.ok(dist('Betelgeuse') > 100 && dist('Deneb') > 300);
  for (const s of stars) assert.ok(s.dist >= 0 && Number.isFinite(s.dist));
  // Nearly every star has one; the rest say 0 (unknown) and must not move.
  assert.ok(stars.filter((s) => s.dist > 0).length / stars.length > 0.95);
  assert.match(STAR_DATA_CREDIT, /HYG/);
  assert.match(STAR_DATA_CREDIT, /CC BY-SA 4\.0/);
});

const angle = (a, b) => Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));

test('depth: with the camera at the Sun every star is exactly where the catalogue says', () => {
  const u = radecToVec(101.287, -16.716);
  assert.equal(parallaxDir(u, 2.6, [0, 0, 0], 0.1), u);
  assert.equal(parallaxDir(u, 2.6, null, 0.1), u);
});

test('depth: a star of unknown distance never moves', () => {
  const u = radecToVec(10, 20);
  for (const d of [0, -1, NaN, undefined]) assert.equal(parallaxDir(u, d, [1, 2, 3], 0.1), u);
});

test('depth: near stars shift more than far ones, the right way, and stay unit vectors', () => {
  const basis = viewBasis(80, 10);
  const u = radecToVec(80, 10);
  const c = basis.e.map((x) => x * 0.5); // the camera steps half a parsec east
  const near = parallaxDir(u, 5, c);
  const mid = parallaxDir(u, 50, c);
  const far = parallaxDir(u, 500, c);
  assert.ok(angle(u, near) > angle(u, mid) && angle(u, mid) > angle(u, far) && angle(u, far) > 0);
  close(angle(u, near), Math.atan(0.5 / 5), 1e-9);
  close(angle(u, far), Math.atan(0.5 / 500), 1e-9);
  for (const v of [near, mid, far]) close(Math.hypot(v[0], v[1], v[2]), 1, 1e-12);
  // Step east and the star slides west: on screen (east is left) it moves right.
  const scale = planeScale(60, 800);
  assert.ok(project(near, basis, scale, 400, 400).x > project(u, basis, scale, 400, 400).x);
});

test('depth: no star shifts further than the limit, however near it is', () => {
  const basis = viewBasis(200, -40);
  const u = radecToVec(200, -40);
  const limit = depthLimit(100);
  close(limit, 5 * Math.PI / 180, 1e-12);
  close(depthLimit(100, 0.02), 2 * Math.PI / 180, 1e-12);
  let last = 0;
  for (const d of [1000, 100, 30, 10, 3, 1.3, 0.5, 0.01]) {
    const shift = angle(u, parallaxDir(u, d, basis.n.map((x) => x * 3), limit));
    assert.ok(shift <= limit + 1e-12, `${d} pc shifts ${shift}`);
    assert.ok(shift >= last - 1e-12, 'nearer never shifts less');
    last = shift;
  }
  // Far stars are not squeezed noticeably: the limit only bites near it.
  close(angle(u, parallaxDir(u, 1000, basis.n.map((x) => x * 3), limit)), Math.atan(3 / 1000), 1e-5);
});

test('depth: the camera leans the way the view turns, forward when zooming in, never past its reach', () => {
  const basis = viewBasis(30, 20);
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  assert.deepEqual(leanTarget(basis, 0, 0, 0, null, 90), [0, 0, 0]);
  const east = leanTarget(basis, 0.4, 0, 0, null, 90);
  assert.ok(dot(east, basis.e) > 0 && Math.abs(dot(east, basis.n)) < 1e-12 && Math.abs(dot(east, basis.f)) < 1e-12);
  const south = leanTarget(basis, 0, -0.4, 0, null, 90);
  assert.ok(dot(south, basis.n) < 0);
  const zoomIn = leanTarget(basis, 0, 0, 2, null, 90);
  const zoomOut = leanTarget(basis, 0, 0, -2, null, 90);
  assert.ok(dot(zoomIn, basis.f) > 0 && dot(zoomOut, basis.f) < 0);
  const aim = radecToVec(40, 25);
  const aimed = leanTarget(basis, 0, 0, 2, aim, 90);
  close(dot(aimed, aim), Math.hypot(aimed[0], aimed[1], aimed[2]), 1e-9);
  // Faster means further, but never past the reach, and the reach shrinks with the field of view.
  const slow = leanTarget(basis, 0.05, 0, 0, null, 90);
  assert.ok(Math.hypot(...slow) < Math.hypot(...east));
  for (const fov of [120, 60, 10, 1]) {
    const wild = leanTarget(basis, 50, -80, 40, null, fov);
    assert.ok(Math.hypot(...wild) <= depthReach(fov) + 1e-12);
  }
  close(depthReach(MAX_FOV), DEPTH_REACH, 1e-12);
  close(depthReach(60), DEPTH_REACH / 2, 1e-12);
  assert.ok(depthReach(400) <= DEPTH_REACH);
});

test('glow: only bright stars get one, brighter means bigger, colours fall into eight buckets', () => {
  assert.equal(glowRadius(1, 5), 0);
  assert.equal(glowRadius(1, 3.6), 0);
  assert.ok(glowRadius(2, -1.4) > glowRadius(2, 1) && glowRadius(2, 1) > glowRadius(2, 3) && glowRadius(2, 3) > 2);
  assert.equal(glowBucket(-0.3), 0);
  assert.equal(glowBucket(1.7), 7);
  assert.equal(glowBucket(NaN), glowBucket(0.6));
  for (let b = 0; b < 8; b += 1) assert.equal(glowBucket(bucketBv(b)), b);
});
