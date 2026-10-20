/** 실행: bun run dev --host 127.0.0.1 --port 5181 --strictPort
 * PowerShell: $env:CHROME_PATH='C:\Program Files\Google\Chrome\Application\chrome.exe'
 * node tools/art/gear-icon-studio.mjs [--url http://127.0.0.1:5181] [--only id,id] [--runtime]
 * 이 도구는 실행 중인 Vite를 사용한다. 직접 시작한 dev 서버는 완료 후 종료한다.
 * 런타임 파일은 public/img/gear/<id>.webp 뿐이다. 검수판·상세 영수증·영웅 장착 캡처는 work/gear-review/에 쓴다.
 * 전체 실행만 추적 매니페스트(tools/art/gear-icon-studio.manifest.json)와 검수판을 교체한다.
 * --only 부분 실행은 아이콘과 work/gear-review/partial-*.json만 쓰며 전체 영수증·검수판을 덮어쓰지 않는다.
 */
import { chromium } from 'playwright';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i < 0 ? fallback : process.argv[i + 1]; };
const output = fileURLToPath(new URL('../../public/img/gear/', import.meta.url));
const reviewDir = fileURLToPath(new URL('../../work/gear-review/', import.meta.url));
const manifestPath = fileURLToPath(new URL('./gear-icon-studio.manifest.json', import.meta.url));
const only = arg('--only', null), partial = !!only;
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [], receipt = [], samples = [];
try {
  await mkdir(output, { recursive: true }); await mkdir(reviewDir, { recursive: true });
  const page = await browser.newPage({ viewport: { width: 256, height: 256 } });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(`${arg('--url', 'http://127.0.0.1:5181')}/tools/art/gear-icon-studio.html`);
  await page.waitForFunction(() => window.gearIconReady, { timeout: 60000 });
  const all = await page.evaluate(() => window.gearIconItems);
  const ids = only?.split(',') || all;
  for (const id of ids) {
    if (!all.includes(id) || !/^[a-z0-9_]+$/.test(id)) throw Error(`아이콘 대상 아님: ${id}`);
    const result = await page.evaluate(id => window.renderGearIcon(id), id);
    const raw = Buffer.from(result.data.split(',')[1], 'base64');
    const bytes = await sharp(raw).resize(256, 256, { kernel: 'lanczos3' }).webp({ quality: 96, alphaQuality: 100 }).toBuffer();
    const metadata = await sharp(bytes).metadata(), stats = await sharp(bytes).stats();
    if (metadata.width !== 256 || metadata.height !== 256 || !metadata.hasAlpha || stats.channels[3].max === 0 || stats.channels[3].min !== 0) throw Error(`투명 렌더 검증 실패: ${id}`);
    await writeFile(`${output}/${id}.webp`, bytes);
    const { channels } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true }).then(result => ({ channels: result.data }));
    let left = 256, top = 256, right = 0, bottom = 0;
    for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) if (channels[(y * 256 + x) * 4 + 3] > 16) {
      left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
    }
    receipt.push({ id, width: 256, height: 256, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), drawCalls: result.drawCalls, alphaBounds: { left, top, right, bottom }, frameOccupancy: Math.max(right - left + 1, bottom - top + 1) / 256 });
    samples.push({ id, bytes });
  }
  if (errors.length) throw Error(errors.join('\n'));
  if (process.argv.includes('--runtime')) {
    const runtime = await page.evaluate(async () => {
      const THREE = await import('/node_modules/.vite/deps/three.js');
      const { loadModel, spawnCharacter, disposeCharacter } = await import('/src/engine/assets.js');
      const { applyLook, LOOKS } = await import('/src/game/look.js');
      const { HEROES } = await import('/src/data/heroes.js');
      const { itemForgeCacheSize } = await import('/src/engine/item-forge.js');
      const { RoomEnvironment } = await import('/node_modules/three/examples/jsm/environments/RoomEnvironment.js');
      const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
      renderer.setSize(768, 768); renderer.setClearColor(0x123044, 1);
      renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping;
      const scene = new THREE.Scene(), pmrem = new THREE.PMREMGenerator(renderer), room = new RoomEnvironment();
      const env = pmrem.fromScene(room); scene.environment = env.texture; room.dispose(); pmrem.dispose();
      scene.add(new THREE.HemisphereLight(0xe9f2ff, 0x324151, 1.5));
      const key = new THREE.DirectionalLight(0xffffff, 3); key.position.set(-3, 5, 6); scene.add(key);
      const camera = new THREE.PerspectiveCamera(32, 1, .01, 100), results = [];
      for (const heroId of Object.keys(LOOKS)) {
        const hero = HEROES[heroId], source = await loadModel(hero.model), instance = spawnCharacter(source);
        const stage = new THREE.Group(); stage.add(instance.root); scene.add(stage);
        instance.mixer.clipAction(instance.clips.Idle || Object.values(instance.clips)[0]).play(); instance.mixer.update(.1);
        const bounds = new THREE.Box3().setFromObject(stage), center = bounds.getCenter(new THREE.Vector3()), size = bounds.getSize(new THREE.Vector3());
        stage.position.sub(center); camera.position.set(size.y * .8, size.y * .15, size.y * 2.8); camera.lookAt(0, 0, 0);
        applyLook(instance.root, hero, {}); renderer.render(scene, camera); const baselineCalls = renderer.info.render.calls;
        for (const id of ['w_iron', 'w_flame', 'w_frost', 'gear_weapon_e_1', 'w_dragon']) {
          applyLook(instance.root, hero, { weapon: { id, enh: 0 } }); renderer.render(scene, camera);
          const states = [...instance.root.userData.itemWeaponAppearance.values()];
          if (!states.length || states.some(state => state.itemId !== id)) throw Error(`실제 영웅 장착 실패: ${heroId}:${id}`);
          const calls = renderer.info.render.calls;
          if (calls > baselineCalls + 1) throw Error(`영웅 드로우콜 증가: ${heroId}:${id}:${calls}/${baselineCalls}`);
          results.push({ heroId, id, identity: instance.root.userData.authoredContract?.assetId || instance.root.userData.tllIdentity, baselineCalls, drawCalls: calls, nodes: states.map(state => state.node.name), capture: id === 'w_flame' ? renderer.domElement.toDataURL('image/webp', .96) : null });
        }
        applyLook(instance.root, hero, {}); disposeCharacter(instance.root, instance.mixer); stage.removeFromParent();
      }
      const cacheSize = itemForgeCacheSize(); if (cacheSize !== 0) throw Error(`폐기 후 캐시 누수: ${cacheSize}`);
      renderer.dispose(); env.dispose(); return { results, cacheSize };
    });
    for (const entry of runtime.results) if (entry.capture) {
      await writeFile(`${reviewDir}/_runtime_${entry.heroId}.webp`, Buffer.from(entry.capture.split(',')[1], 'base64')); delete entry.capture;
    }
    await writeFile(`${reviewDir}/runtime-receipt.json`, JSON.stringify({ ...runtime, errors, observedAt: new Date().toISOString() }, null, 2));
    if (errors.length) throw Error(errors.join('\n'));
    console.log(`실제 영웅 5명 × 무기 5종 렌더 · 폐기 후 캐시 ${runtime.cacheSize}`);
  }
  const sources = ['src/data/gear-catalog.js', 'src/data/items.js', 'src/engine/item-forge.js', 'src/game/armor-appearance.js', 'tools/art/gear-icon-studio.html'];
  // Windows autocrlf 체크아웃에서도 같은 값이 나오도록 줄바꿈을 LF 로 정규화해 소스를 해시한다.
  const sourceHashes = Object.fromEntries(await Promise.all(sources.map(async path => [path, createHash('sha256').update((await readFile(fileURLToPath(new URL('../../' + path, import.meta.url)), 'utf8')).replace(/\r\n/g, '\n')).digest('hex')])));
  const observedAt = new Date().toISOString();
  if (partial) {
    await writeFile(`${reviewDir}/partial-${observedAt.replace(/[:.]/g, '-')}.json`, JSON.stringify({ partial: true, sourceHashes, observedAt, items: receipt, errors }, null, 2));
    console.log(`부분 아이콘 ${receipt.length}종 · 전체 매니페스트·검수판은 유지 · 전체 실행으로 다시 고정해야 테스트가 통과한다`);
  } else {
    const thumb = 144, labelHeight = 25, columns = 10, rows = Math.ceil(samples.length / columns);
    const tiles = await Promise.all(samples.map(async ({ id, bytes }, i) => {
      const label = Buffer.from(`<svg width="${thumb}" height="${labelHeight}"><rect width="100%" height="100%" fill="#0d2333"/><text x="72" y="17" text-anchor="middle" font-family="Arial" font-size="10" fill="#eaf5ff">${id}</text></svg>`);
      const input = await sharp({ create: { width: thumb, height: thumb + labelHeight, channels: 4, background: '#123044' } }).composite([
        { input: await sharp(bytes).resize(thumb, thumb).png().toBuffer(), top: 0, left: 0 }, { input: label, top: thumb, left: 0 },
      ]).png().toBuffer();
      return { input, left: i % columns * thumb, top: Math.floor(i / columns) * (thumb + labelHeight) };
    }));
    await sharp({ create: { width: columns * thumb, height: rows * (thumb + labelHeight), channels: 4, background: '#123044' } }).composite(tiles).webp({ quality: 95 }).toFile(`${reviewDir}/_review.webp`);
    await writeFile(`${reviewDir}/render-receipt.json`, JSON.stringify({ renderer: 'Three.js/Chrome WebGL2', source: '작업 트리의 item-forge와 casual-v2 방어구', sourceHashes, observedAt, items: receipt, errors }, null, 2));
    // 추적 매니페스트는 테스트가 아이콘과 렌더 소스의 일치를 확인하는 최소 정보만 담는다.
    await writeFile(manifestPath, JSON.stringify({ sourceHashes, items: receipt.map(({ id, sha256 }) => ({ id, sha256 })) }, null, 2) + '\n');
    console.log(`아이콘 ${receipt.length}종 · 256×256 투명 WebP · 브라우저 오류 ${errors.length}`);
  }
} finally { await browser.close(); }
