"""QC JSON을 요약 표와 전사 경고 표로 저장한다."""
import json
from pathlib import Path

root = Path('work/voice-ko')
payload = json.loads((root / 'qc' / 'audio-qc.json').read_text(encoding='utf-8'))
casting = json.loads((root / 'qc' / 'casting-qc.json').read_text(encoding='utf-8'))
lines = ['# 한국어 영웅 보이스 QC', '', '- 도구: `audio_qc.py`와 동일한 faster-whisper small/ko 판정 루틴', '- 사람 청취: `pending`', '- 기합 판정: `atk/hurt/fin`은 1.2초 이하', '', '## 캐스팅 QC', '', '| 영웅 | 길이(초) | 일치율 | LUFS |', '| --- | ---: | ---: | ---: |']
for row in casting['rows']:
    hero = Path(row['file']).stem.replace('-seed-01', '').replace('-seed-02', '')
    lines.append(f"| {hero} | {row['durationSec']:.2f} | {row['matchRatio']:.3f} | {row['integratedLufs']} |")
lines.extend(['', '## 최종 파일 요약', '', '| 영웅 | 파일 | 대사 일치율 0.8 이상 | 평균 LUFS | 1.2초 초과 기합 |', '| --- | ---: | ---: | ---: | ---: |'])
for hero in ['barbarian', 'knight', 'mage', 'rogue', 'ranger']:
    rows = [row for row in payload['rows'] if row['hero'] == hero]
    spoken = [row for row in rows if row['kind'] == 'line']
    mean_lufs = sum(float(row['integratedLufs']) for row in rows) / len(rows)
    lines.append(f"| {hero} | {len(rows)} | {sum(row['matchRatio'] >= 0.8 for row in spoken)}/{len(spoken)} | {mean_lufs:.1f} | {sum(not row['gruntLengthPass'] for row in rows)} |")
warnings = [row for row in payload['rows'] if row['kind'] == 'line' and row['matchRatio'] < 0.8]
lines.extend(['', '## 대사 전사 경고', '', '| 영웅 | 키 | 기대 | 전사 | 일치율 |', '| --- | --- | --- | --- | ---: |'])
for row in warnings:
    lines.append(f"| {row['hero']} | {row['key']} | {row['expect']} | {row['transcript'] or '(무전사)'} | {row['matchRatio']:.3f} |")
(root / 'qc' / 'audio-qc.md').write_text('\n'.join(lines) + '\n', encoding='utf-8')
print(root / 'qc' / 'audio-qc.md')
