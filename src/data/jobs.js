export const JOBS = [
  { id: 'guardian', name: '수호 기사', baseHero: 'knight', resource: '결의', description: '방패 타이밍으로 반격하고 결의 3을 모아 수호 폭발' },
  { id: 'ranger', name: '바람 추적자', baseHero: 'rogue', resource: '집중', description: '원거리 3연타로 집중을 모아 관통 사격 강화' },
];
const skill = (base, id, name, cd, dmg, desc) => ({ ...base, id, name, cd, dmg, desc });
export function resolveJobHero(base, jobId) {
  const job = JOBS.find(j => j.id === jobId && j.baseHero === base?.id);
  if (!job) return base;
  const skills = base.skills.map(s => ({ ...s }));
  if (job.id === 'guardian') {
    skills[0] = skill(skills[0], 'guardian_guard', '찰나의 방패', 5, 2.8, '0.75초 방어. 첫 0.3초에 피격하면 완전 방어와 반격, 결의 +2');
    skills[1] = skill(skills[1], 'guardian_rebuke', '결의의 반격', 7, 3.2, '결의 3 소비 시 피해 2배·주변 기절');
    return { ...base, jobId, title: job.name, base: { ...base.base, hp: base.base.hp * 1.12, spd: base.base.spd * .94 }, skills,
      combo: base.combo.slice(0,3).map((c,i) => ({ ...c, dmg: c.dmg * 1.15, finisher: i === 2, jobGain: i === 2 ? 1 : 0 })) };
  }
  skills[0] = skill(skills[0], 'ranger_pierce', '바람 관통탄', 4, 2.8, '집중 3 소비 시 강화 관통탄. 3연타와 회피로 집중 획득');
  skills[1] = skill(skills[1], 'ranger_volley', '삼중 추적탄', 8, 2.0, '부채꼴 관통 사격. 적을 관통하며 둔화');
  return { ...base, jobId, title: job.name, ranged: true, skills,
    combo: [0,1,2].map((i) => ({ anim: base.combo[0].anim, hitAt: .35, dmg: i === 2 ? 1.35 : .8, range: 11, arc: 30, kb: i === 2 ? 3 : 1, dur: i === 2 ? .65 : .42, projectile: i === 2 ? 'bigbolt' : 'bolt', finisher: i === 2, jobGain: 1 })) };
}
