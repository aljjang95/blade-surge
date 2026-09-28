import {expect,test} from 'bun:test';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {BOONS} from '../src/data/masterworks.js';
import {COMBAT_ARTS} from '../src/data/combat-arts.js';
import {ENGRAVING_ART} from '../src/data/engraving-art.js';

test('engraving catalogue ships intact artwork for every existing choice without exposing reserves as gameplay',()=>{
  const root=new URL('../public',import.meta.url);
  const read=(path:string)=>readFileSync(new URL(`.${path}`,root.href+'/'));
  const digest=(data:Buffer)=>createHash('sha256').update(data).digest('hex');
  const manifest=JSON.parse(read('/img/ui-crafted/engraving/manifest.json').toString());
  const files=readdirSync(new URL('./img/ui-crafted/engraving/',root.href+'/'));
  expect(manifest.assets).toHaveLength(120);expect(files.filter(f=>f.endsWith('.webp'))).toHaveLength(120);
  expect(files.filter(f=>f.endsWith('.svg'))).toHaveLength(0);
  expect(manifest.sheets).toHaveLength(10);
  expect(new Set(manifest.sheets.map((s:any)=>s.sha256)).size).toBe(10);
  for(const sheet of manifest.sheets){
    const bytes=readFileSync(new URL(`../art/engraving-gui/${sheet.file}`,import.meta.url));
    expect(bytes.subarray(1,4).toString()).toBe('PNG');
    expect(bytes.readUInt32BE(16)).toBe(sheet.width);expect(bytes.readUInt32BE(20)).toBe(sheet.height);
    expect(digest(bytes)).toBe(sheet.sha256);
    expect(manifest.assets.filter((a:any)=>a.sourceSha256===sheet.sha256)).toHaveLength(12);
  }
  expect(manifest.assets.filter((a:any)=>a.role==='runtime')).toHaveLength(15);
  expect(manifest.assets.filter((a:any)=>a.role==='reserve')).toHaveLength(105);
  expect(new Set(manifest.assets.map((a:any)=>a.sha256)).size).toBe(120);
  expect(Object.keys(ENGRAVING_ART).sort()).toEqual([...BOONS.map(b=>`boon-${b.id}`),...COMBAT_ARTS.map(a=>`art-${a.id}`)].sort());
  expect(new Set(Object.values(ENGRAVING_ART)).size).toBe(15);
  const connected=new Set(Object.values(ENGRAVING_ART));
  for(const asset of manifest.assets){
    const bytes=read(asset.path);
    expect(digest(bytes)).toBe(asset.sha256);expect(bytes.length).toBe(asset.bytes);
    expect(asset.width).toBe(320);expect(asset.height).toBe(320);
    expect(bytes.subarray(0,4).toString()).toBe('RIFF');expect(bytes.subarray(8,12).toString()).toBe('WEBP');
    expect(asset.classification).toBe('crop-derivative');
    expect(asset.sourceCell).toBeGreaterThanOrEqual(1);expect(asset.sourceCell).toBeLessThanOrEqual(12);
    expect(connected.has(asset.path)).toBe(asset.role==='runtime');
  }
  const original=JSON.parse(read('/img/ui-crafted/manifest.json').toString());
  for(const item of manifest.originals){
    const id=item.path.split('/').pop().replace('.webp','');
    expect(item.sha256).toBe(original.assets.find((a:any)=>a.id===id).runtimeSha256);
    expect(digest(read(item.path))).toBe(item.sha256);
  }
});
