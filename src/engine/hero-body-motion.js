import * as THREE from 'three';
import FOX_BODY_MOTION from '../data/fox-body-motion-v1.json';
import RANGER_REVISION from '../data/ranger-library-revision-v4.json';
import ROGUE_REVISION from '../data/rogue-library-revision-v2.json';
import HIGHER_BODY_MOTION from '../data/higher-body-motion-v1.json';
import R2_BODY_MOTION_V2 from '../data/rogue-t2-body-motion-v2.json';
import RANGER_T1_MOTION from '../data/ranger-t1-body-motion-v2.json';
import RANGER_T2_MOTION from '../data/ranger-t2-body-motion-v2.json';
import RANGER_T3_MOTION from '../data/ranger-t3-body-motion-v2.json';
import ROGUE_T1S_MOTION from '../data/rogue-t1s-body-motion-v1.json';
import ROGUE_T2U_MOTION from '../data/rogue-t2u-body-motion-v1.json';
import RANGER_T1S_MOTION from '../data/ranger-t1s-body-motion-v1.json';
import RANGER_T2U_MOTION from '../data/ranger-t2u-body-motion-v1.json';
import ROGUE_VAMPIRE_MOTION from '../data/rogue-vampire-body-motion-v1.json';
import RANGER_BLACKCAT_MOTION from '../data/ranger-blackcat-body-motion-v1.json';
import ORIGINAL_DODGE_BAND from '../data/original-dodge-band-v1.json';
import { higherBodyRevisions, rangerClipSource, rangerLibraryRevision, revisedLibraryFile, tierRebindBodyRevisions, validateHigherBodyRevisions } from './library-assets.js';

// 게임이 쓰는 상위 몸체 기록(v1 번들 + 대신 쓰는 개정, 예: 3단계 궁수 body-fit-v2).
const HIGHER_BODY_REVISIONS = higherBodyRevisions();

const FOX = 'avatar_ranger_fox';
const DURATIONS = { dodge: .5, death: 1.25 };
// Source38 explicit qualified37 job draft; original v1/Fox durations and positive branches remain intact.
const R2='hero_rogue_t2', STAB_DURATION=1.7083333730697632;
const STAB_PROPOSAL_SHA='9dffccf7797867c0167c79d1af920407a245dd29da2e513dd014fe90543321e3';
const R2_PREVIOUS_SHA='a37af789bbbad1427df3c250fbe49aa50a7301e7fec87c9ded36874b10de8f18';
const REPAIRED_METHOD='QUALIFIED37_APPROVED_STAB38';
const SOURCE35={
 'r2_local_core35.py':'99d9877d0e6539b8eb6af5c1e74188103caa226c2921cea413f70972665ddb96',
 'collect-r2-local-35.py':'9115ffebddfa097aad24e296c16b798419836ef6dd0f2ed5fc4a3b420e1da0a7',
 'solve-r2-local-35.py':'4a5e9ca3bf38a962a1d1a8883ca0cbc75511300b90f416a165d8d5f4273b1b4e',
 'validate-r2-local-35.py':'1f514f9840b773ae892b5e8acdf3b29b14c918dd9501c8ae6c3343b12f80e3ac',
};
const FULL37_SOURCES={
 "r2_qualified_portable37_v2.py": "450faece393b471a37158027567d6a9156ad3627b58b71784bef38500935a032",
 "validate-r2-qualified-37-v2.py": "5399b6c8679fbcf2fd9d2caff594a1a494bd6f78f8e701c7d39495a36b193f93"
};
const PHASE2_37_SOURCES={
 "r2_qualified_core37.py": "33b7e8b384b6cbd86eaa0dc022271e1ce23ff626a959f9025469cd46725bbdab",
 "solve-r2-qualified-37.py": "6bb90ba3bad34a6e8b20fa1df12c51512887dd48484b6837c15607cc95dc59cd"
};
const PROOF38_PINS={
 validation:'5ebbe9ac0007a05aada21c0764d0604ee1a7605c3477a4802306a0d9866cdb50',
 positions:'25e88f9494f6ae15d3f75a49a05e5fb476180b36fd6f6716754675565b1910b1',
 metadata:'2e252cfd199270e66610bda0eeafb60e60d4ed47fd9b43ef6c89120b74fe4b61',
 packet:'40103ef4a6133c6acc99d7f6b78beb94a816c7fc61f6e37f530bf7cba6b975ab',
 solution:'680a33b9b8f5ebf76dd0e8f47dd850f1babf6ed6b325f012fd500840c7c64841',
};
const EVIDENCE37_PINS={
 originPolicy:'60e8429b1f322dcd3b697e57f6c0313563f9420d2e75a62cef7801889d8bc037',
 localPolicy:'2e3e02b9e0aeac56498c5a071afd5e3b17ca9e4df660ad40b87408c5cb75e41b',
 differenceEvidence:'3b02b14bfa76da12f772c29841a11866eba975b1648ee50728506a3c1ed5f693',
 receipt:'4e9bde6000774b5497a20b068a1c40f5ddf6895060ba9558808f753146b2b1bc',
 amendedDod:'e1cbb7aa6b79caf5757399d3f8693e996981230d1e440cae8c1bf0b4a27f72b1',
 recovery:'d4bf5e916a4f304031385e38bc218a1bb624e06a76206deaf9b22b405d8897cd',
 originalResidualWitness:'f59fdb610c033b94628f9d6a359d8530751b9ed9e63cf98a83695181266d7f49',
};
function proofShape38(p){
 const keys=['schema','validation','positions','metadata','packet','solution','sourcesFull37v2','sourcesPhase2_37','sources35','binding35','binding37','originSolutionBinding','portability37v2','referencePolicy37','packetCertificate37','evidence37'];
 return p?.schema==='blade-surge.qualified37.proof38.v1'&&sameValue(Object.keys(p).sort(),keys.sort())
  &&Object.entries(PROOF38_PINS).every(([k,h])=>validRecord38(p[k])&&p[k].sha256===h)
  &&sameValue(p.sourcesFull37v2,FULL37_SOURCES)&&sameValue(p.sourcesPhase2_37,PHASE2_37_SOURCES)&&sameValue(p.sources35,SOURCE35)
  &&sameValue(Object.keys(p.evidence37||{}).sort(),Object.keys(EVIDENCE37_PINS).sort())
  &&Object.entries(EVIDENCE37_PINS).every(([k,h])=>validRecord38(p.evidence37[k])&&p.evidence37[k].sha256===h)
  &&p.binding35?.schema==='blade-surge.r2-local35.binding.v1'&&sameValue(p.binding35.sources35,SOURCE35)
  &&p.binding35.contract35==='29c5c0116257af32d3a7ce273f5d7821ceafc8b632904e0f0a7f9bdf4fd78d86'
  &&p.binding35.method35?.name==='SIX_CONTACT_WELD_REST_XYZ'&&p.binding35.method35.variables===18&&sameValue(p.binding35.method35.box,[-.005,.005])
  &&p.binding35.parent33PruningReused===false&&p.binding35.source10?.frozenPositionSha==='7208abc9a09c2c19064a6ea31189ae00c81ce0d8e776678e40dcd0a7d8670088'
  &&sameValue(p.binding37?.binding35,p.binding35)&&sameValue(p.originSolutionBinding?.binding35,p.binding35)
  &&[p.binding37,p.originSolutionBinding].every(b=>b.policyActivated===true&&b.acceptanceSetExpanded===true&&b.physicalThresholdsChanged===false)
  &&p.portability37v2?.originProofSha===EVIDENCE37_PINS.originPolicy&&p.portability37v2.pcProofSha===EVIDENCE37_PINS.localPolicy
  &&p.portability37v2.differenceEvidenceSha===EVIDENCE37_PINS.differenceEvidence&&p.portability37v2.policyChanged===false
  &&p.portability37v2.originalProofUnmodified===true&&p.portability37v2.freshPCClassificationExact===true&&p.portability37v2.freshPCVerificationExact===true
  &&p.referencePolicy37?.phase1ProofSha===EVIDENCE37_PINS.originPolicy&&p.referencePolicy37.receiptSha===EVIDENCE37_PINS.receipt&&p.referencePolicy37.amendedDodSha===EVIDENCE37_PINS.amendedDod
  &&p.referencePolicy37.candidateIndependent===true&&p.referencePolicy37.rawRestDualUnchanged===true&&p.referencePolicy37.primaryAllConditionsUnchanged===true&&p.referencePolicy37.secondaryAllAreaUnchanged===true
  &&p.referencePolicy37.actualExceptions?.length===32&&p.referencePolicy37.originalDualPosedFailures===28&&p.referencePolicy37.applicablePosedFailures===0
  &&[p.packetCertificate37?.originalStoredCertificate,p.packetCertificate37?.independentLocalCertificate].every(c=>c?.originalResidualCount===401810&&c.appliedResidualCount===401778&&c.appliedCertificatePass===true&&c.appliedNegative===0&&c.minimumAppliedResidual>=0&&c.originalDualCertificatePass===false);
}

