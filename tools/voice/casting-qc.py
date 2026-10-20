"""SeedAudio 캐스팅 WAV를 검증된 audio_qc.py로 측정해 표를 남긴다."""
import json
import os
import subprocess
from pathlib import Path

root = Path('work/voice-ko')
qc = Path('C:/Users/heart/.codex/skills/game-audio-forge/scripts/audio_qc.py')
rows = []
for hero_id in ['knight', 'barbarian', 'mage', 'rogue', 'ranger']:
    receipt_path = sorted((root / 'casting').glob(f'{hero_id}-seed-*.receipt.json'))[-1]
    receipt = json.loads(receipt_path.read_text(encoding='utf-8'))
    process = subprocess.run(['python', str(qc), receipt['out'], '--expect', receipt['line'], '--lang', 'ko', '--model', 'small'], capture_output=True, text=True, encoding='utf-8', env={**os.environ, 'PYTHONUTF8': '1'}, check=True)
    rows.extend(json.loads(process.stdout))
out = {'tool': str(qc), 'files': len(rows), 'minimumMatchRatio': min(row.get('matchRatio', 0) for row in rows), 'rows': rows, 'humanListening': 'pending'}
(root / 'qc').mkdir(parents=True, exist_ok=True)
(root / 'qc' / 'casting-qc.json').write_text(json.dumps(out, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'files': len(rows), 'minimumMatchRatio': out['minimumMatchRatio'], 'out': str(root / 'qc' / 'casting-qc.json')}, ensure_ascii=False))
