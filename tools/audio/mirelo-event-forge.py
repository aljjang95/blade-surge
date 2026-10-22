# 보스 스팅어·가챠 등급 공개·전리품 희귀도·보스 경고 효과음을 Mirelo SFX 1.5(Runware mirelo:1@1)로 만든다.
# 클라우드 세션: python3 tools/audio/mirelo-event-forge.py generate   (APEX 프록시 $APEX_CLOUD_URL/p/runware/v1, 키는 세션에 오지 않는다)
#               python3 tools/audio/mirelo-event-forge.py process    (work/audio/mirelo-event-raw → public/sfx/mirelo-v1/event + manifest)
# 원본 WAV·영수증은 work/audio/mirelo-event-raw/ 에 남는다(덮어쓰지 않는다). 후처리는 앞 무음 제거·끝 페이드·-1dBFS 피크(기존 라이브러리와 같다).
import hashlib, json, os, subprocess, sys, uuid
import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
RAW = os.path.join(ROOT, 'work', 'audio', 'mirelo-event-raw')
DST = os.path.join(ROOT, 'public', 'sfx', 'mirelo-v1', 'event')
S = ', fantasy action game sound effect, close-miked, punchy and clean, dry, no music, no voice, no speech'
JOBS = {
    # 보스 등장: 지역 최종 보스(X-10), 중간 보스·수문장(X-5, X-3, X-7). BGM 은 엔진이 잠깐 낮춘다.
    'stinger_finale': ('epic boss encounter stinger, colossal low cinematic braam impact with deep sub drop, war drum hit and long dark metallic ring tail', 3.5),
    'stinger_midboss': ('mid-boss encounter stinger, two heavy war drum hits with a dark rising swell and short metal clang', 2.5),
    # 보스의 큰 기술 예고(긴급): 짧은 경보성 저역 펄스. 기존 tele_* 위에 얹는다.
    'boss_warning': ('urgent danger warning before a giant boss attack, deep pulsing low horn blast with rising tension, ominous', 1.2),
    # 가챠: 충전 → 최고 등급 공개(R/SR/SSR) → 카드별 공개
    'gacha_charge': ('mystical summoning circle charging up, rising shimmering magical energy swell with soft rumble', 1.6),
    'gacha_reveal_r': ('card flip reveal, soft bright whoosh with a small sparkle', 0.8),
    'gacha_reveal_sr': ('rare card reveal, bright crystal chime burst with shimmering sparkle tail', 1.3),
    'gacha_reveal_ssr': ('legendary card reveal, powerful golden radiant burst with a deep boom and bright shimmering bell tail', 2.6),
    # 전리품 희귀도(드롭이 땅에 떨어질 때): 일반은 기존 ui_drop
    'loot_rare': ('rare item drop on the ground, short bright magical chime with soft thud', 0.8),
    'loot_epic': ('epic item drop, sparkling ascending crystal chimes with a soft magical thud', 1.2),
    'loot_legend': ('legendary item drop, radiant golden beam slamming down with deep impact and shimmering bell tail', 2.2),
}
PROXY = os.environ.get('APEX_CLOUD_URL', '').rstrip('/') + '/p/runware/v1'

def curl(args, data=None):
    return subprocess.run(['curl', '-sS', '-f', '-m', '180'] + args, input=data, capture_output=True, check=True).stdout

