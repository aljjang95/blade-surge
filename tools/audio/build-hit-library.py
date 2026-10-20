"""타격(트랜지언트)·바디(저역)·처치·콤보 효과음 라이브러리 v2 를 만든다.

원본은 Kenney Impact Sounds / RPG Audio(CC0)이고, 아래 DSP 는 전부 이 스크립트의 자체 가공이다.
- 원본 zip 은 고정 SHA256 으로 검증한 뒤 필요한 ogg 만 읽는다. 유료 서비스·음성 모델은 호출하지 않는다.
- 결과: public/sfx/hit-v2/*.mp3 + manifest.json(파일별 SHA·크기·피크·RMS·온셋) + LICENSE.txt
- 재현: python3 tools/audio/build-hit-library.py [--cache DIR]
  (ffmpeg·numpy·scipy 필요. mp3 바이트는 ffmpeg/libmp3lame 버전에 따라 달라질 수 있어 manifest 는 만든 결과를 기준으로 한다.)
"""
import argparse
import hashlib
import json
import math
import subprocess
import tempfile
import urllib.request
import wave
import zipfile
from pathlib import Path

import numpy as np
from scipy import signal

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'public/sfx/hit-v2'
SR = 44100
BITRATE = '128k'
PEAK = 0.80  # 인코딩 오버슈트를 포함해도 0.98 미만을 유지한다.

SOURCES = {
    'impact': {
        'name': 'Kenney Impact Sounds 1.0',
        'page': 'https://kenney.nl/assets/impact-sounds',
        'url': 'https://kenney.nl/media/pages/assets/impact-sounds/87b4ddecda-1677589768/kenney_impact-sounds.zip',
        'sha256': '029d734af1582474edf3a694d1b0cebc97c1c152f2f39fa34d4c2bafc5de77f8',
    },
    'rpg': {
        'name': 'Kenney RPG Audio 1.0',
        'page': 'https://kenney.nl/assets/rpg-audio',
        'url': 'https://kenney.nl/media/pages/assets/rpg-audio/8e99002d76-1677590336/kenney_rpg-audio.zip',
        'sha256': '6dbeaf8544da958d8f2adcb4a4a4b76c1ade34a05f8ab9edccd327da7375f38b',
    },
}


# ---------- 입력 ----------
def fetch_sources(cache):
    """고정 SHA256 의 zip 을 받아 ogg 이름 → 바이트 사전을 만든다."""
    cache.mkdir(parents=True, exist_ok=True)
    files, licenses = {}, {}
    for key, src in SOURCES.items():
        target = cache / (key + '.zip')
        if not target.exists():
            urllib.request.urlretrieve(src['url'], target)
        digest = hashlib.sha256(target.read_bytes()).hexdigest()
        if digest != src['sha256']:
            raise RuntimeError(f'{key}: 원본 zip SHA256 불일치 {digest}')
        with zipfile.ZipFile(target) as archive:
            for info in archive.infolist():
                if info.filename.endswith('.ogg'):
                    files[Path(info.filename).stem] = (key, archive.read(info))
                elif Path(info.filename).name == 'License.txt':
                    licenses[key] = archive.read(info).decode('utf-8', 'replace').strip()
    return files, licenses


class Library:
    def __init__(self, files):
        self.files = files
        self.used = {}

    def get(self, name):
        key, data = self.files[name]
        with tempfile.NamedTemporaryFile(suffix='.ogg') as handle:
            handle.write(data)
            handle.flush()
            raw = subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-i', handle.name, '-f', 'f32le',
                                  '-ac', '1', '-ar', str(SR), 'pipe:1'], check=True, capture_output=True).stdout
        self.used[name] = {'pack': key, 'sha256': hashlib.sha256(data).hexdigest()}
        return trim_onset(np.frombuffer(raw, dtype=np.float32).astype(np.float64))


