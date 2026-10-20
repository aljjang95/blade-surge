# Mirelo 원본 WAV → 게임용 MP3(앞 무음 제거, 길이 맞춤, 페이드, -1dBFS 피크 정규화, 모노 96k) + manifest.
# python tools/audio/mirelo-postprocess.py <원본 폴더> public/sfx/mirelo-v1
import json, os, sys, wave, subprocess, hashlib, struct
import numpy as np
SRC = sys.argv[1]; DST = sys.argv[2]
FF = 'ffmpeg'
def read(path):
    out = subprocess.run([FF,'-v','error','-i',path,'-ac','1','-ar','44100','-f','f32le','-'],capture_output=True,check=True).stdout
    return np.frombuffer(out, dtype=np.float32).copy()
items = []
for root, _, files in os.walk(SRC):
    for f in files:
        if not f.endswith('.wav'): continue
        p = os.path.join(root, f); rid = os.path.relpath(p, SRC).replace(os.sep,'/')[:-4]
        rec = json.load(open(p[:-4]+'.receipt.json', encoding='utf8'))
        x = read(p); sr = 44100
        peak0 = float(np.max(np.abs(x))) or 1e-9
        thr = peak0 * 0.06  # 앞 무음: 최대치의 약 -24dB 아래는 잘라낸다
        idx = np.argmax(np.abs(x) > thr)
        start = max(0, idx - int(0.002*sr))
        target = float(rec.get('targetDurationSec') or rec.get('requestDurationSec') or 1.5)
        # 짧은 계열은 목표 길이에 꼬리 여유, 긴 계열은 실제 끝(최대치 -45dB 이하로 떨어진 뒤)까지
        env = np.abs(x[start:])
        tail_thr = peak0 * 0.0056
        loud = np.where(env > tail_thr)[0]
        natural_end = (loud[-1] + int(0.05*sr)) if len(loud) else len(env)
        end = min(natural_end, int((target + 0.25) * sr)) if target < 1.5 else natural_end
        y = x[start:start+max(end, int(0.12*sr))]
        fade = min(len(y)//4, int(max(0.03, 0.12*len(y)/sr)*sr))
        if fade > 0: y[-fade:] *= np.linspace(1,0,fade)**1.5
        y[:int(0.0015*sr)] *= np.linspace(0,1,int(0.0015*sr))
        y = y / (np.max(np.abs(y)) or 1) * 0.89
        out = os.path.join(DST, rid + '.mp3'); os.makedirs(os.path.dirname(out), exist_ok=True)
        subprocess.run([FF,'-v','error','-y','-f','f32le','-ar','44100','-ac','1','-i','-','-c:a','libmp3lame','-b:a','96k',out],input=y.astype(np.float32).tobytes(),check=True)
        d = read(out)
        data = open(out,'rb').read()
        onset = int(np.argmax(np.abs(d) > 0.02)) / sr * 1000
        items.append({'id': rid, 'path': '/sfx/mirelo-v1/' + rid + '.mp3', 'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data), 'durationSec': round(len(d)/sr, 4), 'decodedPeak': round(float(np.max(np.abs(d))),4), 'decodedRms': round(float(np.sqrt(np.mean(d**2))),4), 'onsetMs': round(onset,2), 'prompt': rec['prompt'], 'provider': 'runware', 'model': 'mirelo:1@1', 'modelName': 'Mirelo SFX 1.5', 'taskUUID': rec['taskUUID'], 'seed': rec.get('seed'), 'sourceSha256': rec['sha256'], 'costUsd': rec.get('costUsd')})
items.sort(key=lambda a: a['id'])
manifest = {'library': 'mirelo-v1', 'generator': 'Runware mirelo:1@1 (Mirelo SFX 1.5)', 'jobs': 'tools/audio/mirelo-sfx-jobs.mjs', 'process': 'tools/audio/mirelo-postprocess.py', 'license': 'owner-generated (Runware/Mirelo API output, commercial use per provider terms)', 'sampleRate': 44100, 'channels': 1, 'codec': 'mp3 96k', 'createdAt': '2026-10-19', 'totalCostUsd': round(sum(a['costUsd'] or 0 for a in items), 4), 'assets': items}
json.dump(manifest, open(os.path.join(DST,'manifest.json'),'w',encoding='utf8'), ensure_ascii=False, indent=1)
print(json.dumps({'n': len(items), 'bytes': sum(a['bytes'] for a in items), 'maxOnsetMs': max(a['onsetMs'] for a in items), 'minRms': min(a['decodedRms'] for a in items), 'cost': manifest['totalCostUsd']}))

