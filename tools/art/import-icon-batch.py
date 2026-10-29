"""새 장비 아이콘 PNG 묶음 -> 게임이 실제로 보여 주는 경로로 변환(import-icon-png.py 의 convert 재사용).

경로 판정은 src/ui/item-presentation.js itemVisual(item) (영웅 문맥 없음)과 같다:
  item.icon 이 /img/gear/ 로 시작  -> public/img/gear/<id>.webp          + tools/art/gear-icon-studio.manifest.json sha256
  아니면 item-presentation.json 에 있음 -> public/img/item-renders/<id>.webp + src/data/item-presentation.json items[] sha256·occupancy
  둘 다 아니면 오류(종료 코드 2, 아무것도 쓰지 않음).
영웅 형태 무기 그림(forms/)과 그 매니페스트는 건드리지 않는다.

사용: python3 tools/art/import-icon-batch.py --src <PNG 폴더> [--quality 78] [--dry-run]
"""
import argparse, hashlib, importlib.util, json, os, subprocess, sys
from PIL import Image

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
spec = importlib.util.spec_from_file_location('import_icon_png', os.path.join(os.path.dirname(__file__), 'import-icon-png.py'))
base = importlib.util.module_from_spec(spec); spec.loader.exec_module(base)

NODE = ("import('./src/data/items.js').then(m=>{const o={};for(const i of Object.values(m.ITEM_POOL).flat())o[i.id]=String(i.icon||'');"
        "for(const i of Object.values(m.ITEM_BY_ID||{}))o[i.id]=String(i.icon||'');console.log(JSON.stringify(o))})")


def occupancy(path):
    a = Image.open(path).convert('RGBA').getchannel('A').point(lambda v: 255 if v > 8 else 0)
    l, t, r, b = a.getbbox()
    return round(max(r - l, b - t) / base.SIZE, 3)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', required=True)
    ap.add_argument('--quality', type=int, default=78)
    ap.add_argument('--dry-run', action='store_true')
    a = ap.parse_args()
    icons = json.loads(subprocess.check_output(['node', '-e', NODE], cwd=REPO, text=True))
    pres_path = os.path.join(REPO, 'src/data/item-presentation.json')
    pres = json.load(open(pres_path, encoding='utf8'))
    rendered = {e['id']: e for e in pres['items']}
    # icon-collage-split.py 출력 폴더를 그대로 받을 수 있게 그 도구가 만드는 대조 시트(contact.png)는 뺀다
    ids = sorted(f[:-4] for f in os.listdir(a.src) if f.endswith('.png') and f != 'contact.png')
    plan, bad = {}, []
    for i in ids:
        if i not in icons: bad.append(i + ':아이템 없음')
        elif icons[i].startswith('/img/gear/'): plan[i] = 'gear'
        elif i in rendered: plan[i] = 'render'
        else: bad.append(i + ':표시 경로 없음')
    if bad:
        print('경로 판정 실패:', bad, file=sys.stderr); sys.exit(2)
    gear_h, rend_h = {}, {}
    old = {'gear': 0, 'render': 0}; new = {'gear': 0, 'render': 0}
    for i in ids:
        kind = plan[i]
        dst = os.path.join(REPO, 'public/img/gear' if kind == 'gear' else 'public/img/item-renders', i + '.webp')
        old[kind] += os.path.getsize(dst) if os.path.exists(dst) else 0
        if a.dry_run: continue
        new[kind] += base.convert(os.path.join(a.src, i + '.png'), dst, a.quality)
        h = hashlib.sha256(open(dst, 'rb').read()).hexdigest()
        (gear_h if kind == 'gear' else rend_h)[i] = (h, occupancy(dst))
    if not a.dry_run:
        mp = os.path.join(REPO, 'tools/art/gear-icon-studio.manifest.json')
        man = json.load(open(mp, encoding='utf8'))
        for e in man['items']:
            if e['id'] in gear_h: e['sha256'] = gear_h[e['id']][0]
        open(mp, 'w', encoding='utf8').write(json.dumps(man, indent=2, ensure_ascii=False) + '\n')
        for e in pres['items']:
            if e['id'] in rend_h: e['sha256'], e['occupancy'] = rend_h[e['id']]
        open(pres_path, 'w', encoding='utf8').write(json.dumps(pres, indent=2, ensure_ascii=False) + '\n')
    n = {k: sum(1 for v in plan.values() if v == k) for k in old}
    print(f"gear {n['gear']}장 {old['gear']}->{new['gear']} bytes / item-renders {n['render']}장 {old['render']}->{new['render']} bytes")


if __name__ == '__main__':
    main()
