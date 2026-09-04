# faster-whisper 로 파일 목록을 전사해 JSON 으로 — gen.mjs 가 대사 대조에 쓴다
import sys, json
from faster_whisper import WhisperModel
m = WhisperModel('base', device='cpu', compute_type='int8')
out = {}
for f in sys.argv[1:]:
    try:
        segs, _ = m.transcribe(f, language='en', beam_size=1)
        out[f] = ' '.join(s.text.strip() for s in segs)
    except Exception as e:
        out[f] = 'ERR ' + str(e)
print(json.dumps(out))
