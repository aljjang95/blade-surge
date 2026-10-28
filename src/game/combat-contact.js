import { FEEL } from './feel.js';

const STOP = FEEL.hitstop.base;
// Presentation only. Called after damage is accepted, never from attack startup.
export function contactProfile(opts, crit, boss, reduced, weapon = '') {
  if (opts.quiet || opts.noProc) return null;
  const tier = opts.counter ? 'counter' : opts.finisher ? 'finisher' : boss ? 'boss' : (opts.kb || 0) >= 6 ? 'heavy' : 'light';
  const warrior = weapon === '1h' || weapon === '2h';
  return { tier, heavy: tier !== 'light',
    // 짧은 정지는 접촉 위치를 읽게 하고, 강한 정지는 한 번만 길게 남긴다.
    // contactBudget가 같은 프레임의 군중 타격을 합치므로 프레임레이트와 무관하다.
    // 정지가 너무 짧아(.02초대) 한 프레임도 멈추지 않던 등급을 체감되는 길이로 올렸다.
    // 기본 정지(초)는 game/feel.js 의 FEEL.hitstop.base 한 표에서 온다. 실제 정지는 hitWeight 로 더 무거워진다.
    stop: reduced || opts.quietStop ? 0 : tier === 'finisher' ? STOP.finisher : tier === 'counter' ? STOP.counter : tier === 'boss' ? STOP.boss : tier === 'heavy' ? STOP.heavy : crit ? STOP.crit : opts.basic ? STOP.basic : STOP.light,
    haptic: opts.basic ? (tier === 'finisher' ? (warrior ? [22,12,42] : [18,12,36]) : tier === 'counter' ? [22,14,40] : crit ? (warrior ? 28 : 22) : weapon === '2h' ? 24 : weapon === '1h' ? 20 : 14) : (tier !== 'light' ? 20 : 0),
    particles: reduced ? 0 : tier === 'light' ? 4 : tier === 'counter' ? 9 : 7,
    size: reduced ? .7 : tier === 'light' ? 1 : tier === 'counter' ? 1.65 : 1.45,
  };
}

// 한 60ms 창 안에서 첫 접점 뒤로 섬광만 더 받는 적 수(군중 타격이 첫 적만 번쩍이지 않게).
export const CROWD_SPARKS = 3;

// Pure window decision: one emission and at most one finisher upgrade per 60 ms.
export function contactBudget(previous, now, contact) {
  if (!contact) return null;
  if (!previous || now - previous.at >= .06 || now < previous.at) {
    return { at: now, finisher: contact.tier === 'finisher', emit: true };
  }
  if (contact.tier === 'finisher' && !previous.finisher) {
    return { at: previous.at, finisher: true, emit: false };
  }
  return null;
}
