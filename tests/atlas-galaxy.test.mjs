import test from 'node:test';
import assert from 'node:assert/strict';
import { galaxySprites } from '../web/atlas-galaxy.js';

test('demo galaxies generate finite deterministic bounded particle buffers', () => {
  for (const shape of ['disk','elliptical','irregular']) for (const density of ['standard','high']) {
    const a=galaxySprites(shape,[1,2,3],.5,density), b=galaxySprites(shape,[1,2,3],.5,density);
    assert.deepEqual(a,b);
    assert.ok(a.sizes.length >= 1000 && a.sizes.length <= 5000);
    assert.equal(a.positions.length,a.sizes.length*3);
    assert.equal(a.colors.length,a.sizes.length*4);
    assert.ok(a.positions.every(Number.isFinite));
    assert.ok(a.colors.every(n => Number.isFinite(n) && n >= 0 && n <= 1));
    assert.ok(a.sizes.every(n => Number.isFinite(n) && n > 0));
  }
});

test('galaxy shapes differ and coordinate frame is respected', () => {
  const disk=galaxySprites('disk',[0,0,0],1), ellipse=galaxySprites('elliptical',[0,0,0],1), irregular=galaxySprites('irregular',[0,0,0],1);
  assert.notDeepEqual(disk.positions,ellipse.positions);
  assert.notDeepEqual(disk.positions,irregular.positions);
  const shifted=galaxySprites('disk',[3,-2,7],1);
  for(let i=0;i<disk.positions.length;i+=3) {
    assert.ok(Math.abs(shifted.positions[i]-disk.positions[i]-3)<1e-5);
    assert.ok(Math.abs(shifted.positions[i+1]-disk.positions[i+1]+2)<1e-5);
    assert.ok(Math.abs(shifted.positions[i+2]-disk.positions[i+2]-7)<1e-5);
  }
});
