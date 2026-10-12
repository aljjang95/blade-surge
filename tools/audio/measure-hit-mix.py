"""hit-v2 라이브러리를 실제 이득표(src/engine/combat-sound-library.js)로 오프라인 렌더해 피크·RMS 를 잰다.

브라우저의 hit 버스 컴프레서(-12dB/4:1)는 모델링하지 않는다. 그래서 여기서 나온 피크는 '컴프레서 앞' 보수적 수치이고,
마지막 소프트 클립(0.8 이상을 1 쪽으로 눌러 둔 곡선)을 거친 값도 함께 적는다. 실제 체인 수치는 브라우저 OfflineAudioContext 렌더로 잰다.
사용: python3 tools/audio/measure-hit-mix.py [--json]  (ffmpeg·numpy·bun 필요). 실제 체인 수치는 tools/audio/measure-hit-chain.mjs.
"""
import json
import math
import subprocess
import sys
from pathlib import Path

import numpy as np
from scipy import signal

ROOT = Path(__file__).resolve().parents[2]
SR = 44100
SFX_BUS = 0.9  # AudioSys 기본 mix.sfx
HIT_BUS_GAIN = 1.8  # combat-sound-library.js 의 HIT_BUS_GAIN 과 같아야 한다


def decode(path):
    raw = subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-i', str(path), '-f', 'f32le', '-ac', '1',
                          '-ar', str(SR), 'pipe:1'], check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.float32).astype(np.float64)


def resample(x, rate):
    if abs(rate - 1) < 1e-3:
        return x
    up, down = 1000, int(round(1000 * rate))
    g = math.gcd(up, down)
    return signal.resample_poly(x, up // g, down // g)


def soft_clip(x):
    a = np.abs(x)
    return np.sign(x) * np.where(a <= .8, a, .8 + .2 * np.tanh((a - .8) / .2))


def db(v):
    return round(20 * math.log10(max(v, 1e-9)), 2)


def table():
    code = ("import * as m from './src/engine/combat-sound-library.js';"
            "const tiers=m.HIT_TIERS, kinds=['slash','blunt','magic'], out={};"
            "for(const tier of tiers)for(const kind of kinds)for(const crit of [false,true])"
            "out[[kind,tier,crit].join('|')]=m.hitLayers(kind,tier,{crit});"
            "out.__kill=m.KILL_SOUND;out.__combo=m.COMBO_STINGERS;console.log(JSON.stringify(out));")
    return json.loads(subprocess.run(['bun', '-e', code], cwd=ROOT, check=True, capture_output=True, text=True).stdout)


def render(layers, cache, offset=0.0):
    out = np.zeros(int(3.0 * SR))
    for layer in layers:
        name = layer['id'] if layer['id'].startswith('c_') else layer['id'] + '_0'
        if name not in cache:
            cache[name] = decode(ROOT / 'public/sfx/hit-v2' / (name + '.mp3'))
        x = resample(cache[name], layer.get('rate', 1)) * layer['vol'] * SFX_BUS * HIT_BUS_GAIN
        start = int(offset * SR)
        out[start:start + len(x)] += x
    return out


def stats(x):
    peak = np.abs(x).max()
    return {'peak': round(float(peak), 3), 'peakDb': db(peak), 'clippedPeak': round(float(np.abs(soft_clip(x)).max()), 3),
            'rmsDb': db(np.sqrt((x ** 2).mean() * len(x) / max(1, np.count_nonzero(np.abs(x) > 1e-4))))}


def main():
    data, cache, report = table(), {}, {'single': {}, 'worstCase': {}}
    for key, layers in data.items():
        if key.startswith('__'):
            continue
        report['single'][key] = stats(render(layers, cache))
    # 같은 순간에 2~3개의 서로 다른 등급이 겹친 최악 조합(등급 상한 규칙: 일반 2음, 마무리·보스·카운터 3음).
    combos = {
        '일반 2음(basic+basic)': [('slash|basic|false', 0), ('blunt|basic|false', 0)],
        '강타 2음(heavy crit + heavy crit)': [('slash|heavy|true', 0), ('magic|heavy|true', 0)],
        '프리미엄 3음(finisher crit + boss crit + counter crit)': [('slash|finisher|true', 0), ('slash|boss|true', 0), ('slash|counter|true', 0)],
        '프리미엄 3음 + 처치(boss)': [('slash|finisher|true', 0), ('slash|boss|true', 0), ('slash|counter|true', 0)],
    }
    for label, parts in combos.items():
        mixed = sum(render(data[k], cache, off) for k, off in parts)
        if '처치' in label:
            mixed = mixed + render([{'id': data['__kill']['boss']['id'], 'vol': data['__kill']['boss']['vol']}], cache)
        report['worstCase'][label] = stats(mixed)
    for stinger in data['__combo']:
        layers = [{'id': stinger['id'], 'vol': stinger['vol']}]
        mixed = render(layers, cache) + render(data['slash|finisher|true'], cache, .2)
        report['worstCase'][f"콤보 {stinger['at']} 스팅어 + finisher crit"] = stats(mixed)
    for name, spec in data['__kill'].items():
        report['single'][f'kill:{name}'] = stats(render([{'id': spec['id'], 'vol': spec['vol']}], cache))
    if '--json' in sys.argv:
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return
    print('== 단일 이벤트 (컴프레서·소프트클립 앞, sfx 0.9 × hit 버스 1.5 포함) ==')
    for key, value in report['single'].items():
        print(f"{key:28s} peak={value['peak']:.3f} ({value['peakDb']:6.2f} dBFS)  소프트클립 후={value['clippedPeak']:.3f}  rms(활성구간)={value['rmsDb']:6.2f} dB")
    print('\n== 겹침 최악 조합 ==')
    for key, value in report['worstCase'].items():
        print(f"{key:48s} peak={value['peak']:.3f} ({value['peakDb']:6.2f} dBFS)  소프트클립 후={value['clippedPeak']:.3f}")


if __name__ == '__main__':
    main()
