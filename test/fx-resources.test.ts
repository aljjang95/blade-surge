import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { ImpactLights } from '../src/engine/impact-lights.js';
import { FX, ParticlePool } from '../src/engine/fx.js';
import { VFX_TEX } from '../src/engine/assets.js';

test('입자 부분 업로드는 생성·swap 제거·빈 풀·재발사에서도 그리는 구간과 일치한다', () => {
  const pool = new ParticlePool(new THREE.Scene(), { max: 8, texture: new THREE.Texture() });
  const attributes = pool.geo.attributes as Record<string, THREE.BufferAttribute>;
  const version = attributes.position.version;
  pool.update(.1); expect(attributes.position.version).toBe(version);
  pool.emit(0, 1, 0, 1, 0, 0, new THREE.Color(0xff0000), 1, .15, { grav: 0, drag: 1 });
  pool.emit(5, 1, 0, 2, 0, 0, new THREE.Color(0x00ff00), 1, 2, { grav: 0, drag: 1 });
  pool.update(.1);
  expect(pool.geo.drawRange.count).toBe(2);
  for (const a of Object.values(attributes)) expect(a.updateRanges).toEqual([{ start: 0, count: 2 * a.itemSize }]);
  pool.update(.1); expect(pool.n).toBe(1); expect(pool.pos[0]).toBeCloseTo(5.4, 5);
  expect(pool.col[0]).toBe(0); expect(pool.col[1]).toBe(1);
  for (const a of Object.values(attributes)) expect(a.updateRanges).toEqual([{ start: 0, count: a.itemSize }]);
  pool.update(3); expect(pool.geo.drawRange.count).toBe(0);
  const emptyVersion = attributes.position.version; pool.update(.1);
  expect(attributes.position.version).toBe(emptyVersion);
  pool.emit(9, 1, 0, 0, 0, 0, new THREE.Color(0x0000ff), 2, 1, { grav: 0, drag: 1 });
  pool.update(.01); expect(pool.n).toBe(1); expect(pool.pos[0]).toBe(9); expect(pool.col[2]).toBe(1);
  pool.geo.dispose(); pool.mat.dispose();
});

test('타격 조명은 생성·소멸·포화·전투 초기화 뒤에도 같은 네 노드를 유지한다', () => {
  const scene = new THREE.Scene(), pool = new ImpactLights(scene);
  const nodes = [...scene.children];
  for (let i = 0; i < 20; i++) pool.emit(new THREE.Vector3(i, 0, 0), 0xffcc66, 10, 8, .4);
  expect(scene.children).toEqual(nodes); expect(nodes.length).toBe(4);
  expect(nodes.every((n) => n.visible)).toBe(true);
  expect(pool.slots.some((s) => s.light.position.x === 19)).toBe(true);
  pool.update(.5);
  expect(pool.slots.every((s) => s.light.intensity === 0 && s.light.visible)).toBe(true);
  pool.clear(); expect(scene.children).toEqual(nodes);
  pool.setEnabled(false); pool.emit(new THREE.Vector3(), 0xffffff, 10, 8, 1);
  expect(pool.slots.every((s) => !s.light.visible && s.light.intensity === 0)).toBe(true);
  pool.setEnabled(true); expect(scene.children).toEqual(nodes); expect(nodes.every((n) => n.visible)).toBe(true);
});

test('효과 색은 재질 보관 수를 늘리지 않고 서로의 색/투명도도 공유하지 않는다', () => {
  const fx = Object.create(FX.prototype); fx._mats = {};
  const red = fx._keep(new THREE.MeshBasicMaterial({ color: 0xff0000, transparent: true, side: THREE.DoubleSide }));
  const blue = fx._keep(new THREE.MeshBasicMaterial({ color: 0x0000ff, transparent: true, side: THREE.DoubleSide }));
  red.opacity = .2;
  expect(Object.keys(fx._mats).length).toBe(1); expect(blue.opacity).toBe(1);
  const retained = Object.values(fx._mats)[0] as THREE.MeshBasicMaterial;
  expect(retained).not.toBe(red); expect(retained.color.getHex()).toBe(0xff0000);
  expect(blue.color.getHex()).toBe(0x0000ff);
  red.dispose(); blue.dispose(); expect(retained.opacity).toBe(1); retained.dispose();
});

test('효과 강제 종료는 종료 콜백과 전용 지오메트리를 한 번 정리하고 공유 면은 보존한다', () => {
  const fx = Object.create(FX.prototype); fx.scene = new THREE.Scene(); fx.items = [];
  const owned = new THREE.BufferGeometry(), shared = new THREE.BufferGeometry();
  let ownedDisposed = 0, sharedDisposed = 0, ended = 0;
  owned.addEventListener('dispose', () => ownedDisposed++); shared.addEventListener('dispose', () => sharedDisposed++);
  const group = new THREE.Group();
  const a = new THREE.Mesh(owned, new THREE.MeshBasicMaterial()), b = new THREE.Mesh(shared, new THREE.MeshBasicMaterial()); a.userData.ownGeo = true; group.add(a, b);
  fx.add(group, 1, undefined, () => ended++); fx._finishItem(0);
  expect(fx.items.length).toBe(0); expect(group.parent).toBeNull();
  expect(ended).toBe(1); expect(ownedDisposed).toBe(1); expect(sharedDisposed).toBe(0);
  shared.dispose(); a.material.dispose(); b.material.dispose();
});