const STAB_KEYS=[[0,0],[.08,0],[.13,-.004],[.15,-.004],[.20,0],[.26,0],[.31,-.006],[.34,-.006],[.37,-.010],[.40,-.010],[.46,0],[.80,0],[.86,-.006],[.89,-.010],[.96,0],[1.13,0],[1.18,-.012],[1.21,-.012],[1.27,0],[STAB_DURATION,0]];
const isR2V2=body=>body?.asset===R2&&body.motionRevisionId==='rogue-t2-body-motion-v2';
const sameValue=(a,b)=>Object.is(a,b)||(a&&b&&typeof a==='object'&&typeof b==='object'&&Array.isArray(a)===Array.isArray(b)&&Object.keys(a).length===Object.keys(b).length&&Object.keys(a).every(k=>Object.hasOwn(b,k)&&sameValue(a[k],b[k])));
function artistStabValue(time){
  if(time<=0||time>=STAB_DURATION)return 0;
  for(let i=1;i<STAB_KEYS.length;i++)if(time<=STAB_KEYS[i][0]){const [ta,a]=STAB_KEYS[i-1],[tb,b]=STAB_KEYS[i],u=(time-ta)/(tb-ta);return a+(b-a)*u*u*(3-2*u);}
  throw Error('STAB approved artist interval missing');
}
const states = new WeakMap();
const bodyClips = new WeakMap();
// 저작 덮어쓰기 클립 → 그 원본 클립. 이미 덮인 클립 맵으로 다시 등록해도 원본에서 다시 만든다(덮어쓰기 위에 덮지 않음).
const overlayBases = new WeakMap();
const requireMotion = (condition, message) => { if (!condition) throw new Error('여우 저작 동작: ' + message); };

/** 번들에 저장된 저작 트랙만 읽는다. 캐릭터 위치·접지·현재 액션을 프레임마다 보정하지 않는다. */
export function createBodyMotionClip(baseClip, motion = FOX_BODY_MOTION) {
  requireMotion(motion?.schema === 'blade-surge.hero-body-motion.v1' && motion.asset === FOX, '잘못된 자산 계약');
  requireMotion(motion.base?.path === RANGER_REVISION.output.path && motion.base?.sha256 === RANGER_REVISION.output.sha256, '공유 궁수 v4 원본 불일치');
  requireMotion(Array.isArray(motion.clipOverrides) && motion.clipOverrides.length === 2
    && new Set(motion.clipOverrides.map(entry => entry.base?.clip)).size === 2
    && motion.clipOverrides.every(entry => Object.hasOwn(DURATIONS, entry.base?.clip)), '회피·사망 저작 목록 불일치');
  const entry = motion.clipOverrides.find(item => item.base.clip === baseClip?.name);
  requireMotion(entry && entry.base.duration === DURATIONS[baseClip.name] && entry.base.hipsTrack === 'mixamorigHips.position'
    && /^[a-f0-9]{64}$/.test(entry.base.sourceTrackSha256), '원본 트랙 메타데이터 불일치');
  requireMotion(Math.abs(baseClip.duration - entry.base.duration) < 1e-7, '클립 길이 불일치');
  const initialOffsetMeters = baseClip.name === 'dodge' ? .006 : 0;
  requireMotion(entry.authoring?.initialOffsetMeters === initialOffsetMeters, '시작 저작 높이 메타데이터 불일치');
  const matching = baseClip.tracks.filter(track => track.name === entry.base.hipsTrack);
  requireMotion(matching.length === 1, '원본 골반 위치 트랙 개수 불일치');
  const original = matching[0], output = entry.outputTrack;
  requireMotion(original.ValueTypeName === 'vector' && original.getValueSize() === 3 && original.getInterpolation() === THREE.InterpolateLinear, '원본 골반 트랙 형식 불일치');
  requireMotion(output?.name === original.name && output.type === 'vector' && (!output.interpolation || output.interpolation === 'LINEAR'), '저작 트랙 형식 불일치');
  const times = output.times, values = output.values;
  requireMotion(Array.isArray(times) && Array.isArray(values) && times.length >= Math.ceil(baseClip.duration * 120) + 1
    && times.length <= 1000 && values.length === times.length * 3, '저작 표본 배열 크기 불일치');
  requireMotion(times.every((time, index) => Number.isFinite(time) && time >= 0 && time <= baseClip.duration && (!index || time > times[index - 1]))
    && values.every(Number.isFinite) && times[0] === 0 && times[times.length - 1] === baseClip.duration, '저작 표본의 시간·값 불일치');
  requireMotion(Array.from(original.times).every(time => times.some(sample => Math.abs(sample - time) < 1e-7)), '원본 키 시간 누락');
  const interpolant = original.createInterpolant();
  for (let index = 0; index < times.length; index++) {
    const reference = interpolant.evaluate(times[index]), offset = index * 3;
    requireMotion(Math.abs(values[offset] - reference[0]) <= 1e-4 && Math.abs(values[offset + 2] - reference[2]) <= 1e-4, '골반 수평 이동은 변경할 수 없습니다.');
    const deltaY = values[offset + 1] - reference[1];
    requireMotion(deltaY >= -1e-4 && deltaY <= 6.2, '저작 골반 높이 범위 초과');
    // 고정 v4 본 단위에서 회피 시작 +6mm는 약 .3333334167이다. 새 저작 시작 자세만 검사한다.
    if (!index) requireMotion(Math.abs(deltaY - (baseClip.name === 'dodge' ? .3333334167 : 0)) <= 1e-4, '시작 저작 자세 불일치');
    if (baseClip.name === 'dodge' && index === times.length - 1) requireMotion(Math.abs(deltaY) <= 1e-4, '회피 끝 자세 불일치');
    // v4 본의 native 단위에서 사망 끝의 저작 +5cm는 약2.777778이다. 보정값을 계산·적용하지 않는 계약 검사다.
    if (baseClip.name === 'death' && index === times.length - 1) requireMotion(deltaY >= 2.77 && deltaY <= 2.79, '사망 끝 저작 접촉 높이 불일치');
  }
  const replacement = new THREE.VectorKeyframeTrack(original.name, times, values, THREE.InterpolateLinear);
  // 나머지 트랙은 원본 객체를 공유한다. 공유 GLB·클립 캐시·기존 트랙 배열은 수정하지 않는다.
  return new THREE.AnimationClip(baseClip.name, baseClip.duration,
    baseClip.tracks.map(track => track === original ? replacement : track), baseClip.blendMode);
}

