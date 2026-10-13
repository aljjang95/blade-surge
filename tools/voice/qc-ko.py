"""한국어 영웅 보이스의 받아쓰기·길이·라우드니스 표를 만든다."""
import json
import difflib
import re
import subprocess
import sys
from pathlib import Path

from faster_whisper import WhisperModel

def ebur(path):
    process = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', path, '-af', 'ebur128=peak=true', '-f', 'null', '-'], capture_output=True, text=True, encoding='utf-8', errors='replace')
    tail = process.stderr[process.stderr.rfind('Summary:'):]
    get = lambda key: (re.search(key + r'\s*:\s*(-?[\d.]+|-inf)', tail) or [None, None])[1]
    return {'integratedLufs': get('I'), 'loudnessRangeLu': get('LRA'), 'truePeakDbfs': get('Peak')}

def silence_ratio(path):
    process = subprocess.run(['ffmpeg', '-hide_banner', '-i', path, '-af', 'silencedetect=n=-45dB:d=0.25', '-f', 'null', '-'], capture_output=True, text=True, encoding='utf-8', errors='replace')
    total = sum(float(value) for value in re.findall(r'silence_duration: ([\d.]+)', process.stderr))
    match = re.search(r'Duration: (\d+):(\d+):([\d.]+)', process.stderr)
    duration = int(match[1]) * 3600 + int(match[2]) * 60 + float(match[3]) if match else 0
    return {'durationSec': round(duration, 3), 'silenceSec': round(total, 3), 'silenceRatio': round(total / duration, 3) if duration else None}

def norm(value):
    return re.sub(r'[^0-9a-zA-Z가-힣]', '', re.sub(r'\[[^\]]*\]', '', value or ''))

root = Path(sys.argv[1] if len(sys.argv) > 1 else 'work/voice-ko')
model = WhisperModel('small', device='cpu', compute_type='int8')
rows = []
for lines_path in sorted(root.glob('*-lines.json')):
    if lines_path.name.endswith('-fish-lines.json'):
        continue
    hero_id = lines_path.stem.removesuffix('-lines')
    payload = json.loads(lines_path.read_text(encoding='utf-8'))
    expected = {item['id']: item for item in payload['source']}
    for path in sorted((root / 'lines-wav' / hero_id).glob('*.wav')):
        item = expected[path.stem]
        segments, info = model.transcribe(str(path), language='ko', vad_filter=True)
        segments = list(segments)
        transcript = ' '.join(segment.text.strip() for segment in segments)
        row = {'hero': hero_id, 'key': path.stem, 'file': str(path), **silence_ratio(str(path)),
               **ebur(str(path)), 'transcript': transcript, 'expect': item['text'],
               'kind': item['kind'], 'speechSegments': len(segments), 'asrLanguageProb': round(info.language_probability, 3),
               'matchRatio': round(difflib.SequenceMatcher(None, norm(item['text']), norm(transcript)).ratio(), 3),
               'humanListening': 'pending'}
        row['gruntLengthPass'] = not (item['kind'] == 'bark' and item['id'].startswith(('atk', 'hurt', 'fin')) and row['durationSec'] > 1.2)
        rows.append(row)
out = {'files': len(rows), 'gruntLengthPass': all(row['gruntLengthPass'] for row in rows), 'humanListening': 'pending', 'rows': rows}
(root / 'qc' / 'audio-qc.json').parent.mkdir(parents=True, exist_ok=True)
(root / 'qc' / 'audio-qc.json').write_text(json.dumps(out, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'files': len(rows), 'gruntLengthPass': out['gruntLengthPass'], 'out': str(root / 'qc' / 'audio-qc.json')}, ensure_ascii=False))
