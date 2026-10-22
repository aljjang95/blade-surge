# 애니메이션 팩 저작(h4-anim). Blender 5.2 헤드리스에서 실행한다.
#   blender -b --factory-startup -noaudio --python tools/blender/author_anim_packs.py -- \
#     --asset hero_knight_t1 --source <게임이 실제로 읽는 GLB> --out public/models/anim-packs/hero_knight_t1.glb \
#     --report <json> [--strips <dir>]
# 원본 GLB 는 읽기만 한다. 새 클립(제자리·이음새 보정, 강타/좌우 피격, 두 번째 사망, 등장)을 절차적으로 만들어
# 뼈대만 있는 팩 GLB 로 내보낸다. 각도·길이·순서는 아래 RECIPES 에 고정되어 같은 입력이면 같은 출력이다.
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import anim_lib as L  # noqa: E402
from mathutils import Vector  # noqa: E402

D = math.radians
# 월드 축(Blender, Z 위). 모든 자산은 glTF +Z(three) == Blender -Y 를 앞으로 본다.
FWD, UP, LEFT = Vector((0, -1, 0)), Vector((0, 0, 1)), Vector((1, 0, 0))
PITCH = LEFT            # +각 = 앞으로 숙임
YAW = UP                # +각 = 왼쪽으로 돎
LEAN = Vector((0, 1, 0))  # +각 = 윗몸이 왼쪽(+X)으로 기욺


def arg(name, default=None):
  a = sys.argv[sys.argv.index('--') + 1:]
  return a[a.index('--' + name) + 1] if '--' + name in a else default


class Ctx:
  def __init__(self, src):
    self.arm = L.load(src)
    self.rig = L.Rig(self.arm)
    self.acts = L.source_actions()
    r = self.rig
    self.hips = r.find('Hips') or r.find('root')
    self.humanoid = bool(r.find('Hips') and r.find('LeftUpLeg') and r.find('Spine'))
    self.spine = [b for b in (r.find('Spine'), r.find('Spine1'), r.find('Spine2')) if b]
    self.neck, self.head = r.find('Neck'), r.find('Head')
    self.arm_l, self.arm_r = r.find('LeftArm'), r.find('RightArm')
    self.fore_l, self.fore_r = r.find('LeftForeArm'), r.find('RightForeArm')
    self.upleg_l, self.upleg_r = r.find('LeftUpLeg'), r.find('RightUpLeg')
    self.leg_l, self.leg_r = r.find('LeftLeg'), r.find('RightLeg')
    self.legs = L.Legs(r) if self.humanoid else None
    rest = {b: (Vector(), L.Quaternion(), Vector((1, 1, 1))) for b in r.bones}
    self.hh = max(0.05, r.head_world(r.pose(rest), self.hips).z) if self.humanoid else 0.0
    self.made = {}
    self.metrics = {}

  def clip(self, name, times=None, dur=None):
    a = self.acts[name]
    times = times or L.grid(dur or L.duration(a))
    return times, L.sample(self.arm, a, times)

  def spine_rot(self, f, axis, total, weights=(0.34, 0.33, 0.33)):
    for bone, w in zip(self.spine, weights[-len(self.spine):] if len(self.spine) < 3 else weights):
      L.rotate_world(self.rig, f, bone, axis, total * w)

  def add(self, name, times, frames, base, kind, extra=None):
    self.made[name] = (times, frames, base, kind)
    self.metrics[name] = dict(extra or {}, base=base, kind=kind)


# ---------------------------------------------------------------- 연산
def inplace_seam(ctx, base, name, lock=1.0, seam_start=0.72, target='first'):
  times, frames = ctx.clip(base)
  locked = L.root_lock(ctx.rig, frames, times, ctx.hips, amount=lock) if lock > 0 else frames
  tgt = locked[0] if target == 'first' else ctx.clip(target, times=[0.0])[1][0]
  out = L.seam_blend(locked, times, tgt, seam_start)
  if ctx.humanoid: out, _ = L.ground_fix(ctx.arm, ctx.rig, out, times, ctx.hips)
  ctx.add(name, times, out, base, 'inplace-seam', {'lock': lock, 'seamStart': seam_start, 'seamTarget': target})