// ---- 궁수 1단계 v6 몸 전용 회피·사망 골반 높이(ranger-t1-body-motion-v2. 철회된 v5 기록은 v1) ----
// v6 는 v4 와 골격 노드·클립 바이트가 같은 몸 재결합 개정이다. 새 몸(머리·망토 부피·발 모양)에 맞춘 Hips 높이만 저작 기록으로 덮는다.
// 상한 0.3m: v6 망토(등 뒤 약 19cm)가 앞구르기 중간에 바닥을 파서 골반을 최대 0.28m 올려야 한다(v5 는 0.12 안).
// 기록은 480Hz 격자 오프셋(선형)이며 띠 안에서 평활한 곡선이다(tools/art/author-ranger-t1-body-motion.mjs). 런타임은 접지를 계산하지 않고 검사만 한다.
// 같은 방식으로 v4 골격에 재결합한 2·3단계 v2 몸(ranger-t{2,3}-body-fit-v2)도 같은 띠 곡선 계약을 쓴다(ranger-t{2,3}-body-motion-v2,
// tools/art/author-ranger-higher-body-motion.mjs). 이때 클립 원본은 몸 개정 기록의 재결합 base(v4)다.
const RANGER_T1 = 'hero_ranger_t1', RANGER_T2 = 'hero_ranger_t2', RANGER_T3 = 'hero_ranger_t3', T1_LIMIT_METERS = .3;
const RANGER_BAND_PREFIX = Object.freeze({ [RANGER_T2]: 'ranger-t2', [RANGER_T3]: 'ranger-t3' });
// 골반 오프셋 크기 상한. 1단계는 0.3m, 2·3단계는 기존 상위 몸체 계약과 같은 0.35m(구르기에서 2단계 등 뒤 후드가 바닥을 파 0.34m 까지 올린다).
// 접지 수용 기준(구르기 ±0.03m, 사망 > -0.01m)은 단계와 무관하게 같다.
const HIGHER_BAND_LIMIT_METERS = .35;
// 띠 곡선 기록의 회피·사망 항목 검사(궁수 1·2·3단계와 등급 몸 공통). limit 는 골반 오프셋 크기 상한(m).
function requireBandEntries(motion, limit) {
  requireMotion(Array.isArray(motion.clipOverrides) && motion.clipOverrides.length === 2
    && sameValue(motion.clipOverrides.map(entry => entry.base?.clip).sort(), ['death', 'dodge']), '1단계 회피·사망 저작 목록 불일치');
  for (const entry of motion.clipOverrides) {
    const base = entry.base, profile = entry.authoring, validation = entry.validation;
    requireMotion(base.duration === DURATIONS[base.clip] && base.hipsTrack === 'mixamorigHips.position' && base.interpolation === 'LINEAR'
      && SHA.test(base.sourceTrackSha256) && finiteArray(base.times) && finiteArray(base.values) && base.values.length === base.times.length * 3, '1단계 원본 트랙 snapshot 불일치');
    requireMotion(typeof profile?.profileId === 'string' && profile.interpolation === 'LINEAR' && profile.gridHz >= 120
      && Number.isFinite(profile.parentWorldYGain) && profile.parentWorldYGain > 0
      && Number.isFinite(profile.minOffsetMeters) && Number.isFinite(profile.maxOffsetMeters)
      && profile.minOffsetMeters >= -limit && profile.maxOffsetMeters <= limit
      && profile.initialOffsetMeters === 0 && (base.clip !== 'dodge' || profile.finalOffsetMeters === 0), '1단계 저작 프로필 불일치');
    requireMotion(validation?.pass === true && validation.densePenetrationMinMeters > validation.acceptance.low
      && (validation.acceptance.high === null || validation.denseFloatMaxMeters < validation.acceptance.high)
      && (validation.acceptance.endAbs === null || Math.abs(validation.endMeters) < validation.acceptance.endAbs), '1단계 저작 검증 기록 불일치');
  }
}

export function validateRangerT1Motion(motion, revision = rangerLibraryRevision()) {
  const t1 = revision?.asset === RANGER_T1;
  const source = t1 ? rangerClipSource(revision) : revision?.authoring?.kind === 'body-rebind' ? revision.authoring.base : null;
  const prefix = RANGER_BAND_PREFIX[revision?.asset];
  requireMotion(source && (t1 || (prefix && new RegExp('^' + prefix + '-body-fit-v([2-9]|[1-9]\\d+)$').test(revision.id)
      && motion?.motionRevisionId === revision.id.replace('-body-fit-', '-body-motion-')))
    && motion?.schema === (t1 ? 'blade-surge.ranger-t1-body-motion.v1' : 'blade-surge.ranger-band-body-motion.v1')
    && motion.asset === revision.asset && motion.heroId === 'ranger'
    && motion.revisionId === revision.id && motion.body?.path === revision.output.path && motion.body.sha256 === revision.output.sha256
    && motion.base?.path === source.path && motion.base.sha256 === source.sha256
    && motion.base.path === RANGER_REVISION.output.path && motion.base.sha256 === RANGER_REVISION.output.sha256, '1단계 몸·클립 원본 출처 불일치');
  requireBandEntries(motion, t1 ? T1_LIMIT_METERS : HIGHER_BAND_LIMIT_METERS);
  return freezeTree(structuredClone(motion));
}

/** 같은 띠 곡선 계약(1단계 v6·3단계 v2)의 검사 이름. */
export const validateRangerBandMotion = validateRangerT1Motion;

