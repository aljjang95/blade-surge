#!/usr/bin/env python3
"""icon-collage-split.py 시험. python3 tools/art/icon-collage-split.test.py 로 바로 실행.

승인된 개별 아이콘(R2 tripo-image/C/*.png, 투명 PNG)을 흰 배경 위 3x2·2x2로 약간 어긋나게 배치하고
JPEG 품질 85로 저장한 가짜 시트를 실행 시 만들어 자른다. 이미지는 저장소에 커밋하지 않는다.
  - 알파 IoU(원본 vs 잘라낸 결과) >= 0.97
  - 가장자리 띠에 흰 화소 비율이 원본 수준(원본 + 1%p 이하)
  - 덩어리 수가 cells 수와 다르면 exit 2
환경변수 ICON_FIXTURE_DIR 에 개별 PNG가 있으면 쓰고, 없으면 $CLOUDFLARE_API_BASE_URL 로 R2에서 받는다.
"""
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
TOOL = ROOT / "tools" / "art" / "icon-collage-split.py"
FIX_DIR = Path(os.environ.get("ICON_FIXTURE_DIR", Path(tempfile.gettempdir()) / "icon-split-fixtures"))
SET6 = ["w_rusty", "w_frost", "w_king", "a_chain", "r_sapphire", "b_knight"]
IOU_MIN = 0.97
fails = []


def fetch(name):
    p = FIX_DIR / f"{name}.png"
    if p.exists():
        return p
    FIX_DIR.mkdir(parents=True, exist_ok=True)
    base = os.environ.get("CLOUDFLARE_API_BASE_URL", "")
    url = f"{base}/accounts/b761ad56f2b49b27a0f8eaf0928848a3/r2/buckets/blade-surge-handoff/objects/tripo-image/C/{name}.png"
    subprocess.run(["curl", "-sS", "-f", "-o", str(p), url], check=True)
    return p


