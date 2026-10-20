# Mirelo 배송 MP3 재정규화: 원본 WAV에서 mirelo-postprocess.py 와 같은 손질(앞 무음·길이·페이드)을 다시 하고,
# MP3 디코드 피크가 목표 구간(기본 0.82~0.85)에 들도록 이득을 반복 조정해 재인코딩한다. 새 생성·비용 없음.
# manifest 에서는 sha256·bytes·durationSec·decodedPeak·decodedRms·onsetMs 만 갱신하고 출처 필드는 그대로 둔다.
# python tools/audio/mirelo-renorm.py <원본 폴더> public/sfx/mirelo-v1 <id> [<id> ...]
import json, os, sys, subprocess, hashlib
import numpy as np
SRC, DST, IDS = sys.argv[1], sys.argv[2], sys.argv[3:]
LO, HI, TARGET = 0.82, 0.85, 0.835
FF = 'ffmpeg'; SR = 44100
UPDATED = ('sha256', 'bytes', 'durationSec', 'decodedPeak', 'decodedRms', 'onsetMs')
def read(path):
    out = subprocess.run([FF,'-v','error','-i',path,'-ac','1','-ar',str(SR),'-f','f32le','-'],capture_output=True,check=True).stdout
    return np.frombuffer(out, dtype=np.float32).copy()
def shape(x, rec):
    # mirelo-postprocess.py 와 같은 손질(정규화 직전까지).
    sr = SR; peak0 = float(np.max(np.abs(x))) or 1e-9
    idx = np.argmax(np.abs(x) > peak0 * 0.06); start = max(0, idx - int(0.002*sr))
    target = float(rec.get('targetDurationSec') or rec.get('requestDurationSec') or 1.5)
    env = np.abs(x[start:]); loud = np.where(env > peak0 * 0.0056)[0]
    natural_end = (loud[-1] + int(0.05*sr)) if len(loud) else len(env)
    end = min(natural_end, int((target + 0.25) * sr)) if target < 1.5 else natural_end
    y = x[start:start+max(end, int(0.12*sr))]
    fade = min(len(y)//4, int(max(0.03, 0.12*len(y)/sr)*sr))
    if fade > 0: y[-fade:] *= np.linspace(1,0,fade)**1.5
    y[:int(0.0015*sr)] *= np.linspace(0,1,int(0.0015*sr))
    return y / (np.max(np.abs(y)) or 1)
def encode(y, out):
    subprocess.run([FF,'-v','error','-y','-f','f32le','-ar',str(SR),'-ac','1','-i','-','-c:a','libmp3lame','-b:a','96k',out],input=y.astype(np.float32).tobytes(),check=True)
    return read(out)
mpath = os.path.join(DST, 'manifest.json')
raw = open(mpath, 'rb').read(); crlf = b'\r\n' in raw
manifest = json.loads(raw.decode('utf8'))
byid = {a['id']: a for a in manifest['assets']}
report = []
for rid in IDS:
    a = byid[rid]; wav = os.path.join(SRC, rid + '.wav')
    if hashlib.sha256(open(wav,'rb').read()).hexdigest() != a['sourceSha256']: sys.exit(f'{rid}: 원본 해시 불일치')
    rec = json.load(open(os.path.join(SRC, rid + '.receipt.json'), encoding='utf8'))
    y = shape(read(wav), rec); out = os.path.join(DST, rid + '.mp3')
    gain, before = TARGET, a['decodedPeak']
    for _ in range(8):
        d = encode(y * gain, out); peak = float(np.max(np.abs(d)))
        if LO <= peak <= HI: break
        gain *= TARGET / peak
    else: sys.exit(f'{rid}: 피크 {peak:.4f} 가 목표 구간에 들지 않음')
    data = open(out,'rb').read()
    a.update({'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data), 'durationSec': round(len(d)/SR, 4),
              'decodedPeak': round(peak, 4), 'decodedRms': round(float(np.sqrt(np.mean(d**2))), 4),
              'onsetMs': round(int(np.argmax(np.abs(d) > 0.02)) / SR * 1000, 2)})
    report.append({'id': rid, 'peakBefore': before, 'peakAfter': a['decodedPeak'], 'preGain': round(gain, 4)})
text = json.dumps(manifest, ensure_ascii=False, indent=1)
open(mpath, 'w', encoding='utf8', newline='\r\n' if crlf else '\n').write(text)
print(json.dumps(report, ensure_ascii=False))

