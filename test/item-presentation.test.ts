import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { ITEM_BY_ID as RAW_ITEMS } from '../src/data/items.js';
import { itemRenderTargets, itemVisual, itemSlotSilhouette } from '../src/ui/item-presentation.js';
import { josa, previewCaption, previewForm } from '../src/ui/item-preview-3d.js';

const ITEM_BY_ID = RAW_ITEMS as Record<string, any>;
const manifest = JSON.parse(readFileSync('src/data/item-presentation.json', 'utf8'));

describe('아이템 표현 단일 규칙', () => {
  test('모든 장비는 3D 원본에서 구운 그림을 쓰고 파일이 실제로 있다', () => {
    const items = Object.values(ITEM_BY_ID) as any[];
    expect(items.length).toBeGreaterThan(150);
    for (const item of items) {
      const visual = itemVisual(item);
      expect(visual.fallback).toBe(false);
      expect(['gear-icon-studio', 'item-render-studio']).toContain(visual.renderSet);
      expect(existsSync('public' + visual.iconUrl)).toBe(true);
    }
  });

  test('서로 다른 장비가 같은 그림을 공유하지 않는다', () => {
    const owners = new Map<string, string>();
    for (const item of Object.values(ITEM_BY_ID) as any[]) {
      const url = itemVisual(item).iconUrl;
      expect(owners.get(url) ?? item.id).toBe(item.id);
      owners.set(url, item.id);
    }
  });

  test('렌더 매니페스트는 대상 목록 · 파일 SHA · 형상 원본과 일치한다', () => {
    const targets = itemRenderTargets(ITEM_BY_ID);
    expect(manifest.items.map((entry: any) => entry.id)).toEqual(targets.map((target) => target.id));
    for (const entry of manifest.items) {
      const bytes = readFileSync('public/img/item-renders/' + entry.id + '.webp');
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(entry.sha256);
      expect(entry.occupancy).toBeGreaterThanOrEqual(0.5);
      expect(entry.occupancy).toBeLessThanOrEqual(0.95);
      expect(targets.find((target) => target.id === entry.id)?.source).toBe(entry.source);
    }
    for (const [path, hash] of Object.entries(manifest.sourceHashes)) expect(createHash('sha256').update(readFileSync(path, 'utf8').replace(/\r\n/g, '\n')).digest('hex')).toBe(hash as string);
  });

  test('그림이 없으면 다른 장비 그림이 아니라 중립 부위 실루엣으로만 바꾼다', () => {
    const unknown = itemVisual({ id: 'missing_item', slot: 'ring', rarity: 'N' });
    expect(unknown.fallback).toBe(true);
    expect(unknown.iconUrl).toBe(itemSlotSilhouette('ring'));
    expect(itemVisual(null).iconUrl).toBe(itemSlotSilhouette('weapon'));
    for (const item of Object.values(ITEM_BY_ID) as any[]) expect(itemVisual(item).fallbackUrl).toBe(itemSlotSilhouette(item.slot));
  });

  test('병기고 장비는 원본 GLB, 방어구는 리그, 나머지는 item-forge 를 원본으로 표시한다', () => {
    expect(itemVisual(ITEM_BY_ID.arm_aegis_weapon).modelKey).toBe('armory:arm_aegis_weapon');
    expect(itemVisual(ITEM_BY_ID.a_storm).source).toBe('armor-rig');
    expect(itemVisual(ITEM_BY_ID.w_storm).source).toBe('forge');
  });

  test('3D 미리보기는 선택 영웅이 실제로 드는 무기 형태를 쓰고 그 범위를 말한다', () => {
    const bowItem = (Object.values(ITEM_BY_ID) as any[]).find((item) => item.slot === 'weapon' && item.rarity === 'N' && !item.modelNode);
    expect(previewForm(bowItem, 'ranger')).toBe('bow');
    expect(previewForm(bowItem, 'knight')).toBe('sword');
    expect(previewForm(ITEM_BY_ID.w_storm, 'knight')).toBe('greatsword');
    expect(previewForm(ITEM_BY_ID.a_storm, 'knight')).toBe('armor');
    expect(previewCaption(bowItem, 'ranger', '바람추적자 실바')).toBe('바람추적자 실바가 들면 활 형태 · 목록 그림은 한손검 기준 같은 장비입니다');
    expect(josa('암살자 카인', '이', '가')).toBe('암살자 카인이');
    expect(josa('검성 아르카', '은', '는')).toBe('검성 아르카는');
    expect(previewCaption(ITEM_BY_ID.arm_aegis_weapon, 'mage', '대마도사 리아')).toContain('기본 무기');
    expect(previewCaption(ITEM_BY_ID.a_storm, 'knight')).toContain('등급 단계 외형');
  });
});
