/**
 * The game has to work with no network, because that is the whole delivery.
 *
 * The owner plays away from home 「成果物は外出先でスマホでプレイできるように」,
 * and there is no public URL: the phone loads the game once over the house
 * Wi-Fi, adds it to the home screen, and from then on runs it from the service
 * worker's cache. So the precache list IS the deliverable, and it had rotted —
 * four modules and twenty-five images behind — which matters more than it
 * sounds, because `cache.addAll` is atomic. One missing entry and NOTHING is
 * cached, and the failure is invisible at home where the network answers.
 *
 * This reads sw.js as text rather than importing it. A service worker cannot be
 * imported into node, and rewriting it as an importable module to make it
 * testable would mean testing something other than the file that ships.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The repo root, found by walking up to package.json.
 *
 * Not `new URL('..', import.meta.url)`: tests run compiled, from dist/tests, so
 * one level up is dist and every path below it is wrong — which is how the
 * first version of this file failed, looking for dist/sw.js.
 */
const ROOT = ((): string => {
  let dir = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, 'package.json'))) return dir;
    dir = join(dir, '..');
  }
  throw new Error('could not find the repo root');
})();

const swText = readFileSync(join(ROOT, 'sw.js'), 'utf8');

/** The generated PRECACHE array, as a list of relative paths. */
const precache = (): readonly string[] => {
  const open = swText.indexOf('const PRECACHE = [');
  assert.ok(open >= 0, 'sw.js has no PRECACHE array');
  const close = swText.indexOf('];', open);
  const body = swText.slice(open, close);
  return [...body.matchAll(/'(\.\/[^']*)'/g)].map((m) => (m[1] as string).slice(2));
};

/**
 * Every file under a directory, as a path relative to the repo root.
 *
 * Directories are found by trying to read them rather than by stat: the project
 * pins a node typings version whose fs surface does not expose statSync, and
 * adding a dependency to identify a folder is not worth it (PROMPT.md 1 caps
 * devDependencies at typescript).
 */
const walk = (dir: string, out: string[] = []): string[] => {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    let children: string[] | null;
    try { children = readdirSync(full); } catch { children = null; }
    if (children) walk(full, out);
    else out.push(full.slice(ROOT.length).replace(/^[\\/]+/, '').split('\\').join('/'));
  }
  return out;
};

test('every precached file actually exists', () => {
  // The atomic-addAll trap. One 404 here and the installed game does not start
  // off the network at all.
  for (const path of precache()) {
    if (path === '') continue;                 // './' is the navigation root
    assert.ok(existsSync(join(ROOT, path)), `precache lists a missing file: ${path}`);
  }
});

test('every built module is precached', () => {
  const listed = new Set(precache());
  const built = walk(join(ROOT, 'dist', 'src')).filter((p) => p.endsWith('.js'));
  assert.ok(built.length > 15, `only found ${built.length} built modules — was the build run?`);
  for (const path of built) {
    assert.ok(listed.has(path),
      `${path} is not precached; offline it will 404 and take the whole cache down`);
  }
});

test('every image the game loads is precached', () => {
  const listed = new Set(precache());
  const art = walk(join(ROOT, 'assets')).filter((p) => p.endsWith('.png'));
  assert.ok(art.length > 40, `only found ${art.length} images`);
  for (const path of art) {
    assert.ok(listed.has(path), `${path} is not precached`);
  }
});

test('the entry point and the shell are precached', () => {
  const listed = new Set(precache());
  for (const must of ['index.html', 'manifest.webmanifest', 'dist/src/main.js']) {
    assert.ok(listed.has(must), `${must} must be precached`);
  }
});

test('the worker falls back to the cache instead of hanging on a bad network', () => {
  // Offline, fetch rejects and the catch runs. On a weak mobile connection it
  // does neither: it hangs, and the game shows a black screen with a complete
  // copy of itself sitting on the device.
  assert.match(swText, /NETWORK_TIMEOUT_MS/,
    'code requests must race the network against a timer');
  assert.match(swText, /caches\.match\(request/, 'there must be a cache fallback');
});

test('the cache name is bumped whenever the precache list changes shape', () => {
  // Not automatic — a reminder in test form. An old cache with the old list
  // survives activation only if the name is unchanged.
  const m = swText.match(/const CACHE = '([^']+)'/);
  assert.ok(m, 'sw.js has no CACHE name');
  assert.match(m[1] as string, /-v\d+$/, 'the cache name should end in a version');
});
