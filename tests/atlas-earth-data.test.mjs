import test from 'node:test';
import assert from 'node:assert/strict';
import { adaptWorld, makeDemo } from '../web/atlas-data.js';

test('Earth-like rendering profile exists only in the imaginary demo planet', () => {
  const nodes = makeDemo();
  const candidates = nodes.filter(n => n.visual?.planet?.earthLike);
  assert.deepEqual(candidates.map(n => n.id), ['demo:p-01']);
  const config = candidates[0].visual.planet.earthLike;
  for (const key of ['biomeGreen','biomeBrown','iceColor','cloudColor','atmosphereColor'])
    assert.match(config[key], /^#[0-9a-f]{6}$/i);
  for (const key of ['cloudOpacity','atmosphereOpacity'])
    assert.ok(config[key] >= 0 && config[key] <= 1);
  assert.ok(Number.isInteger(config.seed));
  assert.equal(adaptWorld([{id:'real',kind:'planet',data:{}}])[0].visual, undefined);
});
