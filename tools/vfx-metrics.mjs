// VFX 점수표 공용 픽셀 지표(hero-vfx-scorecard·boss-telegraph-scorecard).
// bright = 휘도 ≥ 220 픽셀 비율, white = 세 채널 모두 ≥ 235(백화), changed = 기준 프레임 대비 바뀐 픽셀 비율,
// hue = 바뀐 픽셀 중 채도 ≥ .35 인 픽셀의 주 색상(30° 구간), sat = 바뀐 픽셀 평균 채도.
import sharp from 'sharp';

export async function metrics(png, basePng) {
  const a = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  const b = basePng ? await sharp(basePng).raw().toBuffer() : null;
  const { data, info } = a, ch = info.channels, n = info.width * info.height;
  let bright = 0, white = 0, changed = 0, satSum = 0; const hues = new Array(12).fill(0);
  for (let i = 0, p = 0; p < n; p++, i += ch) {
    const r = data[i], g = data[i + 1], bl = data[i + 2];
    const luma = .2126 * r + .7152 * g + .0722 * bl;
    if (luma >= 220) bright++;
    if (r >= 235 && g >= 235 && bl >= 235) white++;
    if (b && Math.abs(r - b[i]) + Math.abs(g - b[i + 1]) + Math.abs(bl - b[i + 2]) > 60) {
      changed++;
      const mx = Math.max(r, g, bl), mn = Math.min(r, g, bl), s = mx ? (mx - mn) / mx : 0; satSum += s;
      if (s >= .35 && mx > 60) {
        let h; const d = mx - mn;
        if (mx === r) h = ((g - bl) / d) % 6; else if (mx === g) h = (bl - r) / d + 2; else h = (r - g) / d + 4;
        hues[Math.floor((((h * 60) + 360) % 360) / 30)]++;
      }
    }
  }
  const top = hues.map((v, i) => [i * 30, v]).sort((x, y) => y[1] - x[1]).slice(0, 2).filter(x => x[1] > 0).map(x => x[0]);
  const r4 = v => +(v / n).toFixed(4);
  return { bright: r4(bright), white: r4(white), changed: r4(changed), sat: changed ? +(satSum / changed).toFixed(3) : 0, hue: top };
}