test('잔상의 인덱스 버퍼는 원본 캐릭터의 GPU 자원과 독립적이다', () => {
  const fx = Object.create(FX.prototype); fx.scene = new THREE.Scene(); fx.items = []; fx._mats = {}; fx.quality = 'high';
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute([0,0,0,1,0,0,0,1,0],3)); geometry.setIndex([0,1,2]);
  const source = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  Object.assign(source, { isSkinnedMesh: true, getVertexPosition: (i: number, out: THREE.Vector3) => out.fromBufferAttribute(geometry.attributes.position, i) });
  fx.ghost(source, 0xffffff);
  const copy = fx.items[0].obj.children[0].geometry as THREE.BufferGeometry;
  expect(copy.index).not.toBe(geometry.index); expect([...copy.index!.array]).toEqual([...geometry.index!.array]);
  fx._finishItem(0); expect([...geometry.index!.array]).toEqual([0,1,2]);
  geometry.dispose(); source.material.dispose();
  for (const m of Object.values(fx._mats)) (m as THREE.Material).dispose();
});

test('프레임 속도가 바뀌어도 텍스처 효과는 같은 시간 동안 같은 각도만 회전한다', () => {
  const texture = new THREE.Texture(), textures = VFX_TEX as Record<string, THREE.Texture>; textures.test_rotation = texture;
  try {
    for (const hz of [30,60,120]) {
      const fx = Object.create(FX.prototype); fx.scene = new THREE.Scene(); fx.items = []; fx._mats = {};
      const sprite = fx.texFlash(new THREE.Vector3(), 'test_rotation', 0xffffff, { spin: 1, life: 2 });
      const angle = sprite.material.rotation;
      for (let i=0;i<hz;i++) fx.items[0].update((i+1)/hz/2,(i+1)/hz,1/hz);
      expect(sprite.material.rotation-angle).toBeCloseTo(1,8);
      fx._finishItem(0); for (const m of Object.values(fx._mats)) (m as THREE.Material).dispose();
    }
  } finally { delete textures.test_rotation; texture.dispose(); }
});

function fireFixture() {
  const fx:any=Object.create(FX.prototype);
  Object.assign(fx,{scene:new THREE.Scene(),camera:new THREE.PerspectiveCamera(),items:[],_mats:{},_transparentMats:new Map(),_depthMats:new Map(),
    plane1:new THREE.PlaneGeometry(1,1),plane2:new THREE.PlaneGeometry(2,2),trails:[],clearDamage:()=>{}});
  fx.impactLights=new ImpactLights(fx.scene);
  for(const key of ['sparks','glow','smoke'])fx[key]={n:0,geo:new THREE.BufferGeometry(),mat:new THREE.ShaderMaterial(),mesh:new THREE.Object3D(),update:()=>{}};
  return fx;
}

test('동시 화염 40개는 원본 텍스처를 복제하지 않고 교차면과 독립 수명을 유지한다',()=>{
  const textures=VFX_TEX as Record<string,THREE.Texture>,old=textures.fire_pillar,texture=new THREE.Texture();textures.fire_pillar=texture;
  texture.clone=()=>{throw new Error('fire texture must stay shared');};
  const original={offset:texture.offset.clone(),wrap:texture.wrapT,version:texture.version};
  let textureDisposals=0;texture.addEventListener('dispose',()=>textureDisposals++);
  const fx=fireFixture(),materials:THREE.ShaderMaterial[]=[],disposed=new Map<THREE.ShaderMaterial,number>();
  let planeDisposals=0;fx.plane1.addEventListener('dispose',()=>planeDisposals++);
  try {
    for(let i=0;i<40;i++) {
      const group=fx.firePillar(new THREE.Vector3(i,0,0),{height:8,width:3,life:i<20?.5:2,color:i%2?0xff0000:0x00ff00});
      expect(group.children).toHaveLength(2);
      const [a,b]=group.children as THREE.Mesh<THREE.PlaneGeometry,THREE.ShaderMaterial>[];
      expect(a.geometry).toBe(fx.plane1);expect(b.geometry).toBe(fx.plane1);expect(a.material).toBe(b.material);
      expect(a.scale.toArray()).toEqual([3,8,1]);expect(a.position.y).toBe(4);expect(b.rotation.y).toBeCloseTo(Math.PI/2);
      expect(a.material.uniforms.map.value).toBe(texture);expect(a.material.uniforms.diffuse.value.getHex()).toBe(i%2?0xff0000:0x00ff00);
      materials.push(a.material);disposed.set(a.material,0);a.material.addEventListener('dispose',()=>disposed.set(a.material,disposed.get(a.material)!+1));
    }
    expect(fx.items).toHaveLength(40);expect(new Set(materials).size).toBe(40);expect(Object.keys(fx._mats)).toEqual(['firePillar']);
    fx.update(.2);expect(materials[0].uniforms.uOffset.value).toBeCloseTo(-.32);
    fx.update(.4);expect(fx.items).toHaveLength(20);
    expect(materials.slice(0,20).every(m=>disposed.get(m)===1)).toBe(true);
    const fresh=fx.firePillar(new THREE.Vector3(),{life:3});
    fx.update(.1);expect(fresh.children[0].material.uniforms.uOffset.value).toBeCloseTo(-.16);
    expect(materials[20].uniforms.uOffset.value).toBeCloseTo(-1.12);
    fx.clearAll();fx.clearAll();expect(fx.items).toHaveLength(0);expect([...disposed.values()].every(n=>n===1)).toBe(true);
    expect(planeDisposals).toBe(0);expect(textureDisposals).toBe(0);
    expect(texture.offset.equals(original.offset)).toBe(true);expect(texture.wrapT).toBe(original.wrap);expect(texture.version).toBe(original.version);
    let warmDisposed=0;fx._mats.firePillar.addEventListener('dispose',()=>warmDisposed++);
    fx.dispose();fx.dispose();expect(planeDisposals).toBe(1);expect(warmDisposed).toBe(1);expect(textureDisposals).toBe(0);expect(fx.scene.children).toHaveLength(0);
  } finally {fx.dispose();if(old)textures.fire_pillar=old;else delete textures.fire_pillar;texture.dispose();}
});

