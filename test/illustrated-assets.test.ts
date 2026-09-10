import {test,expect} from 'bun:test';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {RESOURCE_ART} from '../src/ui/illustrated.js';

const root=new URL('../public/img/ui-crafted/',import.meta.url);
test('all accepted GUI originals have distinct, intact runtime artwork',()=>{
  const manifest=JSON.parse(readFileSync(new URL('manifest.json',root),'utf8'));
  expect(manifest.assets).toHaveLength(50);
  expect(manifest.sets.map((s:any)=>s.accepted)).toEqual([10,10,10,10,10]);
  expect(new Set(manifest.assets.map((a:any)=>a.originalSha256)).size).toBe(50);
  const ids=new Set<string>();let bytes=0;
  for(const asset of manifest.assets){
    expect(asset.id).toMatch(/^[a-z0-9-]+$/);ids.add(asset.id);
    const data=readFileSync(new URL(`${asset.id}.webp`,root));bytes+=data.length;
    expect(data.subarray(0,4).toString()).toBe('RIFF');
    expect(data.subarray(8,12).toString()).toBe('WEBP');
    expect(createHash('sha256').update(data).digest('hex')).toBe(asset.runtimeSha256);
    expect(data.length).toBe(asset.runtimeBytes);
    expect(asset.runtimePixels).toEqual([384,384]);
  }
  expect(ids.size).toBe(50);
  expect(readdirSync(root).filter(n=>n.endsWith('.webp')).length).toBe(50);
  expect(bytes).toBeLessThan(2_000_000);
  for(const id of Object.values(RESOURCE_ART))expect(ids.has(id)).toBe(true);
  for(const file of ['src/ui/illustrated.css','src/ui/arsenal.js','src/ui/rpg.js','src/ui/masterworks.js','src/ui/journey.js']){
    const source=readFileSync(new URL('../'+file,import.meta.url),'utf8');
    for(const match of source.matchAll(/\/img\/ui-crafted\/([a-z0-9-]+)\.webp/g))expect(ids.has(match[1])).toBe(true);
  }
});
