import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { ENCOUNTER_MODELS, CAMPAIGN_MODELS } from '../src/data/encounter-models.js';
import { ENEMIES, stageDef } from '../src/data/stages.js';
import { rigOf, RIGS } from '../src/data/rigs.js';
import sources from '../tools/art/encounter-sources.json';
const variants = ENCOUNTER_MODELS as Record<string, {base:string,file:string,remove?:string[]}>;
const enemies = ENEMIES as Record<string, any>;
const read = (relative:string) => readFileSync(new URL('../'+relative,import.meta.url));
const glb = (bytes:Buffer) => JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString());

describe('Source-bound regional encounter geometry',()=>{
  test('original character files remain exact and all authored joints still bind',()=>{
    for(const [name,sha] of Object.entries(sources))expect(createHash('sha256').update(read(`public/models/${name}.glb`)).digest('hex')).toBe(sha);
    let totalBytes=0;
    for(const [name,variant] of Object.entries(variants)){
      const bytes=read(`public/models/tll/encounters/${variant.file}.glb`);totalBytes+=bytes.length;
      const fitting=glb(bytes),base=glb(read(`public/models/${variant.base}.glb`));
      const bones=new Set(base.skins.flatMap((s:any)=>s.joints.map((i:number)=>base.nodes[i].name.replaceAll('.',''))));
      const nodes=fitting.nodes.filter((n:any)=>n.mesh!==undefined);
      expect(nodes.length).toBeGreaterThan(0);
      for(const node of nodes)expect(bones.has(node.extras?.tllBone?.replaceAll('.',''))).toBe(true);
      expect(fitting.animations?.length||0).toBe(0);expect(fitting.images?.length||0).toBe(0);
      expect(fitting.materials.length).toBeLessThanOrEqual(3);
      const triangles=fitting.meshes.flatMap((m:any)=>m.primitives).reduce((sum:number,p:any)=>sum+fitting.accessors[p.indices].count/3,0);
      expect(triangles).toBeGreaterThan(100);expect(triangles).toBeLessThan(16000);
      expect(rigOf(name)).toBe(rigOf(variant.base));
      const rig=RIGS[rigOf(name)],clips=new Set(base.animations.map((a:any)=>a.name));
      for(const clip of [rig.idle,rig.run,rig.attack,rig.attackJump,rig.cast])expect(clips.has(clip)).toBe(true);
    }
    // No duplicated base model textures/animation files for these six bosses.
    expect(totalBytes).toBeLessThan(1_000_000);
  });
  test('all six campaign finales actually select a distinct authored actor',()=>{
    expect(new Set(Object.values(CAMPAIGN_MODELS)).size).toBe(6);
    for(let chapter=1;chapter<=6;chapter++){
      const stage=stageDef(chapter,10),def=enemies[stage.encounter.enemyId];
      expect(variants[def.model]).toBeDefined();expect(def.boss).toBe(true);
      expect(def.hp).toBe(53200);expect(def.atk).toBe(53);expect(def.scale).toBe(2.25);
    }
    expect(enemies.crown_finalboss.weapon).toBe('Skeleton_Blade');
  });
});