def plant(ctx, f, captured, weight=1.0):
  if not ctx.legs or weight <= 0: return f
  g = L.copy_basis(f)
  ctx.legs.plant(g, captured)
  return g if weight >= 1 else L.blend_basis(f, g, weight)


def hit_heavy(ctx, name='hit_heavy'):
  """강타 피격: 첫 0.16 에 윗몸이 뒤로 젖혀지고 골반이 뒤·아래로 밀린 뒤(발은 제자리), 앞으로 숙이며 회복한다."""
  base = 'hit'
  src = L.duration(ctx.acts[base])
  dur = max(src * 1.3, 0.75)
  warp = lambda u: 0.0 if u < 0.2 else (u - 0.2) / 0.8  # 충격(뒤로 젖힘) 동안 원본은 시작 자세, 이어서 원본 움츠림이 회복으로
  times, frames = L.resample(ctx.arm, ctx.acts[base], dur, warp)
  hh = ctx.hh
  out = []
  for f, t in zip(frames, times):
    u = t / dur
    snap, rec = L.bell(u, 0.0, 0.16, 0.62), L.bell(u, 0.22, 0.45, 0.92)
    g = L.copy_basis(f)
    cap = ctx.legs.capture(g)
    L.translate_world(ctx.rig, g, ctx.hips, (-FWD) * (0.2 * hh * snap) + UP * (-0.1 * hh * snap))
    L.rotate_world(ctx.rig, g, ctx.hips, PITCH, D(-8) * snap)
    ctx.spine_rot(g, PITCH, D(-36) * snap + D(6) * rec)
    L.rotate_world(ctx.rig, g, ctx.neck, PITCH, D(-8) * snap)
    L.rotate_world(ctx.rig, g, ctx.head, PITCH, D(-18) * snap + D(5) * rec)
    # 팔이 충격에 들린다(어깨 기준 바깥·위로)
    L.rotate_world(ctx.rig, g, ctx.arm_l, LEAN, D(-18) * snap)
    L.rotate_world(ctx.rig, g, ctx.arm_r, LEAN, D(18) * snap)
    out.append(plant(ctx, g, cap))
  out, _ = L.ground_fix(ctx.arm, ctx.rig, out, times, ctx.hips)
  ctx.add(name, times, out, base, 'hit-heavy', {'duration': round(dur, 4)})


def hit_side(ctx, side, name):
  """좌/우 피격: 맞은 쪽 반대로 윗몸이 비틀리고 기울며 골반이 밀린다. side=+1 왼쪽에서 맞음."""
  base = 'hit'
  src = L.duration(ctx.acts[base])
  dur = max(src, 0.6)
  times, frames = L.resample(ctx.arm, ctx.acts[base], dur)
  hh, s = ctx.hh, side
  out = []
  for f, t in zip(frames, times):
    u = t / dur
    e = L.bell(u, 0.0, 0.17, 0.78)
    g = L.copy_basis(f)
    cap = ctx.legs.capture(g)
    # 왼쪽에서 맞으면 몸은 오른쪽(-X)으로 밀리고 오른쪽으로 돌며(-yaw) 윗몸이 오른쪽으로 기운다(-lean)
    L.translate_world(ctx.rig, g, ctx.hips, LEFT * (-0.08 * hh * e * s) + UP * (-0.03 * hh * e))
    ctx.spine_rot(g, YAW, D(-24) * e * s)
    ctx.spine_rot(g, LEAN, D(-13) * e * s)
    L.rotate_world(ctx.rig, g, ctx.head, YAW, D(-14) * e * s)
    L.rotate_world(ctx.rig, g, ctx.head, LEAN, D(-8) * e * s)
    hit_arm = ctx.arm_l if s > 0 else ctx.arm_r
    L.rotate_world(ctx.rig, g, hit_arm, LEAN, D(-16) * e * s)
    out.append(plant(ctx, g, cap))
  out, _ = L.ground_fix(ctx.arm, ctx.rig, out, times, ctx.hips)
  ctx.add(name, times, out, base, 'hit-side', {'side': 'left' if s > 0 else 'right', 'duration': round(dur, 4)})


