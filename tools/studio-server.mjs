// 게임 저장·배포 권한을 갖지 않는 로컬 제작 라이브러리.
import http from 'node:http';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, readdir, lstat, realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const studioRoot = path.join(root, 'tools/studio');
const modelRoot = path.join(root, 'public/models');
const soundRoot = path.join(root, 'public/sfx/crafted');
const portValue = process.argv.find(value => value.startsWith('--port='));
const port = portValue ? Number(portValue.slice(7)) : 4310;
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('포트는 1–65535 정수여야 합니다.');
const startedAt = new Date().toISOString();
const uiFiles = new Map(['index.html', 'app.js', 'style.css'].map(file => [`/${file}`, path.join(studioRoot, file)]));
uiFiles.set('/', path.join(studioRoot, 'index.html'));
const vendorFiles = new Map([
  ['three.module.js', 'build/three.module.js'],
  ['addons/loaders/GLTFLoader.js', 'examples/jsm/loaders/GLTFLoader.js'],
  ['addons/controls/OrbitControls.js', 'examples/jsm/controls/OrbitControls.js'],
  ['addons/utils/BufferGeometryUtils.js', 'examples/jsm/utils/BufferGeometryUtils.js'],
  ['addons/environments/RoomEnvironment.js', 'examples/jsm/environments/RoomEnvironment.js'],
  ['addons/libs/meshopt_decoder.module.js', 'examples/jsm/libs/meshopt_decoder.module.js'],
].map(([url, file]) => [`/vendor/${url}`, path.join(root, 'node_modules/three', file)]));
const contentTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.bin': 'application/octet-stream', '.mp3': 'audio/mpeg' };
let catalogCache = null;
let catalogPromise = null;
let allowedAssets = new Set();
let statusCache = null;
let audioCache = null;
let allowedSounds = new Set();

async function regularFile(file, boundary) {
  const relative = path.relative(boundary, file);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('경로 범위 밖입니다.');
  let current = boundary;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if ((await lstat(current)).isSymbolicLink()) throw new Error('링크 경로는 지원하지 않습니다.');
  }
  const actualBoundary = await realpath(boundary);
  const actual = await realpath(file);
  if (path.relative(actualBoundary, actual).startsWith('..')) throw new Error('경로 범위 밖입니다.');
  if (!(await lstat(file)).isFile()) throw new Error('일반 파일이 아닙니다.');
  return file;
}

async function walk(directory) {
  const files = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    if (item.isSymbolicLink()) continue;
    const file = path.join(directory, item.name);
    if (item.isDirectory()) files.push(...await walk(file));
    else if (item.isFile()) files.push(file);
  }
  return files;
}

function parseGlb(bytes) {
  if (bytes.length < 20 || bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length) throw new Error('GLB 2 헤더/길이 불일치');
  let document;
  for (let offset = 12; offset < bytes.length;) {
    if (offset + 8 > bytes.length) throw new Error('GLB 청크 헤더 누락');
    const length = bytes.readUInt32LE(offset), type = bytes.readUInt32LE(offset + 4);
    if (offset + 8 + length > bytes.length || length % 4) throw new Error('GLB 청크 길이 오류');
    if (type === 0x4e4f534a) document = JSON.parse(bytes.subarray(offset + 8, offset + 8 + length).toString('utf8').trim());
    offset += 8 + length;
  }
  if (!document || document.asset?.version !== '2.0') throw new Error('glTF 2 JSON 누락');
  return document;
}

function findManifestEntry(manifest, filename) {
  for (const item of manifest?.assets || []) {
    if (path.basename(item.file || '') === filename) return item;
    if (path.basename(item.lod1?.file || '') === filename) return item.lod1;
  }
  return null;
}

