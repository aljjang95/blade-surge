// blender_weapon_prep.py 출력 GLB 를 장비 무기 GLB 로 등록한다(영웅 무기 8형태).
// 사용: node tools/art/register-item-weapon.mjs --id <itemId> --form sword|greatsword|axe|greataxe|wand|staff|dagger|bow --input <prepped.glb> --taskId <tripoTaskId> [--concept "아이콘 원화 설명"]
// 시험용: --manifest <json> --outDir <dir> 로 기록 위치를 바꾼다(기본은 src/data/item-weapon-glb.json, public/models/item-weapons).
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const WEAPON_GLB_FORMS = ['sword', 'greatsword', 'axe', 'greataxe', 'wand', 'staff', 'dagger', 'bow'];
export const WEAPON_GLB_BUDGET = { triangles: 4000, textureMax: 1024, bytes: 2 * 1024 * 1024 };
// 손잡이 원점이 전체 길이의 아래 몇 %에 있어야 하는지(prep 기본 18%). 등록은 느슨하게 5~40%를 받고, 활은 중앙 손잡이라 40~60%.
export const GRIP_FRACTION_RANGE = [0.05, 0.40];
export const GRIP_FRACTION_RANGE_BOW = [0.40, 0.60];
// 검·대검은 예전 파일명(<id>.glb) 그대로, 나머지 형태는 <id>--<form>.glb (같은 id가 형태마다 GLB를 가질 수 있다).
export const weaponGlbFileName = (id, form) => (form === 'sword' || form === 'greatsword' ? `${id}.glb` : `${id}--${form}.glb`);
const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function readGlb(bytes) {
  if (bytes.length < 20 || bytes.readUInt32LE(0) !== 0x46546c67) throw new Error('GLB 가 아님');
  const jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength));
  const binOffset = 20 + jsonLength + 8;
  return { json, bin: bytes.subarray(binOffset) };
}

function imageSize(data) {
  if (data.readUInt32BE(0) === 0x89504e47) return [data.readUInt32BE(16), data.readUInt32BE(20)];
  if (data[0] === 0xff && data[1] === 0xd8) {
    let at = 2;
    while (at < data.length) {
      if (data[at] !== 0xff) { at++; continue; }
      const marker = data[at + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return [data.readUInt16BE(at + 7), data.readUInt16BE(at + 5)];
      at += 2 + data.readUInt16BE(at + 2);
    }
  }
  if (data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') {
    const kind = data.toString('ascii', 12, 16);
    if (kind === 'VP8X') return [1 + data.readUIntLE(24, 3), 1 + data.readUIntLE(27, 3)];
    if (kind === 'VP8 ') return [data.readUInt16LE(26) & 0x3fff, data.readUInt16LE(28) & 0x3fff];
    if (kind === 'VP8L') { const v = data.readUInt32LE(21); return [(v & 0x3fff) + 1, ((v >> 14) & 0x3fff) + 1]; }
  }
  return null;
}

/** 무기 GLB 규약 검사. 예외 없이 { ok, errors, triangles, bbox, ... } 를 돌려준다. */
export function inspectWeaponGlb(bytes, form = 'sword') {
  const gripRange = form === 'bow' ? GRIP_FRACTION_RANGE_BOW : GRIP_FRACTION_RANGE;
  const errors = [];
  const { json, bin } = readGlb(bytes);
  const meshes = json.meshes || [];
  if (meshes.length !== 1 || meshes[0].primitives.length !== 1) errors.push('단일 메시·단일 프리미티브가 아님');
  if ((json.skins || []).length) errors.push('스킨 있음');
  if ((json.animations || []).length) errors.push('애니메이션 있음');
  if ((json.materials || []).length > 1) errors.push('재질이 둘 이상');
  for (const node of json.nodes || []) if (node.matrix || node.rotation || node.translation || node.scale) errors.push('노드 변환이 항등이 아님(변환을 메시에 구워야 함)');
  const primitive = meshes[0]?.primitives[0];
  let triangles = 0, bbox = null, gripFraction = null;
  if (primitive) {
    if (primitive.attributes.COLOR_0 !== undefined) errors.push('정점색(COLOR_0) 있음');
    if (primitive.attributes.JOINTS_0 !== undefined || primitive.attributes.WEIGHTS_0 !== undefined) errors.push('스킨 속성 있음');
    if ((primitive.mode ?? 4) !== 4) errors.push('삼각형 목록이 아님');
    const position = json.accessors[primitive.attributes.POSITION];
    triangles = Math.floor((primitive.indices !== undefined ? json.accessors[primitive.indices].count : position.count) / 3);
    bbox = { min: position.min, max: position.max };
    const size = position.max.map((v, i) => v - position.min[i]);
    if (size[1] < size[0] || size[1] < size[2]) errors.push('길이축이 +Y 가 아님(가장 긴 축이 Y 여야 함)');
    if (!(position.min[1] < 0 && position.max[1] > 0)) errors.push('손잡이 원점이 길이축(Y) 범위 안에 없음');
    else {
      gripFraction = -position.min[1] / size[1];
      if (gripFraction < gripRange[0] || gripFraction > gripRange[1]) errors.push(`손잡이 원점이 길이의 ${(gripFraction * 100).toFixed(0)}% 지점(허용 ${gripRange[0] * 100}~${gripRange[1] * 100}%${form === 'bow' ? ', 활은 중앙' : ', 손잡이가 아래'})`);
    }
  }
  if (triangles > WEAPON_GLB_BUDGET.triangles) errors.push(`삼각형 예산 초과: ${triangles} > ${WEAPON_GLB_BUDGET.triangles}`);
  if (bytes.length > WEAPON_GLB_BUDGET.bytes) errors.push(`파일 크기 예산 초과: ${bytes.length}`);
  const textures = [];
  for (const image of json.images || []) {
    if (image.bufferView === undefined) { errors.push('텍스처는 GLB 안에 포함해야 함'); continue; }
    const view = json.bufferViews[image.bufferView];
    const size = imageSize(bin.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength));
    if (!size) { errors.push('텍스처 크기를 읽지 못함'); continue; }
    textures.push(size);
    if (Math.max(...size) > WEAPON_GLB_BUDGET.textureMax) errors.push(`텍스처가 ${WEAPON_GLB_BUDGET.textureMax}px 초과: ${size.join('x')}`);
  }
  return { ok: !errors.length, errors, triangles, bbox, gripFraction, textures, bytes: bytes.length };
}