def death_forward(ctx, name='death_fwd', lock=1.0):
  """원본 사망(앞으로 무너짐)을 제자리로: 골반 수평 이동을 빼고 바닥 관통을 막는다."""
  base = 'death'
  times, frames = ctx.clip(base)
  out = L.root_lock(ctx.rig, frames, times, ctx.hips, amount=lock, window=0.6)
  out, _ = L.ground_fix(ctx.arm, ctx.rig, out, times, ctx.hips)
  ctx.add(name, times, out, base, 'death-inplace', {'lock': lock})


def death_back(ctx, name='death_back', dur=1.75):
  """뒤로 쓰러짐: 충격에 젖혀짐 → 무릎이 꺾이며 주저앉음(발 고정) → 등으로 넘어짐 → 작은 튕김 후 정착."""
  base = 'hit'
  hit_dur = L.duration(ctx.acts[base])
  times = L.grid(dur)
  frames = L.sample(ctx.arm, ctx.acts[base], [min(t * 0.5, 0.08) for t in times])  # 전투 대기에 가까운 시작 자세(움츠림 전)
  hh = ctx.hh
  out = []
  for f, t in zip(frames, times):
    g = L.copy_basis(f)
    cap = ctx.legs.capture(g)
    impact = L.bell(t, 0.0, 0.16, 0.7)
    buckle = L.smooth((t - 0.12) / 0.45)
    fall = L.smooth((t - 0.42) / 0.5)
    bounce = L.bell(t, 0.92, 1.05, 1.32)
    settle = L.smooth((t - 0.95) / 0.6)
    # 주저앉기: 골반이 뒤·아래로(발 고정)
    L.translate_world(ctx.rig, g, ctx.hips, (-FWD) * (0.28 * hh * buckle) + UP * (-0.38 * hh * buckle))
    # 넘어지기: 몸통(골반→목) 방향을 뒤쪽 수평으로, 허벅지·정강이는 앞쪽 바닥으로 겨눈다(시작 자세와 무관한 절대 목표).
    back = (-FWD + UP * (0.06 + 0.12 * bounce)).normalized()
    L.aim(ctx.rig, g, ctx.hips, ctx.neck, back, fall)
    for up, leg, foot, sgn in ((ctx.upleg_l, ctx.leg_l, ctx.rig.find('LeftFoot'), 1), (ctx.upleg_r, ctx.leg_r, ctx.rig.find('RightFoot'), -1)):
      L.aim(ctx.rig, g, up, leg, (FWD + UP * 0.32 + LEFT * (0.22 * sgn)).normalized(), fall)
      L.aim(ctx.rig, g, leg, foot, (FWD - UP * 0.28 + LEFT * (0.12 * sgn)).normalized(), fall)
    ctx.spine_rot(g, PITCH, D(-22) * impact + D(4) * bounce)
    L.rotate_world(ctx.rig, g, ctx.neck, PITCH, D(-10) * impact + D(14) * settle)
    L.rotate_world(ctx.rig, g, ctx.head, PITCH, D(-14) * impact + D(8) * settle)
    L.rotate_world(ctx.rig, g, ctx.head, YAW, D(28) * settle)
    # 팔: 충격에 들리고, 넘어진 뒤엔 몸 옆 바닥으로 벌어진다
    L.rotate_world(ctx.rig, g, ctx.arm_l, LEAN, D(-30) * impact)
    L.rotate_world(ctx.rig, g, ctx.arm_r, LEAN, D(30) * impact)
    L.aim(ctx.rig, g, ctx.arm_l, ctx.fore_l, (LEFT - FWD * 0.35 - UP * 0.25).normalized(), fall * 0.85)
    L.aim(ctx.rig, g, ctx.arm_r, ctx.fore_r, (-LEFT - FWD * 0.35 - UP * 0.25).normalized(), fall * 0.85)
    ik_w = 1.0 - L.smooth((t - 0.4) / 0.3)
    out.append(plant(ctx, g, cap, ik_w))
  # 넘어진 뒤(0.75초~)엔 몸 최저점이 바닥에 닿게 내리고, 그 전엔 관통만 막는다.
  out, lows = L.ground_fix(ctx.arm, ctx.rig, out, times, ctx.hips, only_when=lambda t: t > 0.75, smooth_win=3)
  ctx.add(name, times, out, base, 'death-back', {'duration': dur})


