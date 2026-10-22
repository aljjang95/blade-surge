# 자주 울리는 한 벌짜리 공용 효과(쿵·팅·충전·적 공격 예고)의 라운드로빈 파생 변형을 만든다.
# 원본은 배송된 Mirelo 샘플(public/sfx/mirelo-v1/fx/<family>_0.mp3)이고, 피치·저역/고역 기울기·꼬리 단축만 바꾼다.
# 같은 소리가 40초 전투에 38번(쿵) 그대로 반복되던 것(2026-10-22 실녹음 capture-log)을 2~3벌로 나눠 기계음 반복감을 줄인다.
# 실행: python3 tools/audio/fx-variants.py  → public/sfx/derived-v1/fx/*.mp3 + manifest.json (결정적: 같은 입력이면 같은 출력)
# 진짜 Mirelo 변형(새 생성)은 docs/audio/mirelo-variant-brief-h2.md 의 PC 단계다. 받으면 이 파생본을 대체한다.
import hashlib, json, os, subprocess
import numpy as np
from scipy import signal

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SRC = os.path.join(ROOT, 'public', 'sfx', 'mirelo-v1', 'fx')
DST = os.path.join(ROOT, 'public', 'sfx', 'derived-v1', 'fx')
BASE_MANIFEST = os.path.join(ROOT, 'public', 'sfx', 'mirelo-v1', 'manifest.json')
SR = 44100
# family: [(변형 번호, 피치 배율, 저역 dB(<180Hz), 고역 dB(>2.5kHz), 꼬리 배율)] — 번호는 원본 Mirelo 변형 수 다음부터.
SPECS = {
    'thump': [(1, 0.87, 3.0, -4.0, 1.0), (2, 1.13, -1.5, 2.5, 0.6)],
    'ting': [(1, 1.19, 0.0, 1.0, 0.8), (2, 0.89, 0.0, -3.0, 1.0)],
    'charge': [(1, 0.94, 2.0, -1.5, 1.0)],
    'tele_melee': [(1, 1.07, -1.0, 2.0, 0.85)],
    'tele_magic': [(1, 0.93, 1.5, -2.0, 1.0)],
}


def read(path):
    out = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-ac', '1', '-ar', str(SR), '-f', 'f32le', '-'], capture_output=True, check=True).stdout
    return np.frombuffer(out, dtype=np.float32).astype(np.float64)


def tilt(x, low_db, high_db):
    """저역·고역 선반: 원 신호에 저역통과·고역통과 성분을 (이득-1)만큼 더한다(위상 0, filtfilt)."""
    y = x.copy()
    if low_db:
        b, a = signal.butter(2, 180 / (SR / 2), 'low'); y += (10 ** (low_db / 20) - 1) * signal.filtfilt(b, a, x)
    if high_db:
        b, a = signal.butter(2, 2500 / (SR / 2), 'high'); y += (10 ** (high_db / 20) - 1) * signal.filtfilt(b, a, x)
    return y