export async function registerItemWeapon({ id, form, input, taskId, concept = '', manifestPath, outDir }) {
  if (!ID_PATTERN.test(id || '')) throw new Error('--id 형식 오류');
  if (!WEAPON_GLB_FORMS.includes(form)) throw new Error(`--form 은 ${WEAPON_GLB_FORMS.join('|')} 만 가능`);
  if (!taskId) throw new Error('--taskId 필요');
  const bytes = await readFile(input);
  const report = inspectWeaponGlb(bytes, form);
  if (!report.ok) throw new Error(`무기 GLB 규약 위반:\n- ${report.errors.join('\n- ')}`);
  const target = resolve(outDir, weaponGlbFileName(id, form)), staged = `${target}.staged`;
  await mkdir(outDir, { recursive: true });
  await copyFile(input, staged);
  try { await rename(staged, target); } finally { await rm(staged, { force: true }); }
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const entry = {
    id, form, file: `/models/item-weapons/${weaponGlbFileName(id, form)}`, sha256: sha256(bytes), bytes: bytes.length, triangles: report.triangles,
    source: { tripoTaskId: String(taskId), concept: String(concept) },
  };
  manifest.items = [...manifest.items.filter(item => !(item.id === id && item.form === form)), entry].sort((a, b) => a.id.localeCompare(b.id) || a.form.localeCompare(b.form));
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { entry, report };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const args = process.argv.slice(2).reduce((out, value, index, all) => {
    if (value.startsWith('--')) out[value.slice(2)] = all[index + 1] === undefined || all[index + 1].startsWith('--') ? true : all[index + 1];
    return out;
  }, {});
  try {
    const { entry } = await registerItemWeapon({
      id: args.id, form: args.form, input: args.input, taskId: args.taskId, concept: args.concept || '',
      manifestPath: resolve(args.manifest || `${root}/src/data/item-weapon-glb.json`),
      outDir: resolve(args.outDir || `${root}/public/models/item-weapons`),
    });
    console.log(JSON.stringify(entry));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