def chop_heavy(ctx, name='chop_heavy'):
  """두손 내려찍기: 같은 내려찍기를 더 깊은 예비 동작(뒤로 젖힘)과 무거운 타격(앞으로 숙임·골반 내려앉음)으로."""
  base = 'chop'
  src = L.duration(ctx.acts[base])
  dur = src * 1.15
  warp = lambda u: u / 0.45 * 0.35 if u < 0.45 else 0.35 + (u - 0.45) / 0.55 * 0.65
  times, frames = L.resample(ctx.arm, ctx.acts[base], dur, warp)
  hh = ctx.hh
  out = []
  for f, t in zip(frames, times):
    u = t / dur
    wind, strike = L.bell(u, 0.05, 0.36, 0.5), L.bell(u, 0.42, 0.58, 0.95)
    g = L.copy_basis(f)
    cap = ctx.legs.capture(g)
    L.translate_world(ctx.rig, g, ctx.hips, UP * (-0.08 * hh * strike))
    ctx.spine_rot(g, PITCH, D(-14) * wind + D(16) * strike)
    L.rotate_world(ctx.rig, g, ctx.head, PITCH, D(6) * wind - D(6) * strike)
    out.append(plant(ctx, g, cap))
  first = out[0]
  out = L.seam_blend(out, times, first, 0.8)
  ctx.add(name, times, out, base, 'chop-heavy', {'duration': round(dur, 4)})


def spin_whirl(ctx, src_name, name='spin_whirl'):
  """회오리: 제자리 회전 클립 위에 골반 한 바퀴를 더해 두 바퀴 돈다(발은 축처럼 돈다)."""
  times, frames, _, _ = ctx.made[src_name]
  dur = times[-1]
  out = []
  for f, t in zip(frames, times):
    u = t / dur
    g = L.copy_basis(f)
    L.rotate_world(ctx.rig, g, ctx.hips, YAW, D(-360) * L.smooth((u - 0.08) / 0.72))
    out.append(g)
  ctx.add(name, times, out, src_name, 'spin-whirl', {'extraTurnDeg': -360})


def twist_death(ctx, name='death_b', turn=100.0, speed=0.9):
  """두 번째 사망(몬스터): 원본 사망을 조금 빠르게, 무너지는 동안 몸 전체가 옆으로 비틀려 다른 방향으로 쓰러진다."""
  base = 'death'
  src = L.duration(ctx.acts[base])
  dur = src * speed
  times, frames = L.resample(ctx.arm, ctx.acts[base], dur)
  roots = [b for b in ctx.rig.bones if ctx.rig.parent[b] is None]  # 뿌리 뼈가 여럿인 리그(분리된 꼬리 등)도 함께 돈다
  out = []
  for f, t in zip(frames, times):
    u = t / dur
    g = L.copy_basis(f)
    ang = D(turn) * L.smooth((u - 0.04) / 0.5)
    c, s = math.cos(ang), math.sin(ang)
    for root in roots:
      # 뿌리 뼈를 원점 수직축 기준으로 돌린다: 회전 + 위치 회전
      pose = ctx.rig.pose(g)
      p = ctx.rig.head_world(pose, root)
      L.rotate_world(ctx.rig, g, root, YAW, ang, pose)
      rotated = Vector((p.x * c - p.y * s, p.x * s + p.y * c, p.z))
      L.translate_world(ctx.rig, g, root, rotated - p)
    out.append(g)
  if ctx.humanoid:
    out, _ = L.ground_fix(ctx.arm, ctx.rig, out, times, ctx.hips)
  ctx.add(name, times, out, base, 'death-twist', {'turnDeg': turn, 'speed': speed})


