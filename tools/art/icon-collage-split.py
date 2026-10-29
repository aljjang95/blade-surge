#!/usr/bin/env python3
"""장비 아이콘 콜라주 시트를 장비 id별 투명 PNG로 자르는 도구 (Python3 + Pillow + numpy만).

사용: python3 tools/art/icon-collage-split.py <시트.png|jpg> --brief art-src/gear-icons/brief.json \
        --sheet set-storm --out <dir> [--tol 28] [--merge 0.06] [--noise 0.004]

흐름
 1. 시트 테두리에서 흰색 근처(허용치 --tol) 화소를 flood fill -> 배경. 물건 내부 흰 하이라이트는 남는다.
 2. 물건 안에 갇힌 큰 순백 영역(반지 구멍 등)도 배경으로 뚫는다(--hole-tol, --hole).
    배경이 아닌 화소의 연결 성분을 찾고, 잡티(칸 면적 * --noise 미만)는 버린다.
 3. 칸 크기 * --merge 이내로 가까운 조각은 한 물건으로 합친다(신발 한 쌍, 떠 있는 장식).
 4. 덩어리 수가 cells 수와 다르면 실패(exit 2). 같으면 중심 y로 행, 행 안에서 x로 정렬해 cells에 대응.
 5. 1px 침식 + 1px 알파 페더 -> 알파 bbox 기준 정사각 중앙, 여백 8%(그림 88%), 1024 이하로 저장.
출력: <out>/<id>.png, <out>/contact.png, <out>/report.json
종료 코드: 0 성공, 2 덩어리 수 불일치 등 분할 실패, 1 입력 오류.
"""
import argparse
import hashlib
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

FILL = 0.88
MAX_OUT = 1024


class SplitError(Exception):
    pass


def label(mask):
    """4-연결 성분 라벨링(행 런 + union-find). scipy 없이 동작. 반환: (labels int32, 개수)."""
    h, w = mask.shape
    labels = np.zeros((h, w), np.int32)
    parent = [0]

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    prev = []  # (start, end, id)
    for y in range(h):
        row = mask[y]
        d = np.diff(np.concatenate(([0], row.view(np.int8), [0])))
        starts, ends = np.where(d == 1)[0], np.where(d == -1)[0]
        cur = []
        j = 0
        for s, e in zip(starts, ends):
            while j < len(prev) and prev[j][1] <= s:
                j += 1
            k = j
            rid = 0
            while k < len(prev) and prev[k][0] < e:
                pid = prev[k][2]
                if rid == 0:
                    rid = find(pid)
                else:
                    ra, rb = find(rid), find(pid)
                    if ra != rb:
                        parent[rb] = ra
                k += 1
            if rid == 0:
                parent.append(len(parent))
                rid = len(parent) - 1
            labels[y, s:e] = rid
            cur.append((int(s), int(e), rid))
        prev = cur
    roots = np.array([find(i) for i in range(len(parent))], np.int32)
    if len(parent) == 1:
        return labels, 0
    uniq, inv = np.unique(roots[1:], return_inverse=True)
    remap = np.zeros(len(parent), np.int32)
    remap[1:] = inv + 1
    return remap[labels], len(uniq)


def erode(m):
    p = np.pad(m, 1, constant_values=False)
    out = m.copy()
    for dy in (0, 1, 2):
        for dx in (0, 1, 2):
            out &= p[dy:dy + m.shape[0], dx:dx + m.shape[1]]
    return out


def box3(a):
    p = np.pad(a, 1, mode="edge")
    out = np.zeros_like(a, np.float32)
    for dy in (0, 1, 2):
        for dx in (0, 1, 2):
            out += p[dy:dy + a.shape[0], dx:dx + a.shape[1]]
    return out / 9.0


