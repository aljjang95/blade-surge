# BGM 루프 지점·음량 보정 측정. 파일은 읽기만 한다(다시 인코딩하지 않는다).
# python3 tools/audio/bgm-loop-points.py public/bgm/regions/garden.mp3 ... > loop-points.json
# - loopStart: 앞 무음이 끝나고 음악이 실제로 시작되는 지점(본문 중앙 RMS 보다 18dB 낮은 선을 처음 넘는 곳)
# - loopEnd: 끝의 페이드·여운이 시작되기 전(본문보다 12dB 낮아지기 전 마지막 지점)을 마디 길이의 정수배로 맞춘 곳
#   (템포는 온셋 세기 자기상관으로 60~180BPM 에서 추정, 4/4 가정). 엔진은 loopEnd 전 crossfade 초 동안 새 재생을 겹친다.
# - trimDb: 통합 라우드니스를 기준(-18 LUFS, 지역곡 9곡의 마스터 값)에 맞추는 재생 이득
import json, subprocess, sys, re
import numpy as np

SR = 22050
REFERENCE_LUFS = -18.0
CROSSFADE = 2.5

def decode(path):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-ac', '1', '-ar', str(SR), '-f', 'f32le', '-'], capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32)

def lufs(path):
    err = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', path, '-af', 'ebur128=peak=true:framelog=quiet', '-f', 'null', '-'], capture_output=True, text=True).stderr
    i = float(re.search(r'I:\s+(-?[\d.]+) LUFS', err).group(1))
    tp = float(re.search(r'Peak:\s+(-?[\d.]+) dBFS', err).group(1))
    return i, tp

def tempo(x):
    hop = 512
    frames = len(x) // hop
    env = np.sqrt(np.add.reduceat(x[:frames * hop] ** 2, np.arange(0, frames * hop, hop)) / hop + 1e-12)
    onset = np.maximum(0, np.diff(np.log(env + 1e-6)))
    onset -= onset.mean()
    ac = np.correlate(onset, onset, mode='full')[len(onset) - 1:]
    fps = SR / hop
    lags = np.arange(len(ac)) / fps
    best, best_bpm = -1, 120.0
    for bpm in np.arange(60, 180.5, 0.5):
        lag = 60 / bpm * fps
        # 1·2·4 박 지연의 합으로 반박·두배 혼동을 줄인다.
        score = sum(ac[int(round(lag * k))] for k in (1, 2, 4) if int(round(lag * k)) < len(ac))
        if score > best: best, best_bpm = score, float(bpm)
    return best_bpm

def analyse(path):
    x = decode(path)
    win = int(SR * 0.05)
    n = len(x) // win
    rms = 20 * np.log10(np.sqrt((x[:n * win].reshape(n, win) ** 2).mean(axis=1)) + 1e-9)
    body = float(np.median(rms))
    loud_start = np.where(rms > body - 18)[0]
    loud_end = np.where(rms > body - 12)[0]
    start = loud_start[0] * 0.05 if len(loud_start) else 0.0
    natural_end = (loud_end[-1] + 1) * 0.05 if len(loud_end) else len(x) / SR
    bpm = tempo(x)
    bar = 4 * 60 / bpm
    bars = int((natural_end - start) // bar)
    end = start + bars * bar if bars >= 8 else natural_end
    i, tp = lufs(path)
    duration = len(x) / SR
    return {
        'file': path, 'durationSec': round(duration, 3), 'lufs': i, 'truePeakDb': tp, 'bodyRmsDb': round(body, 1),
        'bpm': bpm, 'bars': bars, 'loopStart': round(start, 3), 'loopEnd': round(min(end, duration), 3),
        'droppedTailSec': round(duration - end, 2), 'droppedHeadSec': round(start, 2),
        'trimDb': round(REFERENCE_LUFS - i, 1), 'crossfade': CROSSFADE,
    }

print(json.dumps([analyse(p) for p in sys.argv[1:]], indent=1))