def spawn_rise(ctx, name='spawn', dur=1.25):
  """등장(인간형): 웅크린 자세(골반 내려앉음·윗몸 숙임, 발 고정)에서 일어서며 포효 클립 앞부분으로 섞여 들어간다.
  게임은 1.7배속으로 재생하고 80% 지점에서 전투에 들어가므로(약 0.59초) 예전 팝인(0.42초)과 박자가 크게 다르지 않다."""
  roar = ctx.acts['roar']
  rdur = L.duration(roar)
  times = L.grid(dur)
  # 포효 앞부분을 0.3초부터 1.4배속으로(앞부분은 포효 첫 자세 유지)
  rt = [min(rdur, max(0.0, (t - 0.3) * 1.4)) for t in times]
  frames = L.sample(ctx.arm, roar, rt)
  idle0 = ctx.clip('idle', times=[0.0])[1][0]
  hh = ctx.hh
  out = []
  for f, t in zip(frames, times):
    crouch = 1.0 - L.smooth((t - 0.08) / 0.45)
    g = L.copy_basis(f)
    cap = ctx.legs.capture(g)
    L.translate_world(ctx.rig, g, ctx.hips, UP * (-0.42 * hh * crouch) + (-FWD) * (0.1 * hh * crouch))
    ctx.spine_rot(g, PITCH, D(42) * crouch)
    L.rotate_world(ctx.rig, g, ctx.head, PITCH, D(-20) * crouch)
    L.rotate_world(ctx.rig, g, ctx.arm_l, LEAN, D(12) * crouch)
    L.rotate_world(ctx.rig, g, ctx.arm_r, LEAN, D(-12) * crouch)
    out.append(plant(ctx, g, cap))
  # 끝 30% 는 대기 첫 자세로 수렴(등장 뒤 idleCombat 전환 이음새)
  out = L.seam_blend(out, times, idle0, 0.7)
  out, _ = L.ground_fix(ctx.arm, ctx.rig, out, times, ctx.hips)
  ctx.add(name, times, out, 'roar', 'spawn-rise', {'duration': dur})


# ---------------------------------------------------------------- 자산별 레시피
HERO_HITS = [('hit_heavy', hit_heavy), ('hit_left', lambda c: hit_side(c, 1, 'hit_left')), ('hit_right', lambda c: hit_side(c, -1, 'hit_right'))]
HERO_DEATHS = [('death_fwd', death_forward), ('death_back', death_back)]

RECIPES = {
  'hero_knight_t1': HERO_HITS + HERO_DEATHS + [
    ('slash_d_ip', lambda c: inplace_seam(c, 'slash_d', 'slash_d_ip')),
    ('stab_ip', lambda c: inplace_seam(c, 'stab', 'stab_ip')),
    ('chop_heavy', chop_heavy),
  ],
  'hero_barbarian_t1': HERO_HITS + HERO_DEATHS + [
    ('stab_ip', lambda c: inplace_seam(c, 'stab', 'stab_ip')),
    ('spin_ip', lambda c: inplace_seam(c, 'spin', 'spin_ip', seam_start=0.7)),
    ('spin_whirl', lambda c: spin_whirl(c, 'spin_ip')),
    ('jump_attack_ip', lambda c: inplace_seam(c, 'jump_attack', 'jump_attack_ip', seam_start=0.75)),
  ],
  'hero_mage_t1': HERO_HITS + HERO_DEATHS,
  # 도적·궁수 사망·회피·찌르기는 몸체별 저작 보정(hero-body-motion)과 활 접지 계약이 원본 클립에 묶여 있어 바꾸지 않는다.
  'hero_rogue_t1': HERO_HITS + [('death_back', death_back)],
  'hero_ranger_t1': HERO_HITS,
}
HUMANOID_SPAWN = {'bone_knight', 'shadow_soldier', 'skeleton_mage', 'goblin_chief', 'goblin_raider', 'goblin_brute', 'frost_yeti', 'demon_lord'}
# 원본 클립 이음새가 45° 를 넘는 몬스터 공격 클립(GLB 원본 키 첫·끝 회전 차로 재측정. 등장 클립은 원본 이음새가 20° 이하라 제외)
MONSTER_SEAMS = {
  'bone_knight': ['attack2', 'attackJump'], 'shadow_soldier': ['attack2', 'attackJump'], 'goblin_raider': ['attack2', 'attackJump'],
  'skeleton_mage': ['attack2'], 'mushroom_shaman': ['attack2'],
  'goblin_chief': ['attackSpin'], 'goblin_brute': ['attackSpin'], 'frost_yeti': ['attackSpin'], 'demon_lord': ['attackSpin'],
}
MONSTERS = ['slime', 'ember_drake', 'void_wisp', 'fire_phoenix', 'star_owl', 'bone_knight', 'skeleton_mage', 'goblin_brute', 'frost_yeti',
            'demon_lord', 'goblin_raider', 'shadow_soldier', 'goblin_chief', 'mushroom_shaman', 'treant', 'frost_golem']


