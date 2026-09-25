import test from 'node:test';
import assert from 'node:assert/strict';
import { BODY_COLORS, CORE_COLORS, ACCESSORIES, DEFAULT_CUSTOMIZATION, normalizeCustomization } from '../shared/robot-customization.js';

test('network cosmetics accept only explicit catalogue IDs and return fresh defaults',()=>{
  for(const invalid of [undefined,null,[],true,12,'ruby',{body:'#ff0000',core:'url(evil)',accessory:'__proto__'},Object.create({body:'ruby'})])
    assert.deepEqual(normalizeCustomization(invalid),DEFAULT_CUSTOMIZATION);
  const input={body:'ruby',core:'cyan',accessory:'crown',damage:999};
  const result=normalizeCustomization(input);assert.deepEqual(result,{body:'ruby',core:'cyan',accessory:'crown'});
  result.body='jade';assert.equal(input.body,'ruby');assert.equal(DEFAULT_CUSTOMIZATION.body,'original');
  assert.notEqual(normalizeCustomization(),normalizeCustomization());
});

test('all advertised combinations round-trip without introducing combat fields',()=>{
  assert.equal(BODY_COLORS.length,7);assert.equal(CORE_COLORS.length,6);assert.equal(ACCESSORIES.length,8);
  for(const body of BODY_COLORS)for(const core of CORE_COLORS)for(const accessory of ACCESSORIES){
    const value={body:body.id,core:core.id,accessory:accessory.id};assert.deepEqual(normalizeCustomization(value),value);
  }
  for(const list of[BODY_COLORS,CORE_COLORS,ACCESSORIES])assert.equal(new Set(list.map(x=>x.id)).size,list.length);
  assert.ok(Object.isFrozen(BODY_COLORS[0]));
});

test('club references accept only their public cosmetic IDs, without carrying private or combat properties',()=>{
  for(const accessory of['clubCap','heartBand']) {
    const supplied={accessory,body:'cobalt',core:'amber',token:'private-seat-token',favorite:'p2',hp:9999,url:'https://untrusted.invalid/model.glb',material:{emissive:100}};
    const normalized=normalizeCustomization(supplied);
    assert.deepEqual(normalized,{body:'cobalt',core:'amber',accessory});
    assert.ok(!JSON.stringify(normalized).includes('private-seat-token'));
    assert.equal(normalizeCustomization(Object.create({accessory})).accessory,'none','prototype properties cannot select a network cosmetic');
    assert.equal(normalizeCustomization({accessory:accessory+'.glb'}).accessory,'none');
  }
});