def find_foreground(rgb, tol, hole_tol, hole_min):
    """테두리와 이어진 흰색 근처를 배경으로 보고 나머지 화소의 연결 성분을 돌려준다.

    물건 안에 갇힌 '진짜 흰색' 큰 영역(반지 구멍, 후광 안쪽)은 배경처럼 뚫는다.
    작은 하이라이트는 hole_min 화소 미만이라 남는다."""
    gap = (255 - rgb.astype(np.int16)).max(axis=2)
    near_white = gap <= tol
    lab, n = label(near_white)
    if n:
        border = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
        bg = np.isin(lab, border[border > 0])
    else:
        bg = np.zeros_like(near_white)
    plab, pn = label((gap <= hole_tol) & ~bg)
    if pn:
        cnt = np.bincount(plab.ravel(), minlength=pn + 1)
        big = np.where(cnt >= hole_min)[0]
        big = big[big > 0]
        bg = bg | np.isin(plab, big)
    flab, fn = label(~bg)
    if fn == 0:
        raise SplitError("물건 화소가 없음(전부 배경)")
    return flab, fn


def group_pieces(flab, fn, cell_w, cell_h, merge_frac, noise_frac):
    cnt = np.bincount(flab.ravel(), minlength=fn + 1)
    pieces = []
    for i in range(1, fn + 1):
        if cnt[i] < noise_frac * cell_w * cell_h:
            continue
        yy, xx = np.where(flab == i)
        pieces.append((i, xx.min(), yy.min(), xx.max() + 1, yy.max() + 1))
    if not pieces:
        raise SplitError("잡티를 뺀 뒤 남은 덩어리가 없음")
    par = list(range(len(pieces)))

    def find(a):
        while par[a] != a:
            par[a] = par[par[a]]
            a = par[a]
        return a

    gx, gy = merge_frac * cell_w, merge_frac * cell_h
    for a in range(len(pieces)):
        for b in range(a + 1, len(pieces)):
            _, ax0, ay0, ax1, ay1 = pieces[a]
            _, bx0, by0, bx1, by1 = pieces[b]
            dx = max(bx0 - ax1, ax0 - bx1, 0)
            dy = max(by0 - ay1, ay0 - by1, 0)
            if dx <= gx and dy <= gy:
                par[find(a)] = find(b)
    groups = {}
    for k, p in enumerate(pieces):
        groups.setdefault(find(k), []).append(p)
    out = []
    for g in groups.values():
        x0 = min(p[1] for p in g); y0 = min(p[2] for p in g)
        x1 = max(p[3] for p in g); y1 = max(p[4] for p in g)
        out.append({"ids": [p[0] for p in g], "bbox": [int(x0), int(y0), int(x1), int(y1)],
                    "cx": (x0 + x1) / 2, "cy": (y0 + y1) / 2})
    return out


def order_groups(groups, cols, rows):
    """중심 y로 행을 나누고(위에서 아래) 각 행 안에서 x로 정렬(왼에서 오른)."""
    gs = sorted(groups, key=lambda g: g["cy"])
    ordered = []
    for r in range(rows):
        ordered.extend(sorted(gs[r * cols:(r + 1) * cols], key=lambda g: g["cx"]))
    return ordered


