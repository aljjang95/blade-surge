// Google Play 그래픽 에셋 생성: 앱 아이콘(512x512)과 피처 그래픽(1024x500).
//  - icon-512.png     : 앱 런처 아이콘 원본(public/img/icon.png = android drawable-nodpi/bladesurge_icon.png)을
//                       32비트(RGBA, 알파 255) 512x512로 저장한다. 풀블리드 정사각형이며 마스크는 Play가 적용한다.
//  - feature-1024x500 : 실제 게임 전투 장면(tools/store-screenshots.mjs --sets=keyart 로 캡처한 HUD 없는 원본)에
//                       타이틀을 얹어 1024x500 24비트 PNG(알파 없음)로 저장한다.
// 사용법: node tools/store-graphics.mjs [--out=store/googleplay] [--raw=work/store-keyart/raw.png] [--only=icon|feature]
import { chromium } from 'playwright';
import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { launchOpts } from './chrome.mjs';

const root = path.resolve(import.meta.dirname, '..');
const arg = (name, fallback = '') => process.argv.find(v => v.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const out = path.resolve(root, arg('out', 'store/googleplay'));
const rawPath = path.resolve(root, arg('raw', 'work/store-keyart/raw.png'));
const only = arg('only');
await fs.mkdir(out, { recursive: true });

if (!only || only === 'icon') {
  const source = path.join(root, 'public/img/icon.png');
  const meta = await sharp(source).metadata();
  if (meta.width !== 512 || meta.height !== 512) throw Error(`아이콘 원본이 512x512가 아님: ${meta.width}x${meta.height}`);
  // 원본 픽셀을 그대로 쓰고 알파 채널만 추가한다(32비트). 재샘플·보정 없음.
  await sharp(source).ensureAlpha(1).png({ compressionLevel: 9 }).toFile(path.join(out, 'icon-512.png'));
  console.log('저장 icon-512.png');
}

if (!only || only === 'feature') {
  await fs.access(rawPath).catch(() => { throw Error(`키아트 원본이 없음: ${rawPath}. 먼저 node tools/store-screenshots.mjs --sets=keyart 를 실행하세요.`); });
  const tmp = path.join(root, 'work/store-keyart');
  await fs.mkdir(tmp, { recursive: true });
  const fontUrl = pathToFileURL(path.join(root, 'public/fonts/blade-sans-kr-700.woff2')).href;
  // 원본이 3072x1500이면 영웅이 오른쪽 약 60% 지점에 오도록 2048x1000으로 자른다(원본이 2048x1000이면 그대로).
  const rawMeta = await sharp(rawPath).metadata();
  const cropped = path.join(tmp, 'raw-crop.png');
  if (rawMeta.width === 3072 && rawMeta.height === 1500) await sharp(rawPath).extract({ left: Number(arg('crop-left', '90')), top: 250, width: 2048, height: 1000 }).png().toFile(cropped);
  else await fs.copyFile(rawPath, cropped);
  const rawUrl = pathToFileURL(cropped).href;
  // 장면은 오른쪽으로 두고, 왼쪽에 어두운 그라데이션을 깔아 타이틀 가독성을 만든다. 중요한 글자는 가운데 안전 영역(좌우 64px 안쪽)에 둔다.
  const html = `<!doctype html><meta charset="utf-8"><style>
@font-face{font-family:BladeSans;src:url(${fontUrl});font-weight:700}
*{box-sizing:border-box;margin:0}
html,body{width:1024px;height:500px;overflow:hidden;background:#0b0a12;font-family:BladeSans,sans-serif;font-weight:700}
.art{position:absolute;inset:0;background:url(${rawUrl}) center/cover no-repeat}
.scrim{position:absolute;inset:0;background:linear-gradient(90deg,rgba(8,7,16,.92) 0%,rgba(8,7,16,.78) 34%,rgba(8,7,16,.25) 58%,rgba(8,7,16,0) 72%),linear-gradient(0deg,rgba(8,7,16,.55) 0%,rgba(8,7,16,0) 30%)}
.copy{position:absolute;left:72px;top:0;bottom:0;width:480px;display:flex;flex-direction:column;justify-content:center}
.kicker{font-size:20px;letter-spacing:.14em;color:#ffd98a;text-shadow:0 2px 8px rgba(0,0,0,.8);margin-bottom:10px}
.title{font-size:94px;line-height:1.02;letter-spacing:-.02em;color:#fff;
  background:linear-gradient(180deg,#fffdf4 0%,#ffe9a6 46%,#f2a93b 100%);-webkit-background-clip:text;background-clip:text;color:transparent;
  filter:drop-shadow(0 4px 0 #6b3a06) drop-shadow(0 8px 14px rgba(0,0,0,.75))}
.latin{font-size:30px;letter-spacing:.42em;color:#fff6dc;text-shadow:0 3px 10px rgba(0,0,0,.85);margin-top:8px}
.tag{margin-top:22px;font-size:25px;color:#f1ecff;text-shadow:0 2px 8px rgba(0,0,0,.9)}
.tag b{color:#ffd98a}
</style>
<div class="art"></div><div class="scrim"></div>
<div class="copy">
  <div class="kicker">3D 핵앤슬래시 액션 RPG</div>
  <div class="title">블레이드<br>서지</div>
  <div class="latin">BLADE SURGE</div>
  <div class="tag">몰려오는 적을 <b>한 번에</b> 쓸어담는 다섯 영웅</div>
</div>`;
  const htmlPath = path.join(tmp, 'feature.html');
  await fs.writeFile(htmlPath, html);
  const browser = await chromium.launch(launchOpts());
  try {
    const page = await browser.newPage({ viewport: { width: 1024, height: 500 }, deviceScaleFactor: 2 });
    await page.goto(pathToFileURL(htmlPath).href);
    await page.evaluate(() => document.fonts.load('700 94px BladeSans', '블레이드 서지 BLADE SURGE 몰려오는'));
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(500);
    const big = await page.screenshot({ type: 'png' });
    // 2x로 그린 뒤 1024x500으로 줄여 글자 가장자리를 매끄럽게 한다. 알파는 제거한다(24비트).
    const info = await sharp(big).resize(1024, 500, { kernel: 'lanczos3' }).removeAlpha().png({ compressionLevel: 9 }).toFile(path.join(out, 'feature-1024x500.png'));
    if (info.width !== 1024 || info.height !== 500 || info.channels !== 3) throw Error(`피처 그래픽 규격 불일치: ${JSON.stringify(info)}`);
    console.log('저장 feature-1024x500.png');
  } finally { await browser.close(); }
}