// ---- 등급 몸(S 1.5·U 2.5) heroes-next 교정 몸 전용 회피·사망 골반 높이(t4-body-revisions, tools/art/author-tier-body-motion.mjs) ----
// 궁수 2·3단계 v2 와 같은 띠 곡선 계약·같은 수용 기준·같은 오프셋 상한(0.35m). 클립 원본은 몸 기록의 재결합 base(영웅의 1단계 클립 원본)다.
// 2026-10-23 도적 S·U: 원본 클립 그대로면 구르기 최저 -0.116/-0.135m, 사망 최저 -0.027/-0.109m(망토·목도리가 바닥을 판다)라 곡선이 필요했다.
// 궁수 S·U 몸도 같은 경로다(클립 원본 = 재결합 base = 1단계 v6 의 클립 원본 v4). 2026-10-24 궁수 S·U: 원본 클립 그대로면 구르기 최저
// -0.193/-0.139m, 사망 최저 -0.083/-0.203m. 2026-10-24 흡혈 백작 아바타: 구르기 -0.131/+0.273m, 사망 최저 -0.084m. 검은 고양이 아바타: 구르기 -0.171/+0.090m, 사망 최저·끝 -0.073m.
export function validateTierBandMotion(motion, revision) {
  const asset = revision?.asset, base = revision?.authoring?.kind === 'body-rebind' ? revision.authoring.base : null;
  const fit = /^(.+)-body-fit-v([1-9]\d*)$/.exec(String(revision?.id));
  // 자산은 등급 몸(hero_<영웅>_t1s|t2u) 또는 할로윈 아바타(avatar_<영웅>_<테마>, t5-avatar-body-revisions)다.
  const tierAsset = /_t(1s|2u)$/.test(asset || '') && asset === 'hero_' + motion?.heroId + '_' + asset.split('_').at(-1);
  const avatarAsset = /^avatar_[a-z]+_[a-z]+$/.test(asset || '') && asset.startsWith('avatar_' + motion?.heroId + '_');
  requireMotion(base && fit && (tierAsset || avatarAsset) && motion?.schema === 'blade-surge.tier-band-body-motion.v1'
    && motion.asset === asset && ['ranger', 'rogue'].includes(motion.heroId)
    && motion.revisionId === revision.id && motion.motionRevisionId === fit[1] + '-body-motion-v' + fit[2]
    && revision.status === 'GENERATED' && revision.useInGame === true
    && motion.body?.path === revision.output.path && motion.body.sha256 === revision.output.sha256
    && motion.base?.path === base.path && motion.base.sha256 === base.sha256, '등급 몸·클립 원본 출처 불일치');
  requireBandEntries(motion, HIGHER_BAND_LIMIT_METERS);
  return freezeTree(structuredClone(motion));
}

// ---- 기사·야만전사·마법사 원본 몸(교정 기록 없음) 구르기 접지 띠(original-dodge-band-v1, tools/art/author-original-dodge-band.mjs) ----
// 2026-10-25 t8: 공유 Dodge_Forward(영웅 1단계 GLB) 그대로면 기사 1단계 -0.20m, 2·3단계 -0.29~-0.30m, 벚꽃 무사 -0.35m 까지 몸이 바닥을 판다.
// 오프셋은 올리기만 한다(0 ≤ o ≤ 0.35m, 시작·끝 0). 원래 바닥에 닿던 순간만 바닥 위 ±2cm 띠로 올리고 원래 공중(도약)인 순간은 그대로다.
// 수평 이동·다른 트랙·길이(속도·무적·착지 시간)는 원본 그대로다. 몸 개정 id 가 없는 원본 몸에만 쓰고 경로·SHA 가 정확히 같아야 한다.
// KayKit 원본 골반 부모(Armature)는 Z-up 이라 world Y 축은 기록의 parentWorldYAxis(local 성분)·parentWorldYGain 으로 적는다.
const ORIGINAL_BAND_HEROES = Object.freeze(['knight', 'barbarian', 'mage']);
const originalBandGrid = (base, samples) => {
  const n = samples - 1;
  return Array.from({ length: samples }, (_, i) => { const t = Math.fround(base.duration * i / n); return base.times.find(k => Math.abs(k - t) < 1e-5) ?? t; });
};
export function validateOriginalDodgeBand(bundle) {
  requireMotion(bundle?.schema === 'blade-surge.original-dodge-band.v1' && bundle.bases && Array.isArray(bundle.bodies), '원본 몸 구르기 띠 묶음 형식');
  for (const [id, base] of Object.entries(bundle.bases)) {
    requireMotion(ORIGINAL_BAND_HEROES.some(hero => id === 'hero_' + hero + '_t1') && base.asset === id && base.clip === 'dodge'
      && base.hipsTrack === 'mixamorigHips.position' && SHA.test(base.sha256) && SHA.test(base.sourceTrackSha256)
      && Number.isFinite(base.duration) && base.duration > 0 && finiteArray(base.times) && finiteArray(base.values)
      && base.values.length === base.times.length * 3, '원본 몸 구르기 띠 원본 트랙 snapshot');
  }
  const seen = new Set();
  for (const body of bundle.bodies) {
    const base = bundle.bases[body.base], a = body.authoring, v = body.validation, o = body.offsetsMeters;
    requireMotion(ORIGINAL_BAND_HEROES.includes(body.heroId) && body.base === 'hero_' + body.heroId + '_t1' && base && !seen.has(body.asset)
      && (body.asset.startsWith('hero_' + body.heroId + '_') || body.asset.startsWith('avatar_' + body.heroId + '_'))
      && typeof body.body?.path === 'string' && SHA.test(body.body.sha256), '원본 몸 구르기 띠 몸 출처');
    seen.add(body.asset);
    requireMotion(a?.interpolation === 'LINEAR' && [0, 1, 2].includes(a.parentWorldYAxis) && Number.isFinite(a.parentWorldYGain) && a.parentWorldYGain !== 0
      && Number.isInteger(a.samples) && a.samples >= Math.ceil(base.duration * 120) + 1 && a.samples <= 1000
      && finiteArray(o) && o.length === a.samples && o[0] === 0 && o.at(-1) === 0
      && o.every(x => x >= 0 && x <= HIGHER_BAND_LIMIT_METERS) && a.maxOffsetMeters === Math.max(...o) && a.maxOffsetMeters > 0, '원본 몸 구르기 띠 오프셋');
    const grid = originalBandGrid(base, a.samples);
    requireMotion(grid.every((t, i) => !i || t > grid[i - 1]) && grid.at(-1) === base.duration && base.times.every(t => grid.some(g => Object.is(g, t))), '원본 몸 구르기 띠 격자');
    requireMotion(v?.pass === true && v.densePenetrationMinMeters > -.03 && v.denseLiftedMaxMeters < .03, '원본 몸 구르기 띠 검증 기록');
  }
  return freezeTree(structuredClone(bundle));
}

/** 원본 몸 구르기 띠: 공유 원본 Hips 위치 트랙의 수직 성분에만 오프셋을 더한 클립. 수평·다른 트랙·길이는 원본 그대로다. */
export function createOriginalDodgeBandClip(baseClip, record, bundle = originalDodgeBand) {
  const base = bundle.bases[record?.base];
  requireMotion(base && baseClip?.name === 'dodge' && baseClip.duration === base.duration, '원본 몸 구르기 띠 클립 이름·길이 불일치');
  const matches = baseClip.tracks.filter(track => track.name === base.hipsTrack);
  requireMotion(matches.length === 1, '원본 몸 구르기 띠 골반 트랙 개수 불일치');
  const original = matches[0];
  requireMotion(original.ValueTypeName === 'vector' && original.getValueSize() === 3 && original.getInterpolation() === THREE.InterpolateLinear
    && original.times.length === base.times.length && original.values.length === base.values.length
    && base.times.every((value, index) => Object.is(value, original.times[index]))
    && base.values.every((value, index) => Object.is(value, original.values[index])), '원본 몸 구르기 띠 decoded 원본 트랙 snapshot 불일치');
  const a = record.authoring, times = originalBandGrid(base, a.samples), values = new Float32Array(times.length * 3), interpolant = original.createInterpolant();
  times.forEach((time, index) => {
    const reference = interpolant.evaluate(time);
    for (let c = 0; c < 3; c++) values[index * 3 + c] = c === a.parentWorldYAxis ? reference[c] + record.offsetsMeters[index] / a.parentWorldYGain : reference[c];
  });
  const replacement = new THREE.VectorKeyframeTrack(original.name, times, values, THREE.InterpolateLinear);
  return new THREE.AnimationClip(baseClip.name, baseClip.duration, baseClip.tracks.map(track => track === original ? replacement : track), baseClip.blendMode);
}

