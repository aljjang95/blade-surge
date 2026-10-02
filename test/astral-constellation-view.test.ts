import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { createRouteObjectives } from '../src/game/route-objectives.js';
import { buildExpeditionStage, buildExpeditionWorld } from '../src/game/expedition-combat.js';
import { AstralConstellations } from '../src/game/astral-constellations.js';
import { AstralConstellationView } from '../src/game/astral-constellation-view.js';

function fixture() {
  const stage = buildExpeditionStage('dungeon', 'astral_leviathan_spire', null), world = buildExpeditionWorld(stage);
  const route = createRouteObjectives(stage, world) as AstralConstellations;
  const gate = route.gates[0]; gate.room.discovered = true; gate.room.spawned = true; route.prepareRoom(gate.room, 0);
  const game: any = { world, active: true, paused: false, bossDefeated: false, enemies: [], pending: [], autoTarget: null,
    ui: { toast() {}, setObjective() {} }, player: { alive: true, state: 'idle', hp: 100, pos: gate.pos.clone() },
    markCleared: (room: any) => { if (!route.beforeClear(game, room)) room.cleared = true; } };
  route.beforeClear(game, gate.room); return { route, world, game, gate, scene: new THREE.Scene() };
}
function documentFixture(labels: string[], available = true) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => ({
    width: 0, height: 0, getContext: () => available ? { clearRect() {}, fillRect() {}, fillText: (text: string) => labels.push(text) } : null,
  }) } });
  return () => { if (previous) Object.defineProperty(globalThis, 'document', previous); else Reflect.deleteProperty(globalThis, 'document'); };
}

test('view projects numbered identity, advertised clue and circle geometry; combat hides clue and every choice together', () => {
  const labels: string[] = [], restoreDocument = documentFixture(labels), f = fixture(); let view: any;
  try {
    view = new AstralConstellationView(f.scene, f.route); f.route.view = view;
    expect(f.scene.children).toHaveLength(1); expect(view.entries[0].title.sprite.visible).toBe(false);
    expect(view.entries.slice(1).every((e: any) => !e.root.visible)).toBe(true);
    f.route.update(f.game, .5); const first = view.entries[0];
    expect(first.title.sprite.visible).toBe(true); expect(labels.some(s => s.includes('단서 A △ 삼각'))).toBe(true);
    expect(first.pads.every((p: any) => !p.root.visible)).toBe(true);
    f.route.update(f.game, .5); expect(first.pads.every((p: any) => p.root.visible)).toBe(true);
    expect(labels).toEqual(expect.arrayContaining(['A △', 'B ○', 'C ◇']));
    for (const [i, pad] of first.pads.entries()) {
      expect(pad.text.state).toBe(`${f.gate.pads[i].code} ${f.gate.pads[i].glyph}\n1초 유지`);
      const worldPosition = new THREE.Vector3(); view.group.updateMatrixWorld(true); pad.root.getWorldPosition(worldPosition);
      expect(worldPosition.distanceTo(f.gate.pads[i].pos)).toBeLessThan(1e-8);
      expect(pad.outline.geometry.parameters.outerRadius).toBe(f.route.def.radius);
      expect(pad.material.blending).toBe(THREE.NormalBlending);
    }
    const diamond = first.pads[2];
    expect(diamond.glyph.rotation.y).toBe(0);
    const positions = diamond.glyph.geometry.getAttribute('position');
    for (let i = 1; i <= 4; i++) expect(Math.min(Math.abs(positions.getX(i)), Math.abs(positions.getZ(i)))).toBeLessThan(1e-6);
    expect(first.pads[0].glyph.rotation.y).toBeCloseTo(Math.PI / 2);
    for (const pad of first.pads) expect(Math.hypot(pad.text.sprite.position.x, pad.text.sprite.position.z)).toBeGreaterThan(f.route.def.radius);
    const intrusion = { alive: true, homeRoom: f.world.rooms[2], pos: f.game.player.pos.clone() }; f.game.enemies.push(intrusion);
    f.route.update(f.game, .05); expect(first.title.sprite.visible).toBe(false); expect(first.pads.every((p: any) => !p.root.visible)).toBe(true);
    expect(f.route.read).toBe(0); expect(f.route.hold).toBe(0); expect(f.route.hint()).toContain('전투 중');
    intrusion.alive = false; f.route.update(f.game, 1); f.game.player.pos.copy(f.gate.pads[0].pos);
    f.route.update(f.game, 1); expect(first.sand.position.y).toBe(.41); f.route.update(f.game, .01);
    expect(first.sand.position.y).toBe(1.2); expect(first.pads.every((p: any) => !p.root.visible)).toBe(true);
    expect(labels).toContain('복원 완료');
    f.route.finish(false); expect(view.group.visible).toBe(false); expect(first.root.visible).toBe(false);
  } finally { f.route.stop(); view?.dispose(); restoreDocument(); }
});

