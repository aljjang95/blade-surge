"""검격·원소·직업 시전음을 외부 음원 없이 합성한다. 유료 서비스나 음성 모델을 호출하지 않는다."""
import array
import hashlib
import json
import math
from pathlib import Path
import random
import subprocess
import tempfile
import wave

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'public/sfx/crafted/combat-v1'
RATE = 44100
PROFILES = {
    'blade': (.28, 1900, 100, .48, [(2300, .19), (3480, .09)]),
    'heavy': (.42, 680, 58, .58, [(940, .12), (1420, .07)]),
    'dual': (.23, 3400, 160, .40, [(3100, .16), (4590, .08)]),
    'bow': (.30, 2600, 240, .34, [(740, .18), (1120, .13)]),
    'arcane': (.46, 1200, 310, .22, [(622, .27), (932, .16), (1244, .12)]),
    'holy': (.52, 1600, 180, .19, [(784, .25), (1175, .17), (1568, .12)]),
    'earth': (.49, 480, 48, .64, [(180, .16), (271, .09)]),
    'shadow': (.38, 960, 130, .30, [(349, .24), (440, .12)]),
    'fire': (.50, 1300, 65, .64, [(240, .08), (480, .04)]),
    'frost': (.50, 3800, 210, .24, [(2093, .19), (3136, .16), (4186, .10)]),
    'storm': (.42, 2200, 92, .50, [(1556, .14), (2330, .10)]),
    'ultimate': (.66, 540, 42, .39, [(147, .20), (220, .13), (294, .11)]),
}


def synthesize(name, profile):
    duration, cut, body, noise_gain, partials = profile
    rng = random.Random(0xB1ADE + list(PROFILES).index(name))
    samples = []
    low = 0.0
    previous = 0.0
    body_phase = 0.0
    for i in range(round(duration * RATE)):
        t = i / RATE
        p = t / duration
        white = rng.uniform(-1, 1)
        # 색을 가진 소음의 중심이 짧게 상승한 뒤 감쇠한다.
        cutoff = cut * (.58 + math.sin(math.pi * min(1, p * 1.8)) * 1.4)
        coefficient = 1 - math.exp(-2 * math.pi * min(12000, cutoff) / RATE)
        low += coefficient * (white - low)
        grain = (low - previous) * 3.1
        previous = low
        sweep = math.sin(math.pi * min(1, p * 2.5)) ** .55 * math.exp(-p * 3.8)
        if name == 'dual':
            sweep += .6 * math.exp(-((p - .43) / .09) ** 2)
        if name == 'storm':
            sweep *= .55 + .45 * math.sin(t * 2 * math.pi * 37) ** 2
        body_phase += 2 * math.pi * body * (1.9 - 1.2 * p) / RATE
        signal = grain * noise_gain * sweep
        signal += math.sin(body_phase) * (.30 if name in ['heavy', 'earth', 'ultimate'] else .12) * math.exp(-p * 9)
        for j, (frequency, gain) in enumerate(partials):
            delay = j * (.025 if name in ['holy', 'arcane', 'frost'] else .007)
            age = t - delay
            if age >= 0:
                bend = -.22 if name == 'shadow' else .07 if name in ['arcane', 'holy'] else -.03
                phase = 2 * math.pi * frequency * (age + bend * age * age / duration)
                signal += math.sin(phase) * gain * math.exp(-age / duration * (4.5 + j))
        fade_in = min(1, t / .003)
        fade_out = min(1, max(0, (duration - t) / .05))
        samples.append(signal * fade_in * fade_out)
    mean = sum(samples) / len(samples)
    samples = [sample - mean for sample in samples]
    peak = max(abs(sample) for sample in samples)
    return [sample * .80 / peak for sample in samples]


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    assets = []
    with tempfile.TemporaryDirectory(prefix='bladesurge-combat-sfx-') as temporary:
        for name, profile in PROFILES.items():
            samples = synthesize(name, profile)
            pcm = array.array('h', (round(sample * 32767) for sample in samples))
            source = Path(temporary) / (name + '.wav')
            with wave.open(str(source), 'wb') as output:
                output.setnchannels(1)
                output.setsampwidth(2)
                output.setframerate(RATE)
                output.writeframes(pcm.tobytes())
            target = OUT / (name + '.mp3')
            subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(source),
                            '-map_metadata', '-1', '-codec:a', 'libmp3lame', '-b:a', '96k', '-write_xing', '1', str(target)], check=True)
            decoded = subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-i', str(target),
                                      '-f', 'f32le', '-ac', '1', '-ar', str(RATE), 'pipe:1'], check=True, capture_output=True).stdout
            values = array.array('f')
            values.frombytes(decoded)
            decoded_peak = max(abs(sample) for sample in values)
            rms = math.sqrt(sum(sample * sample for sample in values) / len(values))
            if not all(math.isfinite(sample) for sample in values) or decoded_peak >= .98 or rms <= .015:
                raise RuntimeError(f'{name}: 디코딩 파형 검증 실패 {decoded_peak}/{rms}')
            data = target.read_bytes()
            assets.append({'id': name, 'path': '/sfx/crafted/combat-v1/' + name + '.mp3',
                           'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest(),
                           'decodedSamples': len(values), 'durationSec': round(len(values) / RATE, 6),
                           'decodedPeak': round(decoded_peak, 6), 'decodedRms': round(rms, 6)})
    manifest = {'schema': 1, 'author': 'Blade Surge local procedural audio studio', 'license': 'CC0-1.0',
                'source': 'tools/audio/build-combat-library.py', 'sampleRate': RATE, 'channels': 1,
                'voicesModified': False, 'assets': assets}
    (OUT / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'assets': len(assets), 'bytes': sum(asset['bytes'] for asset in assets),
                      'maximumDecodedPeak': max(asset['decodedPeak'] for asset in assets)}))


if __name__ == '__main__':
    main()