def make_icon(rgb, fgmask):
    """fgmask(bool HxW, 한 물건) -> (RGBA 정사각 아이콘, 시트 기준 알파 bbox)."""
    m = erode(fgmask)
    alpha = box3(m.astype(np.float32))  # 침식 경계에서 1px 페더
    alpha = np.where(m | (alpha > 0), alpha, 0).astype(np.float32)
    ys, xs = np.where(alpha > 0.02)
    if len(ys) == 0:
        raise SplitError("침식 뒤 알파가 비었음")
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    rgba = np.dstack([rgb, np.round(alpha * 255).astype(np.uint8)])[y0:y1, x0:x1]
    img = Image.fromarray(np.ascontiguousarray(rgba), "RGBA")
    bw, bh = img.size
    side = max(bw, bh)
    s = min(MAX_OUT, int(np.ceil(side / FILL)))
    scale = min(1.0, s * FILL / side)
    if scale < 1.0:
        img = img.resize((max(1, round(bw * scale)), max(1, round(bh * scale))), Image.LANCZOS)
    canvas = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    canvas.paste(img, ((s - img.width) // 2, (s - img.height) // 2))
    return canvas, [int(x0), int(y0), int(x1), int(y1)]


def contact_sheet(items, path, cell=256):
    cols = min(len(items), 4)
    rows = (len(items) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * cell, rows * (cell + 18)), (255, 255, 255))
    t = 16
    chk = Image.new("RGB", (cell, cell))
    d = ImageDraw.Draw(chk)
    for y in range(0, cell, t):
        for x in range(0, cell, t):
            c = (200, 200, 200) if (x // t + y // t) % 2 else (240, 240, 240)
            d.rectangle([x, y, x + t, y + t], fill=c)
    dr = ImageDraw.Draw(sheet)
    for i, (cid, im) in enumerate(items):
        ox, oy = (i % cols) * cell, (i // cols) * (cell + 18)
        tile = chk.copy().convert("RGBA")
        tile.alpha_composite(im.resize((cell, cell), Image.LANCZOS))
        sheet.paste(tile.convert("RGB"), (ox, oy + 18))
        dr.text((ox + 4, oy + 3), cid, fill=(0, 0, 0))
    sheet.save(path)


def split(image_path, brief_path, sheet_id, out_dir, tol=28, merge=0.06, noise=0.004,
          hole_tol=8, hole=0.004):
    brief = json.loads(Path(brief_path).read_text(encoding="utf-8"))
    sheet = next((s for s in brief["sheets"] if s["id"] == sheet_id), None)
    if sheet is None:
        raise SystemExit(f"brief에 시트 id 없음: {sheet_id}")
    cols, rows = sheet["grid"]
    ids = [c["id"] for c in sheet["cells"]]
    if len(ids) != cols * rows:
        raise SystemExit(f"brief 불일치: cells {len(ids)} != grid {cols}x{rows}")
    img = Image.open(image_path)
    if img.mode in ("RGBA", "LA", "P"):
        rgba = img.convert("RGBA")
        flat = Image.new("RGB", rgba.size, (255, 255, 255))
        flat.paste(rgba, mask=rgba.split()[3])
        img = flat
    rgb = np.asarray(img.convert("RGB"))
    h, w, _ = rgb.shape
    flab, fn = find_foreground(rgb, tol, hole_tol, int(hole * w * h / (cols * rows)))
    groups = group_pieces(flab, fn, w / cols, h / rows, merge, noise)
    if len(groups) != len(ids):
        raise SplitError(f"덩어리 수 불일치: 찾음 {len(groups)} != cells {len(ids)} "
                         f"(bbox: {[g['bbox'] for g in groups]})")
    groups = order_groups(groups, cols, rows)
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    report, items = [], []
    for cid, g in zip(ids, groups):
        icon, bbox = make_icon(rgb, np.isin(flab, g["ids"]))
        p = out / f"{cid}.png"
        icon.save(p, optimize=True)
        a = np.asarray(icon)[:, :, 3]
        report.append({"id": cid, "bbox": bbox, "area_ratio": round(float((a > 127).mean()), 4),
                       "size": icon.size[0], "sha256": hashlib.sha256(p.read_bytes()).hexdigest()})
        items.append((cid, icon))
    contact_sheet(items, out / "contact.png")
    (out / "report.json").write_text(json.dumps({"sheet": sheet_id, "icons": report},
                                                ensure_ascii=False, indent=2), encoding="utf-8")
    return report


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("image", help="시트 PNG/JPG")
    ap.add_argument("--brief", default="art-src/gear-icons/brief.json")
    ap.add_argument("--sheet", required=True, help="brief.json의 sheets[].id")
    ap.add_argument("--out", required=True)
    ap.add_argument("--tol", type=int, default=28, help="흰색 허용치(채널별 255와의 최대 차이)")
    ap.add_argument("--merge", type=float, default=0.06, help="조각 합치기 거리(칸 크기 비율)")
    ap.add_argument("--noise", type=float, default=0.004, help="잡티 면적 기준(칸 면적 비율)")
    ap.add_argument("--hole-tol", type=int, default=8, help="구멍으로 볼 '순백' 허용치")
    ap.add_argument("--hole", type=float, default=0.004, help="갇힌 순백 영역을 구멍으로 뚫는 최소 면적(칸 면적 비율)")
    args = ap.parse_args()
    try:
        rep = split(args.image, args.brief, args.sheet, args.out, args.tol, args.merge, args.noise,
                    args.hole_tol, args.hole)
    except SplitError as e:
        print(f"실패(분할): {e}", file=sys.stderr)
        sys.exit(2)
    for r in rep:
        print(f"{r['id']}: bbox={r['bbox']} area={r['area_ratio']} {r['sha256'][:12]}")


if __name__ == "__main__":
    main()