/** 1단계 v6(·3단계 v2) 몸 전용 Hips 높이 트랙으로 바꾼 클립. 수평 이동·다른 트랙·길이는 원본 그대로다. */
export function createRangerT1BodyMotionClip(baseClip, motion) {
  const entry = motion.clipOverrides.find(item => item.base.clip === baseClip?.name);
  requireMotion(entry && baseClip.duration === entry.base.duration, '1단계 저작 클립 이름·길이 불일치');
  const matches = baseClip.tracks.filter(track => track.name === entry.base.hipsTrack), source = entry.base, output = entry.outputTrack, profile = entry.authoring;
  requireMotion(matches.length === 1, '1단계 골반 위치 트랙 개수 불일치');
  const original = matches[0];
  requireMotion(original.ValueTypeName === 'vector' && original.getValueSize() === 3 && original.getInterpolation() === THREE.InterpolateLinear
    && original.times.length === source.times.length && original.values.length === source.values.length
    && source.times.every((value, index) => Object.is(value, original.times[index]))
    && source.values.every((value, index) => Object.is(value, original.values[index])), '1단계 실제 decoded 원본 트랙 snapshot 불일치');
  const times = output?.times, values = output?.values;
  requireMotion(output?.name === original.name && output.type === 'vector' && output.interpolation === 'LINEAR'
    && finiteArray(times) && finiteArray(values) && times.length >= Math.ceil(baseClip.duration * 120) + 1 && times.length <= 1000
    && values.length === times.length * 3 && times[0] === 0 && times.at(-1) === baseClip.duration
    && times.every((time, index) => !index || time > times[index - 1])
    && Array.from(original.times).every(time => times.some(sample => Object.is(sample, time))), '1단계 저작 시간·값 배열 불일치');
  const interpolant = original.createInterpolant();
  let minOffset = Infinity, maxOffset = -Infinity;
  for (let index = 0; index < times.length; index++) {
    const reference = interpolant.evaluate(times[index]), offset = index * 3;
    requireMotion(Object.is(Math.fround(values[offset]), reference[0]) && Object.is(Math.fround(values[offset + 2]), reference[2]), '1단계 골반 수평 이동 변경');
    const deltaMeters = (Math.fround(values[offset + 1]) - reference[1]) * profile.parentWorldYGain;
    minOffset = Math.min(minOffset, deltaMeters); maxOffset = Math.max(maxOffset, deltaMeters);
    requireMotion(deltaMeters >= profile.minOffsetMeters - 2e-6 && deltaMeters <= profile.maxOffsetMeters + 2e-6, '1단계 저작 높이 범위 초과');
    if (!index) requireMotion(closeMeters(deltaMeters, profile.initialOffsetMeters), '1단계 저작 시작 자세 불일치');
    if (index === times.length - 1) requireMotion(Math.abs(deltaMeters - profile.finalOffsetMeters) <= 1e-5, '1단계 저작 끝 자세 불일치');
  }
  requireMotion(maxOffset - minOffset > 2e-6, '전 동작 상수 높이 변경은 허용하지 않습니다.');
  const replacement = new THREE.VectorKeyframeTrack(original.name, times, values, THREE.InterpolateLinear);
  return new THREE.AnimationClip(baseClip.name, baseClip.duration, baseClip.tracks.map(track => track === original ? replacement : track), baseClip.blendMode);
}

const HIGHER_TARGETS = Object.freeze({
  hero_ranger_t2: ['ranger', 'ranger-t2'], hero_ranger_t3: ['ranger', 'ranger-t3'],
  hero_rogue_t2: ['rogue', 'rogue-t2'], hero_rogue_t3: ['rogue', 'rogue-t3'], avatar_rogue_crow: ['rogue', 'rogue-crow'],
});
const SHA = /^[a-f0-9]{64}$/;
const validRecord38=r=>r&&typeof r==='object'&&Object.keys(r).length===3&&typeof r.path==='string'&&r.path.length>0&&SHA.test(r.sha256)&&Number.isSafeInteger(r.bytes)&&r.bytes>0;
const closeMeters = (a, b) => Math.abs(a - b) <= 2e-6;
const finiteArray = (value) => Array.isArray(value) && value.every(Number.isFinite);
const freezeTree = (value) => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freezeTree); Object.freeze(value); }
  return value;
};

