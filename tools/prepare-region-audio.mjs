// Processes already-downloaded, original FlowMusic artifacts; performs no network requests.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const ids = ['lobby','garden','forge','frost','tide','crown','homecoming','arena','boss'];
const selected = process.argv.slice(2);
const targets = selected.length ? selected : ids;
if (targets.some(id => !ids.includes(id))) throw Error('Unknown region audio ID');
const sourceDir = 'work/media-20260913/audio/originals';
const reportDir = 'work/media-20260913/audio';
const outputDir = 'public/bgm/regions';
fs.mkdirSync(outputDir,{recursive:true});
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function run(exe,args) {
  const r=spawnSync(exe,args,{encoding:'utf8',windowsHide:true,maxBuffer:8*1024*1024});
  if(r.error||r.status!==0) throw Error(`${exe} failed: ${r.error||r.stderr}`);
  return r;
}
const probe = file => JSON.parse(run('ffprobe',['-v','error','-show_entries','format=duration,size:stream=codec_name,sample_rate,channels','-of','json',file]).stdout);
const loudness = output => {
  const matches=[...output.matchAll(/\{\s*"input_i"[\s\S]*?\}/g)];
  if(!matches.length) throw Error('Missing loudness measurement');
  return JSON.parse(matches.at(-1)[0]);
};
const report={createdAt:new Date().toISOString(),source:'FlowMusic GUI generation; observed public audio artifacts transferred through development tools',target:{integratedLufs:-18,truePeakDb:-1.5,loudnessRange:11},tracks:[],scope:'Full decode, duration, loudness and hashes. Musical loop seam and subjective listening are separate checks.'};
for(const id of targets) {
  const input=path.join(sourceDir,`${id}.m4a`),output=path.join(outputDir,`${id}.mp3`);
  const source=probe(input),duration=Number(source.format.duration);
  if(!Number.isFinite(duration)||duration<10||duration>300) throw Error(`Unexpected duration ${id}`);
  const analysis=run('ffmpeg',['-hide_banner','-i',input,'-af','loudnorm=I=-18:TP=-1.5:LRA=11:print_format=json','-f','null','-']);
  const measured=loudness(analysis.stderr);
  for(const key of ['input_i','input_tp','input_lra','input_thresh','target_offset']) if(!Number.isFinite(Number(measured[key]))) throw Error(`Invalid ${id} ${key}`);
  const filter=`loudnorm=I=-18:TP=-1.5:LRA=11:measured_I=${measured.input_i}:measured_TP=${measured.input_tp}:measured_LRA=${measured.input_lra}:measured_thresh=${measured.input_thresh}:offset=${measured.target_offset}:linear=true:print_format=json,afade=t=in:d=0.005,afade=t=out:st=${duration-0.005}:d=0.005`;
  run('ffmpeg',['-hide_banner','-y','-i',input,'-vn','-af',filter,'-ar','48000','-c:a','libmp3lame','-q:a','3','-map_metadata','-1',output]);
  const check=run('ffmpeg',['-hide_banner','-i',output,'-af','loudnorm=I=-18:TP=-1.5:LRA=11:print_format=json','-f','null','-']);
  const final=loudness(check.stderr),encoded=probe(output);
  if(Math.abs(Number(final.input_i)+18)>1 || Number(final.input_tp)>-0.5) throw Error(`Final mix outside limits ${id}: ${JSON.stringify(final)}`);
  const row={id,input,output,source:{...source,sha256:hash(input)},encoded:{...encoded,sha256:hash(output)},loudness:final,fullDecode:'pass',processing:'Two-pass loudness normalization, stereo 48kHz MP3 VBR q3, 5ms click-prevention edge fades; full composition retained.'};
  report.tracks.push(row);fs.writeFileSync(path.join(reportDir,`${id}.json`),JSON.stringify(row,null,2));
  console.log(`${id}: ${Number(encoded.format.duration).toFixed(1)}s / ${(Number(encoded.format.size)/1048576).toFixed(2)} MiB / ${final.input_i} LUFS / ${final.input_tp} dBTP`);
}
// Retain validated receipts from earlier batches without re-encoding their files.
report.tracks=ids.flatMap(id=>{
  const receipt=path.join(reportDir,`${id}.json`);
  if(!fs.existsSync(receipt)) return [];
  const row=JSON.parse(fs.readFileSync(receipt,'utf8'));
  if(row.id!==id||row.fullDecode!=='pass'||hash(row.input)!==row.source.sha256||hash(row.output)!==row.encoded.sha256) throw Error(`Stale audio receipt ${id}`);
  return [row];
});
report.status=report.tracks.length===ids.length?'verified-all-nine':'partial';
fs.writeFileSync(path.join(reportDir,'processing.json'),JSON.stringify(report,null,2));
