import test from 'node:test';
import assert from 'node:assert/strict';
import { GRAPHICS_PRESETS, graphicsPixelRatio, graphicsPreset, readGraphicsPreference, observeGraphicsPreference } from '../src/graphics-quality.js';

test('dense phone screens get native detail without losing lighting solely because they are narrow', () => {
  for (const [width,height,dpr] of [[360,780,3],[780,360,3],[384,832,2.8125],[832,384,2.8125],[390,844,3]]) {
    assert.equal(graphicsPixelRatio({width,height,dpr}),dpr);
    assert.equal(GRAPHICS_PRESETS.sharp.effects,'high');
  }
  assert.equal(graphicsPixelRatio({width:1920,height:1080,dpr:1}),1);
});
test('native resolution, allocation budget and actual GPU texture limits all bound the render target', () => {
  for(const preset of Object.keys(GRAPHICS_PRESETS)) for(const [width,height,dpr] of [[7680,4320,3],[300,900,4],[844,390,3],[1,1,1]]) {
    const ratio=graphicsPixelRatio({width,height,dpr,preset,maxTextureSize:2048});
    assert.ok(ratio<=dpr && ratio<=GRAPHICS_PRESETS[preset].ratio);
    assert.ok(width*height*ratio*ratio<=GRAPHICS_PRESETS[preset].pixels+1e-6);
    assert.ok(Math.max(width,height)*ratio<=2048+1e-6);
    assert.ok(Number.isFinite(ratio)&&ratio>0);
  }
  assert.equal(graphicsPixelRatio({width:NaN,height:0,dpr:Infinity}),1);
});
test('saved choice is explicit, corrupt/blocked storage falls back to sharp, observers detach cleanly', () => {
  assert.equal(graphicsPreset('high'),'sharp'); assert.equal(graphicsPreset('low'),'economy');
  assert.equal(readGraphicsPreference({getItem:()=> 'balanced'}),'balanced');
  assert.equal(readGraphicsPreference({getItem:()=> 'corrupt'}),'sharp');
  assert.equal(readGraphicsPreference({getItem(){throw Error('blocked')}}),'sharp');
  const target=new EventTarget(), changes=[];
  const stop=observeGraphicsPreference(value=>changes.push(value),target);
  target.dispatchEvent(new CustomEvent('belobog-graphics-change',{detail:'economy'}));
  stop();target.dispatchEvent(new CustomEvent('belobog-graphics-change',{detail:'sharp'}));
  assert.deepEqual(changes,['economy']);
});