def monster_recipe(asset):
  steps = []
  for clip in MONSTER_SEAMS.get(asset, []):
    target = 'idle' if clip == 'spawn' else 'first'
    steps.append((clip + 'Seam', (lambda c, clip=clip, target=target: inplace_seam(c, clip, clip + 'Seam', lock=0.0, seam_start=0.7, target=target))))
  # 몬스터마다 비트는 방향을 번갈아(자산 순서) 군중 사망이 한쪽으로만 쓰러지지 않게 한다.
  sign = 1 if MONSTERS.index(asset) % 2 == 0 else -1
  steps.append(('deathAlt', lambda c: twist_death(c, 'deathAlt', turn=100.0 * sign)))
  if asset in HUMANOID_SPAWN: steps.append(('spawn', spawn_rise))
  return steps


for _m in MONSTERS: RECIPES[_m] = monster_recipe(_m)


def main():
  asset, src, out, report = arg('asset'), arg('source'), arg('out'), arg('report')
  strips = arg('strips')
  only = set(arg('only').split(',')) if arg('only') else None
  ctx = Ctx(src)
  result = {'asset': asset, 'humanoid': ctx.humanoid, 'hipsBone': ctx.hips, 'hipsRestHeight': round(ctx.hh, 4), 'clips': {}}
  for name, fn in RECIPES[asset]:
    if only and name not in only and not any(name.startswith(o) for o in only): continue
    fn(ctx)
  actions = []
  for name, (times, frames, base, kind) in ctx.made.items():
    actions.append(L.write_action(ctx.arm, name, frames, times))
    bt, bf = ctx.clip(base) if base in ctx.acts else (ctx.made[base][0], ctx.made[base][1])
    m = ctx.metrics[name]
    idle0 = ctx.clip('idle', times=[0.0])[1][0] if 'idle' in ctx.acts else frames[0]
    m.update({
      'endToIdleDeg': round(L.max_angle_deg(frames[-1], idle0), 1), 'baseEndToIdleDeg': round(L.max_angle_deg(bf[-1], idle0), 1),
      'duration': round(times[-1], 4), 'frames': len(times),
      'baseSeamDeg': round(L.max_angle_deg(bf[0], bf[-1]), 1), 'seamDeg': round(L.max_angle_deg(frames[0], frames[-1]), 1),
      'baseRootDriftM': round(L.drift_m(ctx.rig, bf, ctx.hips), 3), 'rootDriftM': round(L.drift_m(ctx.rig, frames, ctx.hips), 3),
      'baseRootRangeM': round(L.range_m(ctx.rig, bf, ctx.hips), 3), 'rootRangeM': round(L.range_m(ctx.rig, frames, ctx.hips), 3),
      'minSkinZ': round(min(L.mesh_min_z(ctx.arm, ctx.rig, f) for f in frames[::max(1, len(frames) // 24)]), 4),
    })
    result['clips'][name] = m
  L.export_pack(ctx.arm, actions, out)
  if strips:
    os.makedirs(strips, exist_ok=True)
    for name, (times, frames, base, kind) in ctx.made.items():
      views = ['side', '34'] if kind.startswith('death') or kind.startswith('spawn') else ['side', 'front'] if kind.startswith('hit') else ['34']
      for view in views:
        L.render_strip(ctx.arm, frames, times, os.path.join(strips, f'{asset}__{name}__after-{view}.png'), n=8, size=200, view=view)
        if base in ctx.acts:
          bt, bf = ctx.clip(base)
          L.render_strip(ctx.arm, bf, bt, os.path.join(strips, f'{asset}__{name}__before-{base}-{view}.png'), n=8, size=200, view=view)
  with open(report, 'w') as fh: json.dump(result, fh, ensure_ascii=False, indent=1)
  print('ANIM_PACK_OK', asset, len(actions))


main()