test('화염 UV와 크기·소멸 곡선은 30/60/120Hz에서 같은 경과시간으로 갱신된다',()=>{
  const textures=VFX_TEX as Record<string,THREE.Texture>,old=textures.fire_pillar;textures.fire_pillar=new THREE.Texture();
  try {
    for(const hz of [30,60,120]) {
      const fx=fireFixture(),group=fx.firePillar(new THREE.Vector3(),{life:1});
      for(let i=0;i<hz*.8;i++)fx.update(1/hz);
      const material=group.children[0].material;
      expect(material.uniforms.uOffset.value).toBeCloseTo(-1.28,7);expect(material.uniforms.opacity.value).toBeCloseTo(.5,7);
      expect(group.scale.y).toBeCloseTo(1.08,7);fx.update(.3);expect(fx.items).toHaveLength(0);fx.dispose();
    }
  } finally {textures.fire_pillar.dispose();if(old)textures.fire_pillar=old;else delete textures.fire_pillar;}
});

test('prepare는 공유 화염 셰이더를 실제 컴파일 호출에 포함하고 렌더 타깃을 복원한다',async()=>{
  const root=globalThis as any,oldDocument=root.document,oldRaf=root.requestAnimationFrame;
  const gradient={addColorStop:()=>{}},context={createRadialGradient:()=>gradient,createLinearGradient:()=>gradient,fillRect:()=>{},clearRect:()=>{}};
  root.document={createElement:()=>({getContext:()=>context})};root.requestAnimationFrame=(fn:any)=>{fn(0);return 1;};
  const textures=VFX_TEX as Record<string,THREE.Texture>,old=textures.fire_pillar,texture=new THREE.Texture();textures.fire_pillar=texture;
  texture.clone=()=>{throw new Error('warmup must not clone fire texture');};
  const fx=fireFixture();for(const method of ['flash','ring','pillar','flipbook'])fx[method]=()=>{};
  const previous={},target={},compiled:THREE.ShaderMaterial[]=[],initialized:THREE.Texture[]=[];let current=previous;
  const renderer={getRenderTarget:()=>current,setRenderTarget:(t:any)=>{current=t;},shadowMap:{enabled:false},initTexture:(t:THREE.Texture)=>initialized.push(t),
    compileAsync:async(scene:THREE.Scene)=>{expect(current).toBe(target);scene.traverse((o:any)=>{if(o.material?.uniforms?.uOffset)compiled.push(o.material);});}};
  try {
    await fx.prepare(renderer,{},target);
    expect(compiled).toHaveLength(1);expect(compiled[0]).toBe(fx._mats.firePillar);expect(compiled[0].uniforms.map.value).toBe(texture);
    expect(compiled[0].fragmentShader).not.toContain('fract( vMapUv.y + uOffset )');
    expect(compiled[0].fragmentShader).toContain('sin( vMapUv.y * 3.141593 ) * sin( vMapUv.x * 3.141593 )');
    expect(compiled[0].fragmentShader).toContain('#include <fog_fragment>');
    expect(initialized.filter(t=>t===texture)).toHaveLength(1);expect(fx.items).toHaveLength(0);expect(current).toBe(previous);
    expect(fx.firePillar(new THREE.Vector3()).children).toHaveLength(2);
  } finally {fx.dispose();root.document=oldDocument;root.requestAnimationFrame=oldRaf;if(old)textures.fire_pillar=old;else delete textures.fire_pillar;texture.dispose();}
});