def build_sheet(names, cols, rows, cell, thumb, seed, path):
    rng = np.random.default_rng(seed)
    sheet = Image.new("RGB", (cols * cell, rows * cell), (255, 255, 255))
    truth = []
    for i, n in enumerate(names):
        icon = Image.open(fetch(n)).convert("RGBA")
        bb = icon.split()[3].point(lambda v: 255 if v > 127 else 0).getbbox()
        icon = icon.crop(bb)
        icon.thumbnail((thumb, thumb), Image.LANCZOS)
        cx = (i % cols) * cell + cell // 2 + int(rng.integers(-35, 36))
        cy = (i // cols) * cell + cell // 2 + int(rng.integers(-35, 36))
        x, y = cx - icon.width // 2, cy - icon.height // 2
        sheet.paste(icon, (x, y), icon)
        full = Image.new("L", sheet.size, 0)
        full.paste(icon.split()[3], (x, y))
        truth.append((np.asarray(full) > 127, np.asarray(icon)))
    sheet.save(path, "JPEG", quality=85)
    return truth


def write_brief(path, sid, names, cols, rows):
    path.write_text(json.dumps({"sheets": [{"id": sid, "grid": [cols, rows],
                                            "cells": [{"id": n} for n in names]}]}), encoding="utf-8")


def run(sheet, brief, sid, out):
    return subprocess.run([sys.executable, str(TOOL), str(sheet), "--brief", str(brief),
                           "--sheet", sid, "--out", str(out)], capture_output=True, text=True)


def crop_center(mask, size):
    ys, xs = np.where(mask)
    cy, cx = (ys.min() + ys.max()) // 2, (xs.min() + xs.max()) // 2
    out = np.zeros((size, size), bool)
    y0, x0 = cy - size // 2, cx - size // 2
    sub = mask[max(y0, 0):y0 + size, max(x0, 0):x0 + size]
    out[max(-y0, 0):max(-y0, 0) + sub.shape[0], max(-x0, 0):max(-x0, 0) + sub.shape[1]] = sub
    return out


def white_band_ratio(rgba):
    """알파 가장자리 1px 띠(흰 테두리 띠 = 배경 흰색이 남은 곳)에서 거의 흰 화소의 비율."""
    a = rgba[:, :, 3] > 127
    p = np.pad(a, 1, constant_values=False)
    er = a.copy()
    for dy in range(3):
        for dx in range(3):
            er &= p[dy:dy + a.shape[0], dx:dx + a.shape[1]]
    band = a & ~er
    if band.sum() == 0:
        return 0.0
    rgb = rgba[:, :, :3][band]
    return float((rgb.min(axis=1) > 235).mean())


def check_case(tag, names, cols, rows, tmp, seed):
    sheet = tmp / f"{tag}.jpg"
    truth = build_sheet(names, cols, rows, 640, 460, seed, sheet)
    brief = tmp / f"{tag}.json"
    write_brief(brief, tag, names, cols, rows)
    out = tmp / f"out-{tag}"
    r = run(sheet, brief, tag, out)
    if r.returncode != 0:
        fails.append(f"{tag}: 실행 실패 exit={r.returncode} {r.stderr.strip()}")
        return
    for n, (t, orig) in zip(names, truth):
        rgba = np.asarray(Image.open(out / f"{n}.png").convert("RGBA"))
        if rgba.shape[0] != rgba.shape[1] or rgba.shape[0] > 1024:
            fails.append(f"{tag}/{n}: 크기 {rgba.shape}")
        got = rgba[:, :, 3] > 127
        ys, xs = np.where(got)
        fill = max(ys.max() - ys.min() + 1, xs.max() - xs.min() + 1) / rgba.shape[0]
        if not 0.86 <= fill <= 0.90:
            fails.append(f"{tag}/{n}: 그림 비율 {fill:.3f} (88% 기대)")
        s = 520
        a, b = crop_center(t, s), crop_center(got, s)
        iou = (a & b).sum() / (a | b).sum()
        wb = white_band_ratio(rgba)
        wb0 = white_band_ratio(orig)  # 원본 자체의 밝은 가장자리(흰 부츠·얼음)는 기준선
        print(f"{tag}/{n}: IoU={iou:.4f} 흰띠={wb:.4f}(원본 {wb0:.4f}) fill={fill:.3f}")
        if iou < IOU_MIN:
            fails.append(f"{tag}/{n}: IoU {iou:.4f} < {IOU_MIN}")
        if wb > wb0 + 0.01:
            fails.append(f"{tag}/{n}: 흰 테두리 띠 {wb:.4f} > 원본 {wb0:.4f}")
    if not (out / "contact.png").exists() or not (out / "report.json").exists():
        fails.append(f"{tag}: contact.png/report.json 없음")


def main():
    keep = os.environ.get("KEEP_DIR")
    with tempfile.TemporaryDirectory() as td:
        tmp = Path(keep) if keep else Path(td)
        tmp.mkdir(parents=True, exist_ok=True)
        check_case("grid3x2", SET6, 3, 2, tmp, 1)
        check_case("grid2x2", SET6[:4], 2, 2, tmp, 2)
        # 실패 규칙: cells 6개인데 물건 5개 -> exit 2
        sheet = tmp / "five.jpg"
        build_sheet(SET6[:5], 3, 2, 640, 460, 3, sheet)
        brief = tmp / "five.json"
        write_brief(brief, "five", SET6, 3, 2)
        r = run(sheet, brief, "five", tmp / "out-five")
        print(f"덩어리 수 불일치: exit={r.returncode} {r.stderr.strip()}")
        if r.returncode != 2:
            fails.append(f"불일치 시 exit 2 기대, 실제 {r.returncode}")
    if fails:
        print("실패:\n  " + "\n  ".join(fails))
        sys.exit(1)
    print("전부 통과")


if __name__ == "__main__":
    main()