# ---------- DSP ----------
def trim_onset(x, threshold_db=-42):
    """앞쪽 무음을 잘라 온셋이 첫 샘플 근처에 오게 한다."""
    peak = np.abs(x).max()
    index = int(np.argmax(np.abs(x) > peak * 10 ** (threshold_db / 20)))
    return x[max(0, index - 4):]


def hp(x, cutoff, order=2):
    return signal.sosfilt(signal.butter(order, cutoff, 'highpass', fs=SR, output='sos'), x)


def lp(x, cutoff, order=2):
    return signal.sosfilt(signal.butter(order, cutoff, 'lowpass', fs=SR, output='sos'), x)


def bp(x, low, high, order=2):
    return signal.sosfilt(signal.butter(order, [low, high], 'bandpass', fs=SR, output='sos'), x)


def pitch(x, ratio):
    """재생 속도 변경(피치와 길이가 함께 바뀐다). ratio>1 이면 높고 짧아진다."""
    frac = 1000
    up, down = frac, int(round(frac * ratio))
    g = math.gcd(up, down)
    return signal.resample_poly(x, up // g, down // g)


def shape(x, length, tail=0.012, tau=None):
    """길이를 자르고 끝에 코사인 페이드를 건다. tau 가 있으면 지수 감쇠로 꼬리를 짧게 만든다."""
    n = int(length * SR)
    x = np.pad(x, (0, max(0, n - len(x))))[:n].copy()
    if tau:
        x *= np.exp(-np.arange(n) / SR / tau)
    t = max(1, int(tail * SR))
    x[-t:] *= 0.5 * (1 + np.cos(np.linspace(0, np.pi, t)))
    return x


def sub(f0, f1, dur, amp=1.0, tau=0.1, attack=0.002):
    """지수로 내려가는 사인 저역 펀치."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    freq = f0 * (f1 / f0) ** (t / dur)
    phase = 2 * np.pi * np.cumsum(freq) / SR
    env = (1 - np.exp(-t / attack)) * np.exp(-t / tau)
    return amp * np.sin(phase) * env


def tone(freq, dur, amp=1.0, tau=0.1, attack=0.001, ratio=1.0):
    """감쇠하는 사인 한 음(금속 링 보강용)."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    return amp * np.sin(2 * np.pi * freq * (1 + (ratio - 1) * t / dur) * t) * (1 - np.exp(-t / attack)) * np.exp(-t / tau)


def bell(freq, dur, amp=1.0, tau=0.25):
    """비조화 부분음을 섞은 종소리(자체 합성)."""
    out = np.zeros(int(dur * SR))
    for ratio, gain, decay in [(1, 1, 1), (2.01, .5, .7), (2.76, .38, .5), (4.07, .22, .35), (5.4, .12, .25)]:
        part = tone(freq * ratio, dur, gain, tau * decay)
        out += part
    return amp * out / np.abs(out).max()


def noise_burst(dur, low, high, tau, seed, amp=1.0):
    rng = np.random.default_rng(seed)
    x = bp(rng.uniform(-1, 1, int(dur * SR)), low, high)
    x *= np.exp(-np.arange(len(x)) / SR / tau)
    return amp * x / np.abs(x).max()


def riser(dur, f0, f1, amp, seed):
    """상승 필터 노이즈. 끝에서 가장 크다."""
    rng = np.random.default_rng(seed)
    n = int(dur * SR)
    out = np.zeros(n)
    steps = 24
    for i in range(steps):
        a, b = int(n * i / steps), int(n * (i + 1) / steps)
        center = f0 * (f1 / f0) ** (i / (steps - 1))
        out[a:b] = bp(rng.uniform(-1, 1, b - a), center * 0.7, min(center * 1.4, SR * .45))
    out *= np.linspace(0, 1, n) ** 2
    return amp * out / np.abs(out).max()


def drive(x, amount):
    return np.tanh(x * amount) / math.tanh(amount)


def mix(*parts):
    """(신호, 이득, 시작 초) 목록을 하나로 더한다."""
    length = max(int(offset * SR) + len(part) for part, _, offset in parts)
    out = np.zeros(length)
    for part, gain, offset in parts:
        start = int(offset * SR)
        out[start:start + len(part)] += part * gain
    return out


def unit(x):
    """다른 소스와 이득을 맞추기 쉽게 피크 1 로 정규화한다."""
    return x / max(1e-9, np.abs(x).max())


def finish(x, target=PEAK):
    x = x - x.mean()
    x = signal.sosfilt(signal.butter(1, 20, 'highpass', fs=SR, output='sos'), x)
    fade_in = int(0.0004 * SR)
    x[:fade_in] *= np.linspace(0, 1, fade_in)
    return x * target / np.abs(x).max()


# ---------- 레시피 ----------
def build_recipes(lib):
    g = lib.get
    r = {}

    # 트랜지언트: 저역은 바디 레이어가 맡으므로 고역 접촉음만 남긴다.
    for i in range(3):
        base = unit(hp(g(f'impactMetal_light_00{i}'), 900))
        edge = unit(hp(g('knifeSlice' if i != 1 else 'knifeSlice2'), 2500))[:int(.06 * SR)]
        r[f't_slash_{i}'] = finish(shape(mix((base, 1, 0), (edge, .35, .004)), .15, tau=.05))
    for i in range(2):
        wood = unit(hp(g(f'impactWood_light_00{i}'), 350))
        plate = unit(hp(g(f'impactPlate_light_00{i}'), 1200))
        r[f't_blunt_{i}'] = finish(shape(mix((wood, 1, 0), (plate, .45, 0)), .17, tau=.06))
    for i in range(2):
        glass = unit(hp(g(f'impactGlass_light_00{i}'), 1400))
        shimmer = mix((tone(2100 + 380 * i, .2, 1, .05), 1, 0), (tone(3150 + 520 * i, .2, .6, .035), 1, .006))
        r[f't_magic_{i}'] = finish(shape(mix((glass, 1, 0), (unit(shimmer), .38, .003)), .2, tau=.07))
    pierce = mix((unit(hp(g('impactTin_medium_000'), 1500)), 1, 0), (unit(hp(g('impactGeneric_light_001'), 2400)), .5, 0))
    r['t_pierce_0'] = finish(shape(pierce, .13, tau=.04))
    for i in range(2):
        metal = unit(hp(g(f'impactMetal_heavy_00{i}'), 550))
        plate = unit(hp(g(f'impactPlate_heavy_00{i}'), 1500))
        r[f't_heavy_{i}'] = finish(shape(mix((metal, 1, 0), (plate, .5, 0)), .24, tau=.08))
    counter = mix((unit(hp(g('impactPlate_heavy_002'), 900)), 1, 0), (unit(hp(g('impactGlass_medium_001'), 2000)), .6, 0),
                  (unit(bell(1480, .4, 1, .12)), .33, 0))
    r['t_counter_0'] = finish(shape(counter, .4, tau=.14))
    for i in range(2):
        metal = unit(hp(g(f'impactMetal_heavy_00{2 + i}'), 450))
        glass = unit(hp(g(f'impactGlass_heavy_00{i}'), 1300))
        mine = unit(hp(g(f'impactMining_00{i}'), 700))
        r[f't_finisher_{i}'] = finish(shape(mix((metal, 1, 0), (glass, .55, 0), (mine, .5, .002)), .32, tau=.11))
    boss = mix((unit(hp(g('impactBell_heavy_000'), 280)), .8, 0), (unit(hp(g('impactMetal_heavy_003'), 400)), 1, 0),
               (unit(hp(g('impactGlass_heavy_002'), 1200)), .5, 0))
    r['t_boss_0'] = finish(shape(boss, .55, tau=.2, tail=.05))
    crit = mix((unit(pitch(hp(g('impactBell_heavy_001'), 1200), 1.5)), 1, 0), (unit(bell(2350, .3, 1, .1)), .6, 0))
    r['t_crit_0'] = finish(shape(crit, .32, tau=.1))

    # 바디: 낮은 무게감. 샘플 저역 + 자체 합성 서브.
    for i in range(2):
        soft = unit(lp(g(f'impactSoft_medium_00{i}'), 1000))
        r[f'b_light_{i}'] = finish(shape(mix((soft, 1, 0), (sub(125 - 12 * i, 80, .12, .85, .035), 1, 0)), .15, tau=.06))
    for i in range(2):
        punch = unit(lp(g(f'impactPunch_medium_00{i}'), 1500))
        r[f'b_basic_{i}'] = finish(shape(mix((punch, 1, 0), (sub(100 - 8 * i, 62, .18, .9, .05), 1, 0)), .22, tau=.08))
    for i in range(2):
        punch = unit(lp(g(f'impactPunch_heavy_00{i}'), 1700))
        wood = unit(lp(g(f'impactWood_heavy_00{i}'), 600))
        body = mix((punch, 1, 0), (wood, .5, 0), (sub(78 - 6 * i, 42, .3, 1.0, .09), 1.1, 0))
        r[f'b_heavy_{i}'] = finish(shape(drive(body, 1.3), .36, tau=.13))
    for i in range(2):
        soft = unit(lp(pitch(g(f'impactSoft_heavy_00{i}'), .86), 700))
        r[f'b_magic_{i}'] = finish(shape(mix((soft, 1, 0), (sub(96, 58, .26, .95, .08), 1, 0)), .3, tau=.11))
    mine = unit(lp(g('impactMining_001'), 1600))
    r['b_counter_0'] = finish(shape(drive(mix((mine, 1, 0), (sub(85, 48, .26, 1.0, .08), 1, 0)), 1.2), .32, tau=.12))
    for i in range(2):
        punch = unit(lp(g(f'impactPunch_heavy_00{2 + i}'), 1500))
        soft = unit(lp(g(f'impactSoft_heavy_00{i}'), 500))
        body = mix((punch, 1, 0), (soft, .6, 0), (sub(62 - 4 * i, 34, .46, 1.0, .15), 1.25, 0))
        r[f'b_finisher_{i}'] = finish(shape(drive(body, 1.6), .55, tau=.2, tail=.04))
    bellow = unit(lp(pitch(g('impactBell_heavy_002'), .55), 600))
    punch = unit(lp(g('impactPunch_heavy_004'), 1300))
    boss_body = mix((bellow, .55, 0), (punch, .9, 0), (sub(54, 30, .7, 1.0, .24), 1.3, 0))
    r['b_boss_0'] = finish(shape(drive(boss_body, 1.7), .8, tau=.3, tail=.07))

    # 처치 확정음: 짧은 타격+깨짐+낮아지는 팝 → 일반 타격과 구분된다.
    for i in range(3):
        glass = unit(hp(pitch(g(f'impactGlass_medium_00{i}'), 1.0 + .06 * i), 700))
        pop = unit(lp(g(f'impactPunch_medium_00{2 + i}'), 1000))
        drop = tone(1050 - 90 * i, .16, 1, .05, ratio=.3)
        k = mix((glass, .8, 0), (pop, 1, 0), (sub(130, 70, .2, .95, .06), 1, 0), (drop, .28, .004))
        r[f'k_pop_{i}'] = finish(shape(k, .38, tau=.13))
    elite = mix((unit(hp(g('impactGlass_heavy_003'), 600)), .9, 0), (unit(lp(g('impactPunch_heavy_001'), 1400)), 1, 0),
                (sub(88, 44, .34, 1.1, .11), 1.1, 0), (tone(820, .24, 1, .08, ratio=.35), .3, .004))
    r['k_elite_0'] = finish(shape(drive(elite, 1.3), .58, tau=.2, tail=.04))
    boss_death = mix((unit(pitch(hp(g('impactBell_heavy_003'), 250), .7)), .75, 0), (unit(hp(g('impactMetal_heavy_004'), 350)), .9, 0),
                     (unit(hp(g('impactGlass_heavy_004'), 900)), .7, .02), (sub(60, 26, 1.0, 1.0, .33), 1.3, 0),
                     (noise_burst(.8, 300, 5000, .22, 11), .45, .01))
    r['k_boss_0'] = finish(shape(drive(boss_death, 1.5), 1.4, tau=.5, tail=.12))

    # 콤보 스팅어: 10/25/50. 음정이 단계마다 올라가고 길이와 저역이 커진다. 자체 합성+종소리.
    c10 = mix((bell(659.3, .5, 1, .16), .8, 0), (bell(987.8, .6, 1, .2), .8, .075), (riser(.14, 500, 4500, 1, 21), .35, 0),
              (sub(110, 70, .2, 1, .06), .8, .075))
    r['c_10'] = finish(shape(c10, .7, tau=.3, tail=.06))
    c25 = mix((bell(659.3, .55, 1, .17), .7, 0), (bell(830.6, .6, 1, .17), .7, .06), (bell(987.8, .7, 1, .2), .75, .12),
              (bell(1318.5, .85, 1, .26), .85, .18), (riser(.2, 400, 5200, 1, 22), .4, 0), (sub(96, 56, .32, 1, .1), 1, .18),
              (unit(hp(g('impactGlass_heavy_001'), 1400)), .4, .18))
    r['c_25'] = finish(shape(c25, 1.05, tau=.45, tail=.08))
    c50 = mix((bell(659.3, .7, 1, .25), .6, 0), (bell(987.8, .8, 1, .25), .6, .05), (bell(1318.5, .9, 1, .28), .65, .1),
              (bell(1661.2, 1.0, 1, .32), .7, .15), (bell(2637.0, 1.0, 1, .3), .5, .2), (riser(.24, 350, 6000, 1, 23), .45, 0),
              (unit(lp(g('impactPunch_heavy_003'), 1500)), 1, .2), (sub(70, 32, .75, 1.1, .25), 1.35, .2),
              (unit(hp(g('impactMetal_heavy_001'), 500)), .7, .2), (unit(hp(pitch(g('impactBell_heavy_004'), .8), 300)), .6, .2))
    r['c_50'] = finish(shape(drive(c50, 1.25), 1.7, tau=.6, tail=.14))
    return r


# 카테고리별 포화 세기. 휴대폰 스피커는 60Hz 아래를 거의 못 내므로, 서브의 고조파와 평균 에너지를 키워
# 작은 스피커에서도 '무게'가 들리게 한다(피크는 그대로, 꼬리와 몸통의 RMS 만 올린다).
LOUDNESS_DRIVE = {'t_': 1.5, 'b_': 2.6, 'k_': 2.2, 'c_': 1.6}


def maximize(name, x):
    drive = next((value for prefix, value in LOUDNESS_DRIVE.items() if name.startswith(prefix)), 1.0)
    y = np.tanh(drive * x / np.abs(x).max()) / math.tanh(drive)
    return finish(y)


# ---------- 출력 ----------
def measure(path):
    raw = subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-i', str(path), '-f', 'f32le', '-ac', '1',
                          '-ar', str(SR), 'pipe:1'], check=True, capture_output=True).stdout
    x = np.frombuffer(raw, dtype=np.float32).astype(np.float64)
    peak = np.abs(x).max()
    onset = int(np.argmax(np.abs(x) > peak * 0.1))
    spectrum = np.abs(np.fft.rfft(x))
    freqs = np.fft.rfftfreq(len(x), 1 / SR)
    return x, {
        'decodedSamples': int(len(x)), 'durationSec': round(len(x) / SR, 6), 'decodedPeak': round(float(peak), 6),
        'decodedRms': round(float(np.sqrt((x ** 2).mean())), 6), 'onsetMs': round(onset / SR * 1000, 3),
        'centroidHz': round(float((spectrum * freqs).sum() / spectrum.sum()), 1),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--cache', type=Path, default=None, help='원본 zip 캐시 폴더(기본: 임시 폴더)')
    args = parser.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='bladesurge-hit-v2-') as temporary:
        cache = args.cache or Path(temporary) / 'sources'
        files, licenses = fetch_sources(cache)
        lib = Library(files)
        recipes = build_recipes(lib)
        assets = []
        for name, samples in recipes.items():
            wav = Path(temporary) / (name + '.wav')
            samples = maximize(name, samples)
            pcm = (np.clip(samples, -1, 1) * 32767).astype('<i2')
            with wave.open(str(wav), 'wb') as output:
                output.setnchannels(1)
                output.setsampwidth(2)
                output.setframerate(SR)
                output.writeframes(pcm.tobytes())
            target = OUT / (name + '.mp3')
            subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(wav), '-map_metadata', '-1',
                            '-codec:a', 'libmp3lame', '-b:a', BITRATE, '-ac', '1', '-write_xing', '1', str(target)], check=True)
            _, stats = measure(target)
            if stats['decodedPeak'] >= 0.98 or stats['decodedRms'] <= 0.01 or stats['onsetMs'] > 3 and name.startswith(('t_', 'b_', 'k_')):
                raise RuntimeError(f'{name}: 파형 검증 실패 {stats}')
            data = target.read_bytes()
            assets.append({'id': name, 'path': f'/sfx/hit-v2/{name}.mp3', 'bytes': len(data),
                           'sha256': hashlib.sha256(data).hexdigest(), **stats})
        sources = [{'id': key, 'name': src['name'], 'page': src['page'], 'url': src['url'], 'zipSha256': src['sha256'],
                    'license': 'CC0-1.0', 'licenseUrl': 'https://creativecommons.org/publicdomain/zero/1.0/'}
                   for key, src in SOURCES.items()]
        manifest = {'schema': 1, 'license': 'CC0-1.0', 'voicesModified': False, 'sampleRate': SR, 'channels': 1,
                    'codec': f'mp3 {BITRATE} mono (libmp3lame, Xing 헤더)', 'source': 'tools/audio/build-hit-library.py',
                    'derivedFrom': sources, 'sourceFiles': dict(sorted(lib.used.items())), 'assets': assets}
        (OUT / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    (OUT / 'LICENSE.txt').write_text(
        'Blade Surge Hit Sound Library v2\n\n'
        'These effects are edited (trimmed, filtered, layered, pitch-shifted) from Kenney "Impact Sounds" and\n'
        '"RPG Audio" (CC0 1.0) plus oscillator/noise layers synthesized by tools/audio/build-hit-library.py.\n'
        'Sources: https://kenney.nl/assets/impact-sounds , https://kenney.nl/assets/rpg-audio\n'
        'Original file names and SHA-256 hashes are in manifest.json (sourceFiles / derivedFrom).\n\n'
        'To the extent possible under law the edited result is dedicated to the public domain under CC0 1.0:\n'
        'https://creativecommons.org/publicdomain/zero/1.0/\n\n'
        'Character voice performances are separate assets and are unchanged.\n\n'
        + ''.join(f'---- {SOURCES[key]["name"]} (original License.txt) ----\n{text}\n\n' for key, text in sorted(licenses.items())))
    print(json.dumps({'assets': len(assets), 'bytes': sum(a['bytes'] for a in assets),
                      'maximumDecodedPeak': max(a['decodedPeak'] for a in assets)}))


if __name__ == '__main__':
    main()