/** 저작이 끝난 실제 패킷만 등록한다. 빈 bodies는 신규 모션 비활성 상태다. */
export function createHigherBodyMotionRegistry(bundle, revisions = HIGHER_BODY_REVISIONS) {
  requireMotion(['blade-surge.higher-body-motion.v1','blade-surge.higher-body-motion.v2'].includes(bundle?.schema) && Array.isArray(bundle.bodies), '상위 몸체 번들 형식 불일치');
  requireMotion(bundle.bodies.filter(isR2V2).length === (bundle.schema==='blade-surge.higher-body-motion.v2'?1:0), '명시 R2 v2 한 개');
  validateHigherBodyRevisions(revisions);
  const records = structuredClone(bundle.bodies), assets = new Set(), paths = new Set();
  for (const body of records) {
    const target = HIGHER_TARGETS[body.asset], revision = revisions.revisions.find(item => item.asset === body.asset);
    requireMotion(target && !assets.has(body.asset), '알 수 없거나 중복된 몸체'); assets.add(body.asset);
    const [heroId, prefix] = target, canonical = heroId === 'ranger' ? RANGER_REVISION : ROGUE_REVISION, signedV2=isR2V2(body);
    // 몸체 개정 번호 N(body-fit-vN)에 맞는 저작 패킷(body-motion-vN)만 받는다. R2 서명 v2 는 body-fit-v1 위의 별도 개정이다.
    const fit = /^(.+)-body-fit-v([1-9]\d*)$/.exec(String(body.revisionId));
    requireMotion(body.heroId === heroId && fit?.[1] === prefix
      && revision?.id === body.revisionId && revision.status === 'GENERATED' && revision.useInGame === true
      && body.body?.path === revision.output.path && body.body.sha256 === revision.output.sha256 && SHA.test(body.body.sha256), '활성 몸체 revision·출력 SHA 불일치');
    requireMotion(body.base?.path === canonical.output.path && body.base.sha256 === canonical.output.sha256, '공유 클립 GLB 출처 불일치');
    requireMotion(body.motionRevisionId === prefix + '-body-motion-v' + (signedV2 ? 2 : Number(fit[2]))
      && body.output?.path === '/models/heroes-next/' + body.motionRevisionId + '.json'
      && SHA.test(body.output.sha256) && !paths.has(body.output.path), '저작 패킷 출력 출처 불일치'); paths.add(body.output.path);
    requireMotion(Array.isArray(body.clipOverrides) && body.clipOverrides.length >= 1 && body.clipOverrides.length <= (signedV2?3:2)
      && new Set(body.clipOverrides.map(entry => entry.base?.clip)).size === body.clipOverrides.length, '저작 클립 중복·개수 불일치');
    if(signedV2){
      const previous=HIGHER_BODY_MOTION.bodies.find(x=>x.asset===R2);
      requireMotion(body.schema==='blade-surge.higher-body-motion-packet.v2' && previous?.output.sha256===R2_PREVIOUS_SHA
        && body.approvedArtistProposal?.sha256===STAB_PROPOSAL_SHA && body.previousMotionPacket?.sha256===R2_PREVIOUS_SHA
        && body.authoringMethod===REPAIRED_METHOD && body.oldDodgeDeathTracksExact===true
        && body.frozenGeometryWitness===undefined && body.gainProof===undefined
        && ['geometryProof33','gainProof34','producer34','geometryProof35','gainProof34v2','producer34v2'].every(k=>body[k]===undefined)
        && validRecord38(body.producer38) && body.producer38.path.replaceAll('\\','/').endsWith('/author_body_motion_v2_stab38.py')
        && body.producer38.sha256==='eaa382c17a1ade1637d541013e6d5108c3dc6528e194b3bbc134f74403a895aa'
        && validRecord38(body.gainProof38) && validRecord38(body.candidateGeometry)
        && body.candidateGeometry.sha256===body.body.sha256
        && proofShape38(body.geometryProof37)
        && body.repairedGeometryWitness?.nativeVertices===16299
        && SHA.test(body.repairedGeometryWitness.positionF32Sha256)
        && body.repairedGeometryWitness.positionF32Sha256===body.geometryProof37.positions.sha256
        && body.geometryProof37.positions.bytes===16299*12
        && body.repairedGeometryWitness.candidateGlbSha256===body.body.sha256
        && body.repairedGeometryWitness.geometryReportSha256===body.geometryProof37.validation.sha256
        && body.repairedGeometryWitness.originalRigWeightsUvTopologyExact===true
        && sameValue(body.clipOverrides.map(x=>x.base.clip),['dodge','death','stab']), '명시 서명 R2 STAB v2 출처');
      for(const old of previous.clipOverrides){
        const next=body.clipOverrides.find(x=>x.base.clip===old.base.clip);
        requireMotion(next&&sameValue(next.base,old.base)&&sameValue(next.outputTrack,old.outputTrack),'원 dodge/death 저장 트랙 exact');
        for(const k of ['profileId','parentWorldYGain','initialOffsetMeters','finalOffsetMeters','maxOffsetMeters','artistKeysMeters','interpolation','bakeHz','sourceFrameStart','sceneFPS','parentWorldMatrix','fixedProfileNotSkinMinCompensation'])requireMotion(sameValue(next.authoring[k],old.authoring[k]),'원 dodge/death 저작 수치 '+k);
      }
    }
    for (const entry of body.clipOverrides) {
      const source = entry.base, profile = entry.authoring, validation = entry.validation, signedStab=signedV2&&source?.clip==='stab';
      requireMotion(source && (signedStab?source.duration===STAB_DURATION:(Object.hasOwn(DURATIONS, source.clip) && source.duration === DURATIONS[source.clip]))
        && source.hipsTrack === 'mixamorigHips.position' && source.interpolation === 'LINEAR'
        && SHA.test(source.sourceTrackSha256) && finiteArray(source.times) && finiteArray(source.values)
        && source.times.length >= 2 && source.values.length === source.times.length * 3, '원본 트랙 snapshot 계약 불일치');
      if(signedStab){
        requireMotion(profile?.profileId==='rogue-t2-artist-stab-weight-settle-30' && profile.proposalSha256===STAB_PROPOSAL_SHA
          && Number.isFinite(profile.parentWorldYGain)&&profile.parentWorldYGain>0
          && profile.minOffsetMeters===-.012&&profile.maxOffsetMeters===0&&profile.initialOffsetMeters===0&&profile.finalOffsetMeters===0
          && sameValue(profile.artistKeysMeters,STAB_KEYS)&&sameValue(profile.keysMeters,STAB_KEYS)
          && profile.interpolation==='SMOOTHSTEP'&&profile.bakeHz===120&&profile.fixedProfileNotSkinMinCompensation===true
          && profile.bakeTimeEncoding==='FLOAT32_UNIQUE_SORTED'&&profile.profileErrorGate==='bake_keys_only_2e-6'
          && profile.runtimeInterpolationC1Claim===false,'정확20 signed STAB 승인 프로필');
      }else{
      requireMotion(typeof profile?.profileId === 'string' && profile.profileId.length > 0
        && Number.isFinite(profile.parentWorldYGain) && profile.parentWorldYGain > 0
        && Number.isFinite(profile.maxOffsetMeters) && profile.maxOffsetMeters > 0 && profile.maxOffsetMeters <= .35
        && [profile.initialOffsetMeters, profile.finalOffsetMeters].every(value => Number.isFinite(value) && value >= 0 && value <= profile.maxOffsetMeters), '자산별 고정 저작 프로필 불일치');
      }
      requireMotion(validation && [validation.supportStartMeters, validation.supportEndMeters].every(value => Number.isFinite(value) && Math.abs(value) <= .02)
        && (source.clip !== 'death' || (Number.isFinite(validation.deathEndMeters) && Math.abs(validation.deathEndMeters) <= .02)), '저작 지지점·사망 끝 검증 기록 불일치');
    }
  }
  // 객체 identity는 전체 불변 패킷에 묶인다. 같은 자산의 다른 revision이 캐시를 공유하지 않는다.
  return freezeTree(records);
}

const rangerT1Motion = validateRangerT1Motion(RANGER_T1_MOTION);
// 띠 곡선을 쓰는 궁수 몸(자산 → 검사 끝난 기록). 3단계는 게임이 쓰는 몸 개정(v2) 기록에 묶는다.
const RANGER_BAND_MOTIONS = new Map([
  [RANGER_T1, rangerT1Motion],
  [RANGER_T2, validateRangerT1Motion(RANGER_T2_MOTION, HIGHER_BODY_REVISIONS.revisions.find(revision => revision.asset === RANGER_T2))],
  [RANGER_T3, validateRangerT1Motion(RANGER_T3_MOTION, HIGHER_BODY_REVISIONS.revisions.find(revision => revision.asset === RANGER_T3))],
]);
// 등급 몸 띠 곡선(위 validateTierBandMotion). 상수 검사 도구(SHA·freezeTree)가 정의된 뒤에 만든다.
// 할로윈 아바타(t5) 도적·궁수 교정 몸도 같은 띠 곡선 계약이다(t5-avatar-body-revisions).
const TIER_BAND_SOURCES = [ROGUE_T1S_MOTION, ROGUE_T2U_MOTION, RANGER_T1S_MOTION, RANGER_T2U_MOTION, ROGUE_VAMPIRE_MOTION, RANGER_BLACKCAT_MOTION];
const TIER_BAND_MOTIONS = new Map(TIER_BAND_SOURCES.map(motion => [motion.asset,
  validateTierBandMotion(motion, tierRebindBodyRevisions().find(revision => revision.asset === motion.asset))]));
