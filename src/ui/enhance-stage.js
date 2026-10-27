import './enhance-stage.css';
import { audio } from '../engine/audio.js';

// 강화 연출(대표님 2026-10-28 "긴박한 느낌, 성취감·만족감"). 결과는 eco.enhance 가 이미 정했고, 여기서는 보여 주는 순서만 정한다.
// 긴장(가장자리 어둠·빨라지는 망치질·심장 저음·무기 확대·게이지) → 결과(성공 섬광·파편·숫자 박힘 / 실패 둔탁음·균열·정적).
// 화면 전체 흔들림은 쓰지 않는다. 연출 동안 시트를 어둡게 덮고 가운데 '모루' 위에 무기를 크게 띄운다.
// 결과 숫자·균열은 그 무기 위에만 그려서 시트 글자와 섞이지 않는다(2026-10-28 화면 QA: 헤더 아이콘 확대는 잘리고 숫자가 카드 글자를 덮었다).

/** 구간 돌파 단계: 성공해서 이 수치에 닿으면 큰 연출. */
export const ENHANCE_MILESTONES = Object.freeze([10, 13, 15, 20]);

/**
 * 긴장 구간 길이와 망치질 박자(초). 단계가 높을수록 길고(0.8~2.0초) 박자가 점점 빨라진다.
 * quick: 직전 강화 뒤 곧바로 다시 누른 연속 강화(짧은 판). reduced: 움직임 줄이기.
 */
export function enhanceStageTiming(lv, { quick = false, reduced = false } = {}) {
  const k = Math.max(0, Math.min(1, (lv - 3) / 14));
  const tension = reduced ? 0.3 : quick ? 0.45 + 0.25 * k : 0.8 + 1.2 * k;
  // 박자 간격은 0.34초에서 0.07초까지 줄어든다(가속). 마지막 박자는 결과 직전.
  const beats = [];
  if (!reduced) {
    let t = 0.05, gap = quick ? 0.2 : 0.34;
    while (t < tension - 0.06) { beats.push(+t.toFixed(3)); t += gap; gap = Math.max(0.07, gap * (quick ? 0.8 : 0.78)); }
  }
  return { tension: +tension.toFixed(3), beats };
}

/** 결과 종류와 구간 돌파 여부. */
export function enhanceOutcome(result) {
  if (result.destroyed) return { kind: 'destroy', milestone: false };
  if (!result.success) return { kind: result.down ? 'down' : 'fail', milestone: false };
  return { kind: 'success', milestone: ENHANCE_MILESTONES.includes(result.enh) };
}

let lastEnd = 0;

/**
 * 시트(host) 안의 무기 그림(art) 위에서 연출을 재생한다. 탭/클릭/키로 건너뛸 수 있다.
 * 결과 소리·진동·음성까지 여기서 내므로 호출자는 끝난 뒤 문구·다시 그리기만 하면 된다.
 * @returns {Promise<{skipped: boolean}>}
 */