test('owned geometry/material/texture dispose exactly once; stop and missing canvas leave no group behind', () => {
  const restoreDocument = documentFixture([]), f = fixture(); let view: any;
  try {
    view = new AstralConstellationView(f.scene, f.route); f.route.view = view;
    const owned = [...view.geometries, ...view.materials, ...view.textures]; let disposals = 0;
    for (const item of owned) item.addEventListener('dispose', () => disposals++);
    f.route.stop(); f.route.stop(); view.dispose(); view.update();
    expect(disposals).toBe(owned.length); expect(f.scene.children).toHaveLength(0);
  } finally { f.route.stop(); restoreDocument(); }
  const restoreFailedDocument = documentFixture([], false), other = fixture();
  try { expect(() => new AstralConstellationView(other.scene, other.route)).toThrow(); expect(other.scene.children).toHaveLength(0); }
  finally { other.route.stop(); restoreFailedDocument(); }
});

test('concurrent prepare shares one group, stopped late import never attaches, and a new route starts without old markers', async () => {
  const restoreDocument = documentFixture([]);
  try {
    const f = fixture(); const a = f.route.prepareView(f.scene), b = f.route.prepareView(f.scene); await Promise.all([a, b]);
    expect(f.scene.children).toHaveLength(1); expect(f.route.view).toBeInstanceOf(AstralConstellationView);
    f.route.stop(); expect(f.scene.children).toHaveLength(0);
    const late = fixture(), pending = late.route.prepareView(late.scene); late.route.stop(); await pending;
    expect(late.route.view).toBeNull(); expect(late.scene.children).toHaveLength(0);
    await late.route.prepareView(late.scene); expect(late.scene.children).toHaveLength(0);
    const next = fixture(); await next.route.prepareView(next.scene);
    expect(next.route.progress).toBe(0); expect(next.scene.children).toHaveLength(1); next.route.stop();
  } finally { restoreDocument(); }
});


test('PAD-only compact canvases retain full contrast drawing and identities without increasing texture count', () => {
  const previous=Object.getOwnPropertyDescriptor(globalThis,'document');
  const canvases:any[]=[];
  Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement:()=>{
    const canvas:any={width:0,height:0,rects:[],texts:[]};
    const context:any={font:'',clearRect:(...rect:number[])=>canvas.rects.push(rect),fillRect:(...rect:number[])=>canvas.rects.push(rect),
      fillText:(text:string,x:number,y:number)=>canvas.texts.push({text,x,y,font:context.font})};
    canvas.getContext=()=>context;canvases.push(canvas);return canvas;
  }}});
  const f=fixture();let view:any;
  try {
    view=new AstralConstellationView(f.scene,f.route);f.route.view=view;
    expect(view.textures.size).toBe(16);expect(canvases.filter(c=>c.width===512&&c.height===176)).toHaveLength(4);
    const pads=canvases.filter(c=>c.width===256&&c.height===88);expect(pads).toHaveLength(12);
    for(const canvas of pads) {
      expect(canvas.rects.every((r:number[])=>r[0]===0&&r[1]===0&&r[2]===256&&r[3]===88)).toBe(true);
      expect(canvas.texts.some((t:any)=>['A △','B ○','C ◇'].includes(t.text)&&t.font==='bold 32px sans-serif'&&t.x===128&&t.y===34)).toBe(true);
      expect(canvas.texts.some((t:any)=>t.text==='1초 유지'&&t.font==='bold 28px sans-serif'&&t.x===128&&t.y===70)).toBe(true);
    }
    for(const canvas of canvases.filter(c=>c.width===512))expect(canvas.rects.every((r:number[])=>r[2]===512&&r[3]===176)).toBe(true);
    for(const entry of view.entries)for(const pad of entry.pads)expect(Math.hypot(pad.text.sprite.position.x,pad.text.sprite.position.z)).toBeGreaterThan(f.route.def.radius);
    f.route.update(f.game,1);f.game.player.pos.copy(f.gate.pads[0].pos);f.route.update(f.game,.3);
    const drawn=view.entries[0].pads[0].text.texture.image.texts;
    expect(drawn.some((t:any)=>t.text==='0.3 / 1초'&&t.font==='bold 28px sans-serif')).toBe(true);
  } finally {
    f.route.stop();view?.dispose();
    if(previous)Object.defineProperty(globalThis,'document',previous);else Reflect.deleteProperty(globalThis,'document');
  }
});