// 원본 몸 구르기 띠(위 validateOriginalDodgeBand). 같은 이유로 상수 검사 도구 뒤에서 만든다.
const originalDodgeBand = validateOriginalDodgeBand(ORIGINAL_DODGE_BAND);
const ORIGINAL_DODGE_BANDS = new Map(originalDodgeBand.bodies.map(body => [body.asset, body]));
// v1 번들 위에 자산별 새 패킷을 얹는다. 띠 곡선으로 옮긴 자산(3단계 궁수 v2 몸)의 v1 패킷은 이력으로만 남고 등록하지 않는다.
const HIGHER_MOTION_REPLACEMENTS = [R2_BODY_MOTION_V2];
const higherMotionRegistry = createHigherBodyMotionRegistry({schema:'blade-surge.higher-body-motion.v2',
  bodies:[...HIGHER_BODY_MOTION.bodies.filter(body=>!HIGHER_MOTION_REPLACEMENTS.some(next=>next.asset===body.asset)
    && !RANGER_BAND_MOTIONS.has(body.asset)),...HIGHER_MOTION_REPLACEMENTS]});

/** 로더 호출 시 선택한 몸체 revision을 캡처한다. 원본 fallback을 교정본으로 오인하지 않는다. */
export function selectedBodyMotionIdentity(asset) {
  const revised = revisedLibraryFile(asset);
  // 1단계 궁수는 라이브러리 개정(v6) 기록이 몸 출처다. 2·3단계·아바타는 상위 몸체 기록을 쓴다.
  // 등급 몸(S·U) 교정본은 저작 동작이 없어도 실제 선택 파일의 개정 id·SHA 로 기록한다(등록부에 없으면 원본 클립 그대로).
  const revision = asset.id === RANGER_T1 ? rangerLibraryRevision() : HIGHER_BODY_REVISIONS.revisions.find(item => item.asset === asset.id)
    || tierRebindBodyRevisions().find(item => item.asset === asset.id);
  return Object.freeze({ asset: asset.id, heroId: asset.heroId, revisionId: revised && revision ? revision.id : null,
    path: revised || asset.file, sha256: revised && revision ? revision.output.sha256 : asset.sha256 });
}

/** canonical decoded Float32 snapshot과 일치하는 저작 Hips 위치만 교체한다. */
export function createHigherBodyMotionClip(baseClip, body) {
  const entry = body.clipOverrides.find(item => item.base.clip === baseClip?.name);
  requireMotion(entry && baseClip.duration === entry.base.duration, '저작 클립 이름·길이 불일치');
  const matches = baseClip.tracks.filter(track => track.name === entry.base.hipsTrack), source = entry.base, output = entry.outputTrack;
  requireMotion(matches.length === 1, '골반 위치 트랙 개수 불일치');
  const original = matches[0];
  requireMotion(original.ValueTypeName === 'vector' && original.getValueSize() === 3 && original.getInterpolation() === THREE.InterpolateLinear
    && original.times.length === source.times.length && original.values.length === source.values.length
    && source.times.every((value, index) => Object.is(value, original.times[index]))
    && source.values.every((value, index) => Object.is(value, original.values[index])), '실제 decoded 원본 트랙 snapshot 불일치');
  requireMotion(output?.name === original.name && output.type === 'vector' && output.interpolation === 'LINEAR', '저작 위치 트랙 형식 불일치');
  const times = output.times, values = output.values, profile = entry.authoring, signedStab=isR2V2(body)&&baseClip.name==='stab';
  requireMotion(finiteArray(times) && finiteArray(values) && times.length >= Math.ceil(baseClip.duration * 120) + 1
    && times.length <= 1000 && values.length === times.length * 3 && times[0] === 0 && times.at(-1) === baseClip.duration
    && times.every((time, index) => time >= 0 && time <= baseClip.duration && (!index || time > times[index - 1]))
    && source.times.every(time => times.some(sample => Math.abs(sample - time) < 1e-7)), '저작 시간·값 배열 불일치');
  if(signedStab)requireMotion(times.every(time=>Object.is(time,Math.fround(time)))
    && values.every(value=>Object.is(value,Math.fround(value)))
    && STAB_KEYS.every(key=>times.includes(Math.fround(key[0]))), 'STAB F32 strict bake times/values/artist keys');
  const interpolant = original.createInterpolant();
  let minOffset = Infinity, maxOffset = -Infinity;
  for (let index = 0; index < times.length; index++) {
    const reference = interpolant.evaluate(times[index]), offset = index * 3;
    // 실제 VectorKeyframeTrack의 Float32 저장값 기준으로 X/Z 불변을 검사한다.
    requireMotion(Object.is(Math.fround(values[offset]), reference[0]) && Object.is(Math.fround(values[offset + 2]), reference[2]), '골반 수평 이동 변경');
    const deltaMeters = (Math.fround(values[offset + 1]) - reference[1]) * profile.parentWorldYGain;
    minOffset = Math.min(minOffset, deltaMeters); maxOffset = Math.max(maxOffset, deltaMeters);
    if(signedStab)requireMotion(deltaMeters>=-.012-2e-6&&deltaMeters<=2e-6
      && closeMeters(deltaMeters,artistStabValue(times[index])), '저장된 STAB bake-key signed/profile 값');
    else requireMotion(deltaMeters >= -2e-6 && deltaMeters <= profile.maxOffsetMeters + 2e-6 && deltaMeters <= .35 + 2e-6, '고정 저작 높이 범위 초과');
    if (!index) requireMotion(closeMeters(deltaMeters, profile.initialOffsetMeters), '저작 시작 자세 불일치');
    if (index === times.length - 1) requireMotion(closeMeters(deltaMeters, profile.finalOffsetMeters), '저작 끝 자세 불일치');
  }
  requireMotion(maxOffset - minOffset > 2e-6, '전 동작 상수 높이 변경은 허용하지 않습니다.');
  const replacement = new THREE.VectorKeyframeTrack(original.name, times, values, THREE.InterpolateLinear);
  return new THREE.AnimationClip(baseClip.name, baseClip.duration, baseClip.tracks.map(track => track === original ? replacement : track), baseClip.blendMode);
}

/** spawn에서 canonical reference와 당시 별칭만 캡처한다. 사용자 추가 key는 소유하지 않는다. */
export function registerHeroBodyMotion(root, clips, registry = higherMotionRegistry) {
  const heroId = root.userData.authoredContract?.heroId;
  if (!['ranger', 'rogue', ...ORIGINAL_BAND_HEROES].includes(heroId) || states.has(root)) return;
  const entries = [];
  for (const name of [...Object.keys(DURATIONS), ...(heroId==='rogue'?['stab']:[])]) {
    const installed = clips[name]; if (!installed) continue;
    const base = overlayBases.get(installed) || installed;
    const aliases = Object.entries(clips).filter(([, clip]) => clip === installed).map(([key]) => ({ key, installed, owned: true }));
    entries.push({ base, aliases });
  }
  states.set(root, { clips, entries, registry, heroId, version: 0 });
  try { refreshHeroBodyMotion(root); } catch (error) { states.delete(root); throw error; }
}