def generate(only=None):
    os.makedirs(RAW, exist_ok=True)
    for jid, (prompt, dur) in JOBS.items():
        if only and jid not in only: continue
        wav = os.path.join(RAW, jid + '.wav')
        if os.path.exists(wav): print('skip', jid); continue
        task = str(uuid.uuid4())
        body = [{'taskType': 'audioInference', 'taskUUID': task, 'model': 'mirelo:1@1', 'positivePrompt': prompt + S, 'duration': max(1.0, dur),
                 'outputType': 'URL', 'outputFormat': 'WAV', 'includeCost': True, 'numberResults': 1}]
        res = json.loads(curl(['-X', 'POST', PROXY, '-H', 'Content-Type: application/json', '--data-binary', '@-'], json.dumps(body).encode()))
        item = res['data'][0]
        data = curl([item['audioURL']])
        open(wav, 'wb').write(data)
        receipt = {'id': jid, 'prompt': prompt + S, 'requestDurationSec': dur, 'taskUUID': task, 'seed': item.get('seed'), 'costUsd': item.get('cost'),
                   'model': 'mirelo:1@1', 'provider': 'runware (APEX cloud proxy)', 'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data)}
        json.dump(receipt, open(os.path.join(RAW, jid + '.receipt.json'), 'w'), ensure_ascii=False, indent=1)
        print('ok', jid, item.get('cost'))

def metrics(path):
    """객관 지표: 정점 dB, 정점 -12dB 도달 시각, 앞 40% 에너지 비중, 끝 25% 에너지 비중, 시작 뒤 가장 긴 무음(정점 -40dB 아래)."""
    x = read(path); w = 441; n = len(x) // w
    r = np.sqrt((x[:n * w].reshape(n, w) ** 2).mean(1)) + 1e-9; db = 20 * np.log10(r); e = r ** 2
    live = np.where(db > db.max() - 40)[0]
    return {'peakDb': round(float(20 * np.log10(np.abs(x).max() + 1e-9)), 1), 'onset': round(int(np.argmax(db > db.max() - 12)) * 0.01, 2),
            'front': round(float(e[:max(1, int(n * 0.4))].sum() / e.sum()), 2), 'tail': round(float(e[int(n * 0.75):].sum() / e.sum()), 2),
            'gap': round(float(np.max(np.diff(live)) - 1) * 0.01 if len(live) > 1 else 0, 2), 'dur': round(len(x) / 44100, 2),
            'crest': round(float(20 * np.log10(np.abs(x).max() + 1e-9) - 10 * np.log10(e.mean())), 1)}

def candidates(ids, count=3, dur_override=None):
    """같은 프롬프트로 여러 개를 만들고, 사건이 끝에 잘리지 않고(끝 25% 에너지 < 0.35) 중간 무음이 짧고(< 0.45초)
    정점이 충분한(> -12dB) 후보 중 크레스트(타격감)가 가장 큰 것을 고른다. 이전 원본은 rejected/ 로 옮긴다(삭제하지 않는다)."""
    cand_dir = os.path.join(RAW, 'cands'); os.makedirs(cand_dir, exist_ok=True); os.makedirs(os.path.join(RAW, 'rejected'), exist_ok=True)
    for jid in ids:
        prompt, dur = JOBS[jid]; dur = max(1.0, dur_override or dur + 1.5)
        rows = []
        for k in range(count):
            task = str(uuid.uuid4())
            body = [{'taskType': 'audioInference', 'taskUUID': task, 'model': 'mirelo:1@1', 'positivePrompt': prompt + S, 'duration': dur,
                     'outputType': 'URL', 'outputFormat': 'WAV', 'includeCost': True, 'numberResults': 1}]
            item = json.loads(curl(['-X', 'POST', PROXY, '-H', 'Content-Type: application/json', '--data-binary', '@-'], json.dumps(body).encode()))['data'][0]
            data = curl([item['audioURL']]); wav = os.path.join(cand_dir, f'{jid}__{task[:8]}.wav'); open(wav, 'wb').write(data)
            rec = {'id': jid, 'prompt': prompt + S, 'requestDurationSec': dur, 'taskUUID': task, 'seed': item.get('seed'), 'costUsd': item.get('cost'),
                   'model': 'mirelo:1@1', 'provider': 'runware (APEX cloud proxy)', 'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data)}
            json.dump(rec, open(wav[:-4] + '.receipt.json', 'w'), ensure_ascii=False, indent=1)
            m = metrics(wav); rows.append((wav, rec, m)); print(jid, k, m)
        ok = [r for r in rows if r[2]['tail'] < 0.35 and r[2]['gap'] < 0.45 and r[2]['peakDb'] > -12]
        if not ok: print('no acceptable candidate', jid); continue
        wav, rec, m = max(ok, key=lambda r: r[2]['crest'])
        cur = os.path.join(RAW, jid + '.wav')
        for ext in ('.wav', '.receipt.json'):
            if os.path.exists(cur[:-4] + ext): os.replace(cur[:-4] + ext, os.path.join(RAW, 'rejected', f'{jid}__first{ext}'))
        import shutil
        shutil.copyfile(wav, cur); rec = dict(rec, selection=m, candidates=[{'taskUUID': r[1]['taskUUID'], **r[2]} for r in rows])
        json.dump(rec, open(cur[:-4] + '.receipt.json', 'w'), ensure_ascii=False, indent=1)
        print('picked', jid, m)

def read(path, sr=44100):
    out = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-ac', '1', '-ar', str(sr), '-f', 'f32le', '-'], capture_output=True, check=True).stdout
    return np.frombuffer(out, dtype=np.float32).copy()

def process():
    os.makedirs(DST, exist_ok=True)
    items = []
    for jid in JOBS:
        src = os.path.join(RAW, jid + '.wav')
        if not os.path.exists(src): continue
        rec = json.load(open(os.path.join(RAW, jid + '.receipt.json')))
        x = read(src); sr = 44100
        peak0 = float(np.max(np.abs(x))) or 1e-9
        start = max(0, int(np.argmax(np.abs(x) > peak0 * 0.06)) - int(0.002 * sr))
        env = np.abs(x[start:]); loud = np.where(env > peak0 * 0.0056)[0]
        end = (loud[-1] + int(0.05 * sr)) if len(loud) else len(env)
        y = x[start:start + max(end, int(0.12 * sr))]
        fade = min(len(y) // 4, int(max(0.03, 0.12 * len(y) / sr) * sr))
        if fade > 0: y[-fade:] *= np.linspace(1, 0, fade) ** 1.5
        y[:int(0.0015 * sr)] *= np.linspace(0, 1, int(0.0015 * sr))
        y = y / (np.max(np.abs(y)) or 1) * 0.89
        out = os.path.join(DST, jid + '.mp3')
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', '44100', '-ac', '1', '-i', '-', '-c:a', 'libmp3lame', '-b:a', '96k', out], input=y.astype(np.float32).tobytes(), check=True)
        d = read(out); data = open(out, 'rb').read()
        items.append({'id': 'event/' + jid, 'path': '/sfx/mirelo-v1/event/' + jid + '.mp3', 'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data),
                      'durationSec': round(len(d) / sr, 4), 'decodedPeak': round(float(np.max(np.abs(d))), 4), 'decodedRms': round(float(np.sqrt(np.mean(d ** 2))), 4),
                      'onsetMs': round(int(np.argmax(np.abs(d) > 0.02)) / sr * 1000, 2), 'prompt': rec['prompt'], 'provider': 'runware', 'model': 'mirelo:1@1',
                      'modelName': 'Mirelo SFX 1.5', 'taskUUID': rec['taskUUID'], 'seed': rec.get('seed'), 'sourceSha256': rec['sha256'], 'costUsd': rec.get('costUsd')})
    manifest = {'library': 'mirelo-v1/event', 'generator': 'Runware mirelo:1@1 (Mirelo SFX 1.5)', 'jobs': 'tools/audio/mirelo-event-forge.py',
                'license': 'owner-generated (Runware/Mirelo API output, commercial use per provider terms)', 'sampleRate': 44100, 'channels': 1,
                'codec': 'mp3 96k', 'createdAt': '2026-10-22', 'humanListening': 'pending',
                'totalCostUsd': round(sum(a['costUsd'] or 0 for a in items), 4), 'assets': items}
    json.dump(manifest, open(os.path.join(DST, 'manifest.json'), 'w', encoding='utf8'), ensure_ascii=False, indent=1)
    print(json.dumps({'n': len(items), 'bytes': sum(a['bytes'] for a in items), 'cost': manifest['totalCostUsd']}))

if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else ''
    if cmd == 'generate': generate(sys.argv[2:] or None)
    elif cmd == 'process': process()
    elif cmd == 'candidates': candidates(sys.argv[2:])
    else: print('usage: generate [ids...] | candidates <ids...> | process'); sys.exit(2)