export function playEnhanceStage(host, art, { from, result }) {
  const reduced = !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const now = performance.now(), quick = now - lastEnd < 2500;
  const { tension, beats } = enhanceStageTiming(from, { quick, reduced });
  const out = enhanceOutcome(result);
  const stage = document.createElement('div');
  stage.className = 'enh-stage' + (quick ? ' quick' : '') + (reduced ? ' still' : '');
  stage.setAttribute('role', 'status'); stage.setAttribute('aria-live', 'polite');
  stage.style.setProperty('--tension', tension + 's');
  stage.innerHTML = '<div class="enh-vignette"></div><div class="enh-anvil"><div class="enh-halo"></div><div class="enh-weapon"></div><div class="enh-gauge"><i></i></div></div><div class="enh-skip">탭하여 건너뛰기</div>';
  const src = art?.querySelector('img');
  const weapon = stage.querySelector('.enh-weapon'), anvil = stage.querySelector('.enh-anvil');
  if (src) { const img = document.createElement('img'); img.src = src.currentSrc || src.src; img.alt = ''; weapon.appendChild(img); }
  host.appendChild(stage);
  art?.classList.remove('enh-flash', 'enh-fail');
  const timers = [];
  const at = (sec, fn) => timers.push(setTimeout(fn, sec * 1000));
  // 망치질: 박자마다 금속음, 뒤로 갈수록 높고 세게. 심장 저음은 처음과 중간에 한 번씩.
  beats.forEach((t, i) => at(t, () => {
    const p = beats.length > 1 ? i / (beats.length - 1) : 1;
    audio.clang({ vol: 0.18 + 0.22 * p, freq: 1500 + 1300 * p, dur: 0.12 });
    weapon.classList.remove('beat'); void weapon.offsetWidth; weapon.classList.add('beat');
  }));
  if (!reduced) { audio.thump({ vol: 0.35, freq: 55, dur: 0.22 }); at(tension * 0.55, () => audio.thump({ vol: 0.45, freq: 62, dur: 0.22 })); }
  audio.duck?.(0.35, tension + 0.6, { attack: 0.08 });

  return new Promise((resolve) => {
    let done = false, skipped = false;
    const finish = () => {
      if (done) return; done = true;
      for (const t of timers) clearTimeout(t);
      stage.removeEventListener('pointerdown', skip); host.removeEventListener('keydown', skipKey, true);
      reveal();
    };
    const skip = (event) => { event.preventDefault(); skipped = true; finish(); };
    const skipKey = (event) => { if (event.key === 'Escape') return; event.preventDefault(); event.stopPropagation(); skipped = true; finish(); };
    stage.addEventListener('pointerdown', skip); host.addEventListener('keydown', skipKey, true);
    at(tension, finish);

    function reveal() {
      weapon.classList.remove('beat');
      stage.classList.add('result', 'r-' + out.kind); if (out.milestone) stage.classList.add('milestone');
      const stamp = document.createElement('div');
      stamp.className = 'enh-stamp';
      stamp.textContent = out.kind === 'success' ? '+' + result.enh : out.kind === 'destroy' ? '파괴' : out.kind === 'down' ? '+' + result.enh : '실패';
      if (out.kind === 'down') { const arrow = document.createElement('small'); arrow.textContent = '▼'; stamp.appendChild(arrow); }
      anvil.appendChild(stamp);
      if (out.kind === 'success') {
        if (!reduced) for (let i = 0; i < (out.milestone ? 18 : 10); i++) {
          const s = document.createElement('i'); s.className = 'enh-spark';
          const a = (i / (out.milestone ? 18 : 10)) * Math.PI * 2 + Math.random() * 0.4, d = 60 + Math.random() * (out.milestone ? 90 : 50);
          s.style.setProperty('--dx', Math.cos(a) * d + 'px'); s.style.setProperty('--dy', Math.sin(a) * d + 'px');
          anvil.appendChild(s);
        }
        weapon.classList.add(out.milestone ? 'punch' : 'flash'); art?.classList.add('enh-flash');
        audio.levelUp({ vol: 0.45, base: 440 + result.enh * 18 });
        if (out.milestone) { audio.play('jingle_legend', { vol: 0.6 }); audio.voice('enh_success', { min: 1 }); audio.vibe([30, 30, 80]); }
        else { if (result.enh >= 8) audio.voice('enh_success', { min: 3 }); audio.vibe([20, 20, 50]); }
      } else if (out.kind === 'destroy') {
        weapon.classList.add('broken');
        audio.shatter({ vol: 0.75 }); audio.voice('enh_destroy'); audio.vibe([120, 60, 120]);
      } else {
        // 실패: 둔탁한 금속음 + 저음, 그리고 짧은 정적(더킹)으로 대비.
        weapon.classList.add('dull');
        audio.clang({ vol: 0.35, freq: 520, dur: 0.3 }); audio.fail({ vol: 0.5 }); audio.thump({ vol: 0.5, freq: 48, dur: 0.3 });
        audio.duck?.(0.15, 0.9, { attack: 0.02 }); audio.vibe(60);
        if (from >= 8) setTimeout(() => audio.voice('enh_fail', { min: 3 }), 350);
      }
      const hold = reduced ? 350 : out.milestone ? 1100 : 700;
      setTimeout(() => { stage.remove(); lastEnd = performance.now(); resolve({ skipped }); }, skipped ? Math.min(hold, 450) : hold);
    }
  });
}