// 골반 부모의 축·배율은 캐릭터 root 의 부모 기준으로 잰다(게임에서는 root 부모가 장면이라 world 와 같다).
// 옷장 미리보기는 root 위에 화면 맞춤 배율·회전 그룹을 두므로 world 로 재면 저작 배율과 달라 몸 교체가 거절됐다.
const gainMatrix = new THREE.Matrix4();
function hipsParentGain(root) {
  const parent = root.getObjectByName('mixamorigHips')?.parent;
  requireMotion(parent, '실제 골반 부모 없음'); parent.updateWorldMatrix(true, false);
  gainMatrix.copy(parent.matrixWorld);
  if (root.parent) gainMatrix.premultiply(new THREE.Matrix4().copy(root.parent.matrixWorld).invert());
  return gainMatrix.elements;
}

/** 몸체 제거 전에 모든 대상 트랙을 검사한다. 이 함수는 root·별칭·현재 액션을 변경하지 않는다. */
export function prepareHeroBodyMotion(root, identity = root.userData.libraryBodyMotionIdentity || { asset: root.userData.libraryBodyAssetId }) {
  const state = states.get(root); if (!state) return null;
  const body = state.registry.find(item => item.asset === identity.asset);
  const fox = state.heroId === 'ranger' && identity.asset === FOX;
  // 1단계 v6·3단계 v2 몸(띠 곡선): 로더가 고른 개정 id 가 있을 때만 쓰고, 있으면 경로·SHA 가 정확히 같아야 한다(아니면 거절). id 가 없으면 원본 클립.
  // 등록부(registry)에 같은 자산 패킷이 있으면 그쪽이 우선이다(제품 등록부에는 띠 곡선 자산이 없다).
  // 등급 몸(S·U) 교정본(도적·궁수)도 같은 띠 곡선 경로를 쓴다.
  const band = identity.revisionId != null && !body
    ? (state.heroId === 'ranger' && RANGER_BAND_MOTIONS.get(identity.asset)) || TIER_BAND_MOTIONS.get(identity.asset) || null : null;
  const t1 = band !== null;
  if (t1) requireMotion(identity.heroId === state.heroId && band.heroId === state.heroId && identity.revisionId === band.revisionId
    && identity.path === band.body.path && identity.sha256 === band.body.sha256, '실제 선택 1단계 몸체와 모션 불일치');
  if (t1) {
    requireMotion(band.clipOverrides.every(entry => state.entries.some(item => item.base.name === entry.base.clip)), '1단계 공유 원본 클립 누락');
    const matrix = hipsParentGain(root);
    requireMotion(Math.abs(matrix[1]) < 1e-7 && Math.abs(matrix[9]) < 1e-7 && matrix[5] > 0
      && band.clipOverrides.every(entry => Math.abs(entry.authoring.parentWorldYGain - matrix[5]) <= 1e-7), '1단계 골반 부모 world/native 축·배율 불일치');
  }
  // 원본 몸(개정 id 없음) 구르기 띠: 등록부·띠 곡선 기록이 없는 기사·야만전사·마법사 몸만.
  const original = identity.revisionId == null && !body && !band && ORIGINAL_DODGE_BANDS.get(identity.asset) || null;
  if (original) {
    requireMotion(identity.heroId === state.heroId && original.heroId === state.heroId
      && identity.path === original.body.path && identity.sha256 === original.body.sha256, '실제 선택 원본 몸체와 구르기 띠 불일치');
    requireMotion(state.entries.some(item => item.base.name === 'dodge'), '원본 몸 구르기 띠 공유 원본 클립 누락');
    const matrix = hipsParentGain(root), row = [matrix[1], matrix[5], matrix[9]], axis = original.authoring.parentWorldYAxis, gain = original.authoring.parentWorldYGain;
    requireMotion(Math.abs(row[axis] - gain) <= 1e-7 * Math.max(1, Math.abs(gain))
      && row.every((value, index) => index === axis || Math.abs(value) <= 1e-5 * Math.abs(gain)), '원본 몸 골반 부모 world/native 축·배율 불일치');
  }
  if(identity.asset===R2)requireMotion(isR2V2(body)&&body.authoringMethod===REPAIRED_METHOD,'R2 reviewed repaired v2 required; no legacy fallback');
  if (body) requireMotion(body.heroId === state.heroId && identity.heroId === state.heroId && identity.revisionId === body.revisionId
    && identity.path === body.body.path && identity.sha256 === body.body.sha256, '실제 선택 몸체와 모션 불일치');
  if (body) requireMotion(body.clipOverrides.every(entry => state.entries.some(item => item.base.name === entry.base.clip)), '공유 원본 클립 누락');
  if (body) {
    const matrix = hipsParentGain(root);
    requireMotion(Math.abs(matrix[1]) < 1e-7 && Math.abs(matrix[9]) < 1e-7 && matrix[5] > 0
      && body.clipOverrides.every(entry => Math.abs(entry.authoring.parentWorldYGain - matrix[5]) <= 1e-7), '골반 부모 world/native 축·배율 불일치');
  }
  if(isR2V2(body)){
    const matrix=hipsParentGain(root);
    requireMotion(Math.abs(matrix[4])<1e-7&&Math.abs(matrix[6])<1e-7,'signed STAB actual parent localY world axis');
  }
  const changes = state.entries.map(entry => {
    const active = fox || (t1 && band.clipOverrides.some(item => item.base.clip === entry.base.name)) || (original && entry.base.name === 'dodge')
      || body?.clipOverrides.some(item => item.base.clip === entry.base.name);
    let next = entry.base;
    if (active) {
      let cache = bodyClips.get(entry.base);
      if (!cache) { cache = new Map(); bodyClips.set(entry.base, cache); }
      const key = fox ? FOX_BODY_MOTION : t1 ? band : original || body;
      next = cache.get(key);
      if (!next) { next = fox ? createBodyMotionClip(entry.base) : t1 ? createRangerT1BodyMotionClip(entry.base, band) : original ? createOriginalDodgeBandClip(entry.base, original) : createHigherBodyMotionClip(entry.base, body); cache.set(key, next); overlayBases.set(next, entry.base); }
    }
    return { entry, next };
  });
  return { state, version: state.version, changes };
}

/** 검증이 끝난 계획만 설치한다. 재생 중 action을 재시작하거나 시간을 바꾸지 않는다. */
export function commitHeroBodyMotion(root, plan) {
  if (!plan) return true;
  if (states.get(root) !== plan.state || plan.state.version !== plan.version) return false;
  for (const { entry, next } of plan.changes) for (const alias of entry.aliases) {
    if (!alias.owned) continue;
    if (plan.state.clips[alias.key] !== alias.installed) { alias.owned = false; continue; }
    plan.state.clips[alias.key] = next; alias.installed = next;
  }
  plan.state.version++;
  return true;
}

/** 직접 spawn 및 기존 공개 호출용. swap은 prepare/commit을 별도로 사용한다. */
export function refreshHeroBodyMotion(root) {
  commitHeroBodyMotion(root, prepareHeroBodyMotion(root));
}

export function disposeHeroBodyMotion(root) {
  states.delete(root);
}
