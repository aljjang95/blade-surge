"""장비 아이콘 PNG(1024² 투명) -> public/img/gear/<id>.webp(256² RGBA) 변환.

알파 bbox로 잘라 정사각 캔버스 중앙에 두고(그림이 캔버스의 88%, 여백 8%+8%) 256x256 webp로 저장한다.
기존 파일을 같은 경로·이름으로 덮어쓴다. 원본 PNG는 저장소에 두지 않는다(--src는 저장소 밖 폴더).

사용:
  python3 tools/art/import-icon-png.py --src <PNG 폴더> [--out public/img/gear] [--quality 78] [--check-ids] [--dry-run] [--no-manifest]

--check-ids: src의 <id>.png 집합이 src/data/items.js ITEM_POOL의 N·S·E·L 기본 장비(60종, U 제외)와
정확히 일치하는지 node로 확인한다. 불일치면 아무것도 쓰지 않고 종료 코드 2.
"""
import argparse, hashlib, json, os, subprocess, sys
from PIL import Image

SIZE = 256
FILL = 0.88  # 그림이 캔버스에서 차지하는 비율

NODE_IDS = (
    "import('./src/data/items.js').then(m=>console.log(JSON.stringify("
    "Object.values(m.ITEM_POOL).flat().filter(i=>'NSEL'.includes(i.rarity)&&String(i.icon).startsWith('/img/gear/')&&!i.id.startsWith('gear_')).map(i=>i.id))))"
)


def pool_ids(repo):
    out = subprocess.check_output(['node', '-e', NODE_IDS], cwd=repo, text=True)
    return set(json.loads(out))


def convert(src_path, dst_path, quality):
    im = Image.open(src_path).convert('RGBA')
    bbox = im.getchannel('A').point(lambda a: 255 if a > 8 else 0).getbbox()
    if not bbox:
        raise ValueError('빈 알파: ' + src_path)
    im = im.crop(bbox)
    w, h = im.size
    scale = SIZE * FILL / max(w, h)
    nw, nh = max(1, round(w * scale)), max(1, round(h * scale))
    im = im.resize((nw, nh), Image.LANCZOS)
    canvas = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    canvas.paste(im, ((SIZE - nw) // 2, (SIZE - nh) // 2), im)
    canvas.save(dst_path, 'WEBP', quality=quality, method=6, alpha_quality=quality)
    return os.path.getsize(dst_path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', required=True)
    ap.add_argument('--out', default='public/img/gear')
    ap.add_argument('--quality', type=int, default=78)
    ap.add_argument('--check-ids', action='store_true')
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--no-manifest', action='store_true', help='gear-icon-studio.manifest.json 갱신 생략')
    a = ap.parse_args()
    repo = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
    ids = sorted(f[:-4] for f in os.listdir(a.src) if f.endswith('.png'))
    if a.check_ids:
        want = pool_ids(repo)
        if set(ids) != want:
            print('id 불일치 — 없음:', sorted(want - set(ids)), '여분:', sorted(set(ids) - want), file=sys.stderr)
            sys.exit(2)
        print('id 검증 통과:', len(ids))
    total_old = total_new = 0
    hashes = {}
    for i in ids:
        dst = os.path.join(a.out, i + '.webp')
        old = os.path.getsize(dst) if os.path.exists(dst) else 0
        if a.dry_run:
            continue
        new = convert(os.path.join(a.src, i + '.png'), dst, a.quality)
        total_old += old; total_new += new
        with open(dst, 'rb') as fh: hashes[i] = hashlib.sha256(fh.read()).hexdigest()
    if hashes and not a.no_manifest:
        # test/gear-catalog.test.ts 가 읽는 추적 매니페스트의 sha256 만 바꾼다(sourceHashes·순서 유지).
        mp = os.path.join(repo, 'tools/art/gear-icon-studio.manifest.json')
        man = json.load(open(mp, encoding='utf8'))
        for e in man['items']:
            if e['id'] in hashes: e['sha256'] = hashes[e['id']]
        with open(mp, 'w', encoding='utf8') as fh: fh.write(json.dumps(man, indent=2) + '\n')
        print('매니페스트 sha256 갱신:', len(hashes))
    print(f'{len(ids)}개 변환, 용량 {total_old} -> {total_new} bytes')


if __name__ == '__main__':
    main()
