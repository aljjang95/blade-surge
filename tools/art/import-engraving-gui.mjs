/** Mechanical extraction of the owner's ten ChatGPT GUI collage sheets. No generation calls. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
const root=fileURLToPath(new URL('../../',import.meta.url));
const source=path.join(root,'art/engraving-gui');
const output=process.argv[2];
if(!output || !path.isAbsolute(output)) throw Error('Pass the absolute deliverable output directory.');
const sources=JSON.parse(await fs.readFile(path.join(source,'sources.json'),'utf8'));
const catalogue=JSON.parse(await fs.readFile(path.join(source,'catalogue.json'),'utf8'));
const target=path.join(root,'public/img/ui-crafted/engraving');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const names={ember:'잿불',tide:'물결',storm:'폭풍',stone:'바위',art:'전투 기예',frost:'서리',grove:'숲',astral:'별빛',shadow:'그림자',dawn:'여명'};
for(const dir of [target,output,...['original-sheets','icons-png','icons-webp','proof'].map(d=>path.join(output,d))]) await fs.mkdir(dir,{recursive:true});
const manifest={schemaVersion:2,provenance:'ChatGPT Web GUI image creation; one prompt in one authenticated Chrome tab. Ten user-requested 3x4 collages, mechanically extracted into 120 icon derivatives.',batchRequestCount:1,repairBatchRequestCount:0,browserTabsUsed:1,chatSessionsUsed:1,requestedSheets:10,jobsReturned:10,jobsSaved:10,uniqueContentAssets:10,contactSheets:10,independentSingleAssets:0,derivativeCount:120,runtimeCount:15,reserveCount:105,processing:'Native crop PNG; 320x320 WebP, contain and dark padding, no enlargement. Original sheets unchanged.',originals:catalogue.originals,sheets:[],assets:[]};
for(const sheet of sources){
 const input=path.join(source,sheet.file),bytes=await fs.readFile(input);
 if(hash(bytes)!==sheet.sha256) throw Error('Source checksum mismatch: '+sheet.family);
 await fs.copyFile(input,path.join(output,sheet.file));
 const xs=[0,...sheet.borders.x.map(a=>a[0].pos),sheet.width],ys=[0,...sheet.borders.y.map(a=>a[0].pos),sheet.height];
 manifest.sheets.push({...sheet,borders:undefined,columns:3,rows:4,gridBoundaries:{x:xs,y:ys}});
 const items=catalogue.assets.filter(a=>a.family===sheet.family);
 if(items.length!==12)throw Error('Expected twelve catalogue entries per sheet.');
 for(const [i,item] of items.entries()){
  const row=Math.floor(i/3),col=i%3;
  const left=xs[col]+8,top=ys[row]+8,width=xs[col+1]-left-8,height=ys[row+1]-top-8;
  const crop={left,top,width,height};
  const png=await sharp(input).extract(crop).png().toBuffer();
  const webp=await sharp(png).resize(320,320,{fit:'contain',background:'#080b11',withoutEnlargement:true}).webp({quality:93,effort:6}).toBuffer();
  const assetPath=`/img/ui-crafted/engraving/${item.id}.webp`;
  await fs.writeFile(path.join(target,item.id+'.webp'),webp);
  await fs.writeFile(path.join(output,'icons-webp',item.id+'.webp'),webp);
  await fs.writeFile(path.join(output,'icons-png',item.id+'.png'),png);
  manifest.assets.push({id:item.id,name:item.name,family:item.family,role:item.role,path:assetPath,width:320,height:320,bytes:webp.length,sha256:hash(webp),classification:'crop-derivative',sourceSheet:sheet.file,sourceSha256:sheet.sha256,sourceCell:i+1,sourceCrop:crop,pngPath:`icons-png/${item.id}.png`,pngWidth:width,pngHeight:height,pngBytes:png.length,pngSha256:hash(png)});
 }
}
if(manifest.assets.length!==120 || new Set(manifest.assets.map(a=>a.sha256)).size!==120)throw Error('Icon count/hash mismatch.');
manifest.status='verified-for-user-requested-collage-contract';
for(const dest of [path.join(target,'manifest.json'),path.join(output,'manifest.json')]) await fs.writeFile(dest,JSON.stringify(manifest,null,2)+'\n');
const registry=Object.fromEntries(manifest.assets.filter(a=>a.role==='runtime').map(a=>[a.family==='art'?a.id.replace('art_','art-'):'boon-'+a.id,a.path]));
await fs.writeFile(path.join(root,'src/data/engraving-art.js'),'// GUI-generated collage derivatives. Source hashes and cell coordinates: art/engraving-gui.\nexport const ENGRAVING_ART = Object.freeze('+JSON.stringify(registry,null,2)+');\n');
// Preview compositions are labelled derivatives; neither is a GUI generation original.
for(const [file,items,cols,size] of [['preview-120.jpg',manifest.assets,12,128],['preview-runtime-15.jpg',manifest.assets.filter(a=>a.role==='runtime'),3,240]]){
 const gap=8,rows=Math.ceil(items.length/cols),layers=[];
 for(const [i,item] of items.entries())layers.push({input:await sharp(path.join(target,item.id+'.webp')).resize(size,size).toBuffer(),left:(i%cols)*(size+gap),top:Math.floor(i/cols)*(size+gap)});
 await sharp({create:{width:cols*size+(cols-1)*gap,height:rows*size+(rows-1)*gap,channels:3,background:'#10141e'}}).composite(layers).jpeg({quality:95}).toFile(path.join(output,file));
}
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cards=manifest.assets.map(a=>`<figure data-family="${a.family}" data-role="${a.role}"><a href="${a.pngPath}"><img loading="lazy" src="icons-webp/${a.id}.webp" alt="${esc(a.name)}" width="320" height="320"></a><figcaption><b>${esc(a.name)}</b><small>${a.id}</small><span>${a.role==='runtime'?'게임 연결':'예비 이미지'}</span></figcaption></figure>`).join('');
await fs.writeFile(path.join(output,'artbook.html'),`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BLADE SURGE · GUI 각인 이미지 120개</title><style>*{box-sizing:border-box}body{margin:0;background:#090d15;color:#e9e7e0;font:16px/1.6 system-ui,sans-serif}main{max-width:1320px;margin:auto;padding:44px 24px}h1{font-size:clamp(28px,4vw,48px);line-height:1.2;margin:8px 0 20px}header{border-bottom:1px solid #343c4c;padding-bottom:28px}p{color:#bac2d1;max-width:850px}a{color:#ecc881}nav{display:flex;gap:8px;flex-wrap:wrap;margin:24px 0}button,select{background:#1b2434;border:1px solid #43516b;border-radius:6px;padding:10px;color:inherit;font:inherit;cursor:pointer}button[aria-pressed=true]{background:#e7c078;color:#10141e}#grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(165px,1fr));gap:18px}figure{margin:0;border:1px solid #283449;background:#101725;border-radius:10px;overflow:hidden}figure[hidden]{display:none}img{width:100%;height:auto;display:block}figcaption{padding:12px}b,small,span{display:block}small{font-size:11px;color:#8999b5}span{font-size:11px;color:#d8b878}details{margin:20px 0}ul{display:flex;flex-wrap:wrap;gap:16px;list-style:none;padding:0}.eyebrow{letter-spacing:.18em;color:#dabb7c}</style><main><header><div class="eyebrow">BLADE SURGE / GUI ART COLLECTION</div><h1>각인과 기예 · 120개</h1><p>ChatGPT 웹의 이미지 만들기에서 생성한 12칸 콜라주 10장입니다. 원본을 보존하고 각 칸을 PNG와 WebP로 분리했습니다. 현재 게임의 각인 12종과 기예 3종에 연결했고, 나머지 105개는 예비 이미지입니다.</p><a href="manifest.json">원본·분리 좌표·파일 해시</a> · <a href="preview-120.jpg">120개 전체 이미지</a><details><summary>1086 × 1448 PNG 원본 10장</summary><ul>${manifest.sheets.map(s=>`<li><a href="${s.file}">${names[s.family]}</a></li>`).join('')}</ul></details></header><nav><button data-filter="all" aria-pressed="true">전체 120개</button><button data-filter="runtime" aria-pressed="false">게임 연결 15개</button><button data-filter="reserve" aria-pressed="false">예비 105개</button><select aria-label="속성"><option value="all">모든 속성</option>${sources.map(s=>`<option value="${s.family}">${names[s.family]}</option>`).join('')}</select></nav><p id="count" aria-live="polite">120개 표시</p><section id="grid">${cards}</section></main><script>let filter='all';const apply=()=>{let n=0;document.querySelectorAll('figure').forEach(c=>{c.hidden=(filter!=='all'&&c.dataset.role!==filter)||(document.querySelector('select').value!=='all'&&c.dataset.family!==document.querySelector('select').value);if(!c.hidden)n++;});document.querySelector('#count').textContent=n+'개 표시'};document.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{filter=b.dataset.filter;document.querySelectorAll('[data-filter]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));apply()});document.querySelector('select').onchange=apply;</script></html>`);
await fs.writeFile(path.join(output,'README.md'),'# BLADE SURGE GUI 이미지 120개\n\nChatGPT 웹 GUI에서 한 채팅·한 탭·한 배치 요청으로 생성했습니다. 보수 요청은 0회입니다.\n\n- original-sheets: 요청한 3열 × 4행 콜라주 원본 10장 (각 1086 × 1448 PNG).\n- icons-png: 원본에서 추출한 120개 네이티브 크기 PNG.\n- icons-webp: 게임용 320 × 320 WebP 120개. 비율 보존과 어두운 여백 적용.\n- artbook.html: 전체 및 게임 연결 15개/예비 105개 열람.\n- manifest.json: 원본·파생 파일 SHA-256과 추출 좌표.\n\n120개는 10개 GUI 원본 시트에서 추출한 파생 아이콘입니다. 120개 독립 생성 원본이나 신규 게임 효과 120종을 의미하지 않습니다. 기존 게임 각인 12종과 기예 3종에만 연결했습니다.\n');
console.log(JSON.stringify({sheets:manifest.sheets.length,icons:manifest.assets.length,runtime:15,reserve:105,output}));