def variant(x, pitch, low_db, high_db, tail):
    # 피치: 재생 속도처럼 길이도 함께 바뀐다(실제 큰/작은 물체의 차이). 런타임 ±5% 흔들림과 겹쳐도 범위가 나뉜다.
    n = max(16, int(round(len(x) / pitch)))
    y = signal.resample(x, n)
    y = tilt(y, low_db, high_db)
    if tail < 1.0:
        # 정점 40ms 뒤부터 감쇠를 tail 배로 바꾼다(짧은 꼬리 = 더 건조한 타격).
        peak = int(np.argmax(np.abs(y))) + int(0.04 * SR)
        t = np.arange(len(y) - peak) / SR
        if len(t):
            y[peak:] *= np.exp(-t * (1 / tail - 1) * 6)
    # 앞 무음 제거(첫 소리 2ms 안), 끝 페이드, 피크 -1dBFS(기존 라이브러리 처리와 같다)
    p0 = np.max(np.abs(y)) or 1e-9
    start = max(0, int(np.argmax(np.abs(y) > p0 * 0.06)) - int(0.001 * SR))
    y = y[start:]
    loud = np.where(np.abs(y) > p0 * 0.0056)[0]
    end = (loud[-1] + int(0.05 * SR)) if len(loud) else len(y)
    y = y[:max(end, int(0.12 * SR))]
    fade = min(len(y) // 4, int(max(0.03, 0.12 * len(y) / SR) * SR))
    if fade > 0: y[-fade:] *= np.linspace(1, 0, fade) ** 1.5
    ramp = int(0.0015 * SR); y[:ramp] *= np.linspace(0, 1, ramp)
    return y


def body_db(x):
    """타격 몸통 세기: 가장 센 150ms 창의 RMS(dBFS). 짧은 효과음은 LUFS(400ms 창)가 측정되지 않아 이것으로 맞춘다."""
    w = int(0.15 * SR); e = np.convolve(x ** 2, np.ones(w) / w, 'valid') if len(x) > w else np.array([np.mean(x ** 2)])
    return float(10 * np.log10(np.max(e) + 1e-12))


def match(y, ref_db):
    """몸통 세기를 원본에 맞추고(라운드로빈 사이 음량 튐 방지), 정점은 -1dBFS(0.89)를 넘지 않게 한다."""
    y = y * 10 ** ((ref_db - body_db(y)) / 20)
    peak = np.max(np.abs(y))
    return y * (0.89 / peak) if peak > 0.89 else y


def log_spectral_distance(a, b):
    """두 소리의 평균 스펙트럼(로그) 차이 dB. 런타임 ±5% 피치 흔들림만으로 생기는 차이와 비교하는 데 쓴다."""
    def spec(x):
        f, p = signal.welch(x, SR, nperseg=2048)
        bands = np.geomspace(60, 16000, 25)
        return np.array([10 * np.log10(np.mean(p[(f >= lo) & (f < hi)]) + 1e-12) for lo, hi in zip(bands[:-1], bands[1:])])
    sa, sb = spec(a), spec(b)
    sa -= sa.max(); sb -= sb.max()
    return float(np.sqrt(np.mean((sa - sb) ** 2)))


def main():
    os.makedirs(DST, exist_ok=True)
    base = {a['id']: a for a in json.load(open(BASE_MANIFEST))['assets']}
    items = []
    for family, specs in SPECS.items():
        src_path = os.path.join(SRC, family + '_0.mp3')
        src_bytes = open(src_path, 'rb').read(); x = read(src_path)
        jitter = log_spectral_distance(x, signal.resample(x, int(len(x) / 1.05)))
        for idx, pitch, low_db, high_db, tail in specs:
            y = match(variant(x, pitch, low_db, high_db, tail), body_db(x))
            out = os.path.join(DST, f'{family}_{idx}.mp3')
            subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(SR), '-ac', '1', '-i', '-', '-c:a', 'libmp3lame', '-b:a', '96k',
                            '-map_metadata', '-1', '-fflags', '+bitexact', '-flags:a', '+bitexact', out], input=y.astype(np.float32).tobytes(), check=True)
            d = read(out); data = open(out, 'rb').read()
            items.append({'id': f'fx/{family}_{idx}', 'path': f'/sfx/derived-v1/fx/{family}_{idx}.mp3', 'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data),
                          'durationSec': round(len(d) / SR, 4), 'decodedPeak': round(float(np.max(np.abs(d))), 4), 'decodedRms': round(float(np.sqrt(np.mean(d ** 2))), 4),
                          'onsetMs': round(int(np.argmax(np.abs(d) > 0.02)) / SR * 1000, 2),
                          'derivedFrom': {'path': f'/sfx/mirelo-v1/fx/{family}_0.mp3', 'sha256': hashlib.sha256(src_bytes).hexdigest(), 'taskUUID': base[f'fx/{family}_0']['taskUUID']},
                          'process': {'pitch': pitch, 'lowShelfDb': low_db, 'highShelfDb': high_db, 'tail': tail},
                          'bodyDb': round(body_db(d), 2), 'sourceBodyDb': round(body_db(x), 2),
                          'spectralDistanceDb': round(log_spectral_distance(x, d), 2), 'runtimeJitterDistanceDb': round(jitter, 2)})
            print(items[-1]['id'], items[-1]['durationSec'], items[-1]['spectralDistanceDb'], 'vs jitter', items[-1]['runtimeJitterDistanceDb'])
    manifest = {'library': 'derived-v1', 'generator': 'tools/audio/fx-variants.py (Mirelo 원본의 피치·EQ·꼬리 파생, 새 생성 아님)',
                'license': 'owner-generated (derived from mirelo-v1 Runware/Mirelo API output)', 'sampleRate': SR, 'channels': 1, 'codec': 'mp3 96k',
                'createdAt': '2026-10-22', 'humanListening': 'pending', 'replaceWhen': 'docs/audio/mirelo-variant-brief-h2.md 의 Mirelo 변형이 도착하면', 'assets': items}
    json.dump(manifest, open(os.path.join(DST, '..', 'manifest.json'), 'w', encoding='utf8'), ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
