// 산출물 WebP 재인코딩. 원본 품질에서 눈에 띄는 손실이 없는 가장 낮은 품질을 이분 탐색으로 고른다.
// 합격선은 디코드한 원본 화소와의 비교다(알파가 있으면 알파 곱한 값 기준): 휘도 SSIM >= 0.985 이고 PSNR >= 36dB.
// 기준을 못 맞추거나 8% 이상 줄지 않으면 원본을 그대로 둔다. 해상도는 바꾸지 않는다.
import sharp from 'sharp';

/** 변환 규칙·합격선을 바꾸면 올려서 캐시를 무효화한다. */
export const WEBP_OPTIMIZER_VERSION = 'image-ssim-v3';
/** 합격선 세 단계. 캐릭터·적·장비를 그린 이미지는 STRICT, 배경·UI 는 RELAXED, 법선·거칠기처럼 값이 의미인 텍스처는 DATA. */
export const TARGETS = Object.freeze({ strict: { ssim: 0.985, psnr: 36 }, relaxed: { ssim: 0.98, psnr: 35 }, data: { ssim: 0.99, psnr: 40 } });
const MIN_GAIN = 0.92;
const SEARCH = { lo: 50, hi: 92 };

/** 알파를 곱한 RGB(PSNR 용)와 그 휘도 평면(SSIM 용)을 만든다. 투명한 화소의 숨은 RGB 값은 비교에서 빠진다. */
async function decodePremultiplied(input) {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const pixels = info.width * info.height, rgb = new Uint8Array(pixels * 3), luma = new Float32Array(pixels);
  for (let i = 0, o = 0, p = 0; p < pixels; i += 4, o += 3, p++) {
    const alpha = data[i + 3] / 255, r = data[i] * alpha, g = data[i + 1] * alpha, b = data[i + 2] * alpha;
    rgb[o] = r; rgb[o + 1] = g; rgb[o + 2] = b;
    luma[p] = 0.299 * r + 0.587 * g + 0.114 * b;
  }
  return { rgb, luma, width: info.width, height: info.height };
}

function psnr(a, b) {
  let squared = 0;
  for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; squared += d * d; }
  const mse = squared / a.length;
  return mse === 0 ? 99 : 10 * Math.log10(255 * 255 / mse);
}

/** 8x8 비겹침 블록 평균 SSIM(휘도 평면). */
function ssim(a, b, width, height) {
  const c1 = 6.5025, c2 = 58.5225;
  let total = 0, blocks = 0;
  for (let y = 0; y + 8 <= height; y += 8) {
    for (let x = 0; x + 8 <= width; x += 8) {
      let ma = 0, mb = 0, saa = 0, sbb = 0, sab = 0;
      for (let j = 0; j < 8; j++) {
        const row = (y + j) * width + x;
        for (let i = 0; i < 8; i++) {
          const va = a[row + i], vb = b[row + i];
          ma += va; mb += vb; saa += va * va; sbb += vb * vb; sab += va * vb;
        }
      }
      ma /= 64; mb /= 64;
      const varA = saa / 64 - ma * ma, varB = sbb / 64 - mb * mb, cov = sab / 64 - ma * mb;
      total += ((2 * ma * mb + c1) * (2 * cov + c2)) / ((ma * ma + mb * mb + c1) * (varA + varB + c2));
      blocks++;
    }
  }
  return blocks ? total / blocks : 1;
}

/**
 * @param {Uint8Array} source 원본 WebP
 * @returns {Promise<{bytes: Uint8Array, meta: {quality: number, ssim: number, psnr: number}}|{skipped: string}>}
 */
export async function optimizeWebp(source, TARGET = TARGETS.strict) {
  const metadata = await sharp(source).metadata();
  const jpeg = metadata.format === 'jpeg';
  if ((metadata.format !== 'webp' && !jpeg) || (metadata.pages || 1) > 1) return { skipped: '정지 WebP/JPEG 가 아님' };
  const reference = await decodePremultiplied(source);
  const attempt = async (quality) => {
    const encoder = sharp(source);
    const bytes = new Uint8Array(await (jpeg ? encoder.jpeg({ quality, mozjpeg: true }) : encoder.webp({ quality, effort: 5, smartSubsample: true, alphaQuality: 100 })).toBuffer());
    const decoded = await decodePremultiplied(bytes);
    if (decoded.width !== reference.width || decoded.height !== reference.height) return null;
    return { bytes, quality, ssim: ssim(reference.luma, decoded.luma, reference.width, reference.height), psnr: psnr(reference.rgb, decoded.rgb) };
  };
  const passes = (result) => result && result.ssim >= TARGET.ssim && result.psnr >= TARGET.psnr;
  // 합격하는 가장 낮은 품질을 이분 탐색한다. 한 번도 합격하지 못하면 상한(q90)을 마지막으로 확인한다.
  let lo = SEARCH.lo, hi = SEARCH.hi, best = null;
  while (hi - lo > 2) {
    const mid = (lo + hi) >> 1, result = await attempt(mid);
    if (passes(result)) { best = result; hi = mid; } else lo = mid;
  }
  if (!best) {
    const top = await attempt(SEARCH.hi);
    if (!passes(top)) return { skipped: `q${SEARCH.hi} 도 합격선 미달(SSIM ${top?.ssim.toFixed(4)}, PSNR ${top?.psnr.toFixed(1)})` };
    best = top;
  }
  if (best.bytes.length > source.length * MIN_GAIN) return { skipped: `이득 부족(${source.length} -> ${best.bytes.length})` };
  return { bytes: best.bytes, meta: { quality: best.quality, ssim: +best.ssim.toFixed(4), psnr: +best.psnr.toFixed(1) } };
}
