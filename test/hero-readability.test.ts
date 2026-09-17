import { expect, test } from 'bun:test';
import { MeshStandardMaterial, Vector3 } from 'three';
import { SKILLS } from '../src/game/skills.js';
import { audio } from '../src/engine/audio.js';

const silenceAudio = () => {
  const target = audio as any;
  const names: string[] = ['dark','suck','vibe','boom','bladeWave'];
  const old = new Map<string, Function>(names.map(name => [name, target[name]]));
  for (const name of names) target[name] = () => {};
  return () => { for (const [name, fn] of old) target[name] = fn; };
};

test('Void Step keeps the real hero material fully rendered while focus feedback carries the stealth fantasy', () => {
  const material = new MeshStandardMaterial({ transparent: false, opacity: 1 });
  const focus: Array<{ active:boolean, color?:number }> = [];
  const p:any = {
    mats: [material], invuln: 0, pos: new Vector3(),
    startTrail() {}, stopTrail() {},
    beacon: { setFocus(active:boolean, color?:number) { focus.push({ active, color }); } },
  };
  const no = () => {};
  const game:any = {
    active: true,
    fx: { texFlash:no, shockTex:no, explosion:no, burst:no, light:no },
    renderer: { aberr:0, radial:0, desat:0, shake:no, punch:no, flashScreen:no },
    hitRadius:no,
    timeCtl: { slowmo:no },
  };
  const ctx = { data:{}, dmg:1 };
  const restore = silenceAudio();
  try {
    SKILLS.void_step.start(game, p, ctx);
    expect(material.opacity).toBe(1); expect(material.transparent).toBe(false);
    expect(focus.at(-1)).toEqual({ active:true, color:0xd0a0ff });
    expect(game.renderer.desat).toBeLessThan(.2);
    SKILLS.void_step.end(game, p, ctx);
    expect(material.opacity).toBe(1); expect(material.transparent).toBe(false);
    expect(focus.at(-1)?.active).toBe(false);
  } finally { restore(); material.dispose(); }
});