async function buildCatalog() {
  const files = await walk(modelRoot);
  const manifests = new Map();
  for (const file of files.filter(file => path.basename(file) === 'manifest.json')) {
    try { manifests.set(path.dirname(file), JSON.parse(await readFile(await regularFile(file, modelRoot), 'utf8'))); } catch { /* 깨진 출처를 검증 성공으로 표시하지 않는다. */ }
  }
  const allowlist = new Set(), assets = [];
  for (const file of files.filter(file => file.endsWith('.glb')).sort()) {
    const relative = path.relative(modelRoot, file).split(path.sep).join('/');
    const asset = { id: relative, name: path.basename(file, '.glb'), group: relative.includes('/') ? relative.split('/').slice(0, -1).join('/') : 'CC0 원본', path: `/models/${relative}`, bytes: 0, observedAt: new Date().toISOString(), structuralError: null };
    try {
      const bytes = await readFile(await regularFile(file, modelRoot));
      const document = parseGlb(bytes);
      asset.bytes = bytes.length;
      asset.sha256 = createHash('sha256').update(bytes).digest('hex');
      asset.meshes = document.meshes?.length || 0;
      asset.materials = document.materials?.length || 0;
      asset.bones = new Set((document.skins || []).flatMap(skin => skin.joints || [])).size;
      asset.clips = (document.animations || []).map(animation => animation.name || '(이름 없음)');
      asset.extensions = document.extensionsRequired || [];
      asset.triangles = (document.meshes || []).flatMap(mesh => mesh.primitives || []).reduce((sum, primitive) => {
        const count = document.accessors?.[primitive.indices ?? primitive.attributes?.POSITION]?.count || 0;
        return sum + ((primitive.mode ?? 4) === 4 ? Math.floor(count / 3) : 0);
      }, 0);
      let manifestDirectory = path.dirname(file), manifest;
      while (!manifest && manifestDirectory.startsWith(modelRoot)) {
        manifest = manifests.get(manifestDirectory);
        if (manifestDirectory === modelRoot) break;
        if (!manifest) manifestDirectory = path.dirname(manifestDirectory);
      }
      const entry = findManifestEntry(manifest, path.basename(file));
      asset.label = entry?.labelKo || asset.name;
      const siblings = files.filter(candidate => candidate.endsWith('.glb') && path.dirname(candidate) === path.dirname(file));
      const expectedSha = entry?.sha256 || (siblings.length === 1 ? manifest?.sha256 : null);
      asset.manifest = manifest ? path.relative(root, path.join(manifestDirectory, 'manifest.json')).split(path.sep).join('/') : null;
      asset.manifestHash = expectedSha ? (expectedSha === asset.sha256 ? 'match' : 'mismatch') : 'unrecorded';
      asset.rights = manifest?.rights || manifest?.licence || manifest?.license || '별도 원본/출처 계약 확인 필요';
      asset.generator = manifest?.generator || null;
      asset.coordinateContract = manifest?.coordinateContract || manifest?.runtime || null;
      asset.bounds = entry?.boundsGltf || null;
      const dependencies = [...(document.images || []), ...(document.buffers || [])].filter(item => item.uri && !item.uri.startsWith('data:')).map(item => item.uri);
      asset.dependencies = dependencies;
      asset.missingDependencies = [];
      allowlist.add(file);
      for (const uri of dependencies) {
        if (/^[a-z]+:|^\/|\\|[?#]/i.test(uri) || !['.png', '.jpg', '.jpeg', '.webp', '.bin'].includes(path.extname(uri).toLowerCase())) {
          asset.missingDependencies.push(uri); continue;
        }
        try { allowlist.add(await regularFile(path.resolve(path.dirname(file), decodeURIComponent(uri)), modelRoot)); }
        catch { asset.missingDependencies.push(uri); }
      }
    } catch (error) { asset.structuralError = error.message; }
    assets.push(asset);
  }
  allowedAssets = allowlist;
  return { observedAt: new Date().toISOString(), source: 'public/models 실제 파일', count: assets.length, assets };
}

async function catalog() {
  if (catalogCache && Date.now() - catalogCache.time < 10000) return catalogCache.value;
  if (!catalogPromise) catalogPromise = buildCatalog().then(value => { catalogCache = { time: Date.now(), value }; return value; }).finally(() => { catalogPromise = null; });
  return catalogPromise;
}

async function repositoryStatus() {
  if (statusCache && Date.now() - statusCache.time < 10000) return statusCache.value;
  const git = async args => { try { return (await exec('git', ['-C', root, ...args], { timeout: 2500, maxBuffer: 32768 })).stdout.trim(); } catch { return null; } };
  const [sha, branch, dirty] = await Promise.all([git(['rev-parse', 'HEAD']), git(['branch', '--show-current']), git(['status', '--short', '--untracked-files=no'])]);
  const value = { sha, branch, trackedChanges: dirty ? dirty.split('\n') : [], observedAt: new Date().toISOString(), startedAt };
  statusCache = { time: Date.now(), value };
  return value;
}

async function audioCatalog() {
  if (audioCache && Date.now() - audioCache.time < 10000) return audioCache.value;
  const files = await walk(soundRoot).catch(() => []), assets = [], allowlist = new Set();
  for (const file of files.filter(file => path.basename(file) === 'manifest.json')) {
    try {
      const manifest = JSON.parse(await readFile(await regularFile(file, soundRoot), 'utf8'));
      for (const entry of manifest.assets || []) {
        if (!entry.path?.startsWith('/sfx/crafted/') || path.extname(entry.path) !== '.mp3') continue;
        const actual = path.resolve(root, 'public', `.${entry.path}`);
        try {
          const bytes = await readFile(await regularFile(actual, soundRoot));
          const sha256 = createHash('sha256').update(bytes).digest('hex');
          allowlist.add(actual);
          assets.push({ id: entry.id, path: entry.path, bytes: bytes.length, sha256, manifestHash: entry.sha256 ? entry.sha256 === sha256 ? 'match' : 'mismatch' : 'unrecorded', declaredDuration: entry.durationSec, declaredPeak: entry.decodedPeak, declaredRms: entry.decodedRms, license: manifest.license || '확인 필요', source: manifest.source || null });
        } catch { assets.push({ id: entry.id, path: entry.path, error: '파일 누락/허용 범위 밖' }); }
      }
    } catch { /* 손상된 manifest를 완료로 표시하지 않는다. */ }
  }
  allowedSounds = allowlist;
  const value = { observedAt: new Date().toISOString(), assets };
  audioCache = { time: Date.now(), value };
  return value;
}

const index = await readFile(path.join(studioRoot, 'index.html'), 'utf8');
const importMap = index.match(/<script type="importmap">([\s\S]*?)<\/script>/)?.[1];
const importHash = createHash('sha256').update(importMap || '').digest('base64');
const server = http.createServer(async (request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self' 'wasm-unsafe-eval' 'sha256-${importHash}'; style-src 'self'; img-src 'self' blob: data:; media-src 'self'; connect-src 'self' blob:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`);
  const send = (status, body, type = 'application/json; charset=utf-8') => {
    response.writeHead(status, { 'Content-Type': type });
    response.end(request.method === 'HEAD' ? undefined : body);
  };
  if (request.headers.host !== `127.0.0.1:${port}`) return send(403, JSON.stringify({ error: '127.0.0.1 주소로 접속하세요.' }));
  if (!['GET', 'HEAD'].includes(request.method)) { response.setHeader('Allow', 'GET, HEAD'); return send(405, JSON.stringify({ error: '읽기 요청만 지원합니다.' })); }
  try {
    const route = decodeURIComponent((request.url || '/').split('?')[0]);
    if (route.includes('\0') || route.includes('\\') || route.split('/').includes('..')) return send(400, JSON.stringify({ error: '지원하지 않는 경로입니다.' }));
    if (route === '/api/catalog') return send(200, JSON.stringify(await catalog()));
    if (route === '/api/status') return send(200, JSON.stringify(await repositoryStatus()));
    if (route === '/api/audio') return send(200, JSON.stringify(await audioCatalog()));
    if (route === '/api/board' || route === '/api/storyboard') {
      const filename = route === '/api/board' ? 'board.json' : 'storyboard.json';
      return send(200, JSON.stringify(JSON.parse(await readFile(await regularFile(path.join(studioRoot, filename), studioRoot), 'utf8'))));
    }
    let file, boundary;
    if (uiFiles.has(route)) { file = uiFiles.get(route); boundary = studioRoot; }
    else if (vendorFiles.has(route)) { file = vendorFiles.get(route); boundary = path.join(root, 'node_modules/three'); }
    else if (route.startsWith('/models/')) {
      await catalog();
      file = path.resolve(modelRoot, route.slice('/models/'.length)); boundary = modelRoot;
      if (!allowedAssets.has(file)) return send(404, JSON.stringify({ error: '라이브러리에서 허용한 모델/의존 파일만 읽을 수 있습니다.' }));
    } else if (route.startsWith('/sfx/crafted/')) {
      await audioCatalog();
      file = path.resolve(root, 'public', `.${route}`); boundary = soundRoot;
      if (!allowedSounds.has(file)) return send(404, JSON.stringify({ error: 'manifest에서 허용한 제작 사운드만 읽을 수 있습니다.' }));
    } else return send(404, JSON.stringify({ error: '경로를 찾을 수 없습니다.' }));
    const bytes = await readFile(await regularFile(file, boundary));
    return send(200, bytes, contentTypes[path.extname(file).toLowerCase()] || 'application/octet-stream');
  } catch (error) { return send(400, JSON.stringify({ error: error.code === 'ENOENT' ? '파일을 찾을 수 없습니다.' : '파일/JSON을 읽을 수 없습니다.' })); }
});
server.on('error', error => { console.error(`Studio 시작 실패: ${error.message}`); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => console.log(`Blade Surge 제작 Studio: http://127.0.0.1:${port} (읽기 전용, Ctrl+C 종료)`));
