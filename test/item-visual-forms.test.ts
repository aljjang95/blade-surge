import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { ITEM_BY_ID as RAW_ITEMS } from '../src/data/items.js';
import { LOOKS } from '../src/game/look.js';
import { ITEM_WEAPON_FORMS, buildItemGeometry } from '../src/engine/item-forge.js';
import { weaponLook } from '../src/data/weapon-looks.js';
import { HERO_ORDER } from '../src/data/heroes.js';
import { itemVisual, itemIconHtml } from '../src/ui/item-presentation.js';
import { itemFormRenderTargets, itemFormHeroIds, resolveItemForm } from '../src/ui/item-visual-forms.js';
import { buildItemVisualModel } from '../src/ui/item-visual-model.js';
import { previewCaption, previewForm } from '../src/ui/item-preview-3d.js';
import { deriveItemForms } from '../tools/item-visual-forms.mjs';

const ITEM_BY_ID = RAW_ITEMS as Record<string, any>;
const ITEMS = Object.values(ITEM_BY_ID) as any[];
const WEAPONS = ITEMS.filter((item) => item.slot === 'weapon');
const forms = JSON.parse(readFileSync('src/data/item-presentation-forms.json', 'utf8'));
const variants = JSON.parse(readFileSync('src/data/item-presentation-variants.json', 'utf8'));
const sha = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');

describe('영웅 문맥 아이템 정체성 — 목록 그림 · 선택 3D · 실제 장착이 같은 형태', () => {
  test('형태 표는 실제 LOOKS · ITEM_WEAPON_FORMS · 병기고 판정에서 다시 만든 결과와 같다', () => {
    expect(forms).toEqual(JSON.parse(JSON.stringify(deriveItemForms())));
    expect(itemFormHeroIds().sort()).toEqual(HERO_ORDER.filter((heroId) => (LOOKS as any)[heroId]).sort());
  });

  test('모든 무기 × 영웅의 해석은 전투 장착(weaponLook · LOOKS 노드)과 같은 노드 · 형태 · 개수다', () => {
    let checked = 0;
    for (const heroId of itemFormHeroIds()) for (const item of WEAPONS) {
      const form = resolveItemForm(item, heroId);
      const look = weaponLook(heroId, { id: item.id, enh: 0 }, LOOKS)!;
      expect(form.contextual).toBe(true);
      if (item.modelNode && !look.nodes.length) {
        expect(form.variant).toBe('armory-own');
        expect(form.renderKey).toBeNull();
      } else {
        // 장식형 병기고 무기도 실제로 보이는 것은 그 등급의 기본 무기 노드다.
        expect(form.nodes).toEqual(look.nodes);
        expect(form.form).toBe((ITEM_WEAPON_FORMS as any)[look.nodes[0]]);
        expect(form.count).toBe(look.nodes.filter((node: string) => (ITEM_WEAPON_FORMS as any)[node]).length);
        expect(form.variant).toBe(item.modelNode ? 'armory-ornament' : 'hero-form');
      }
      expect(previewForm(item, heroId)).toBe(form.form);
      checked++;
    }
    expect(checked).toBe(WEAPONS.length * itemFormHeroIds().length);
  });

  test('영웅 문맥 그림은 모든 장비 × 영웅에서 실제 파일이 있고 다른 형태 그림을 대신 쓰지 않는다', () => {
    let variantsUsed = 0;
    for (const heroId of itemFormHeroIds()) for (const item of ITEMS) {
      const visual = itemVisual(item, { heroId }), canonical = itemVisual(item);
      expect(visual.fallback).toBe(false);
      expect(existsSync('public' + visual.iconUrl)).toBe(true);
      expect(visual.heroId).toBe(heroId);
      const form = resolveItemForm(item, heroId);
      if (form.renderKey) {
        variantsUsed++;
        expect(visual.renderSet).toBe('item-form-render');
        expect(visual.iconUrl).toBe('/img/item-renders/forms/' + form.renderKey.replace('@', '--') + '.webp');
        expect(visual.visualKey).toBe(form.renderKey);
        expect(visual.iconUrl).not.toBe(canonical.iconUrl);
      } else {
        // 검성 한손검 · 전용 병기고 모델 · 방어구 · 반지 · 신발은 기본 그림이 곧 그 형태다.
        expect(visual.iconUrl).toBe(canonical.iconUrl);
        expect(visual.visualKey).toBe(item.id);
      }
      expect(visual.modelKey).toBe(canonical.modelKey);
    }
    expect(variantsUsed).toBe(variants.variants.reduce((sum: number, entry: any) => sum + entry.heroes.length, 0));
  });

  test('같은 그림 = 같은 visualKey, 다른 형태는 다른 그림(그림 공유 없음)', () => {
    const byUrl = new Map<string, string>(), byKey = new Map<string, string>();
    for (const heroId of [null, ...itemFormHeroIds()]) for (const item of ITEMS) {
      const visual = itemVisual(item, { heroId });
      expect(byUrl.get(visual.iconUrl) ?? visual.visualKey).toBe(visual.visualKey!);
      expect(byKey.get(visual.visualKey!) ?? visual.iconUrl).toBe(visual.iconUrl);
      byUrl.set(visual.iconUrl, visual.visualKey!); byKey.set(visual.visualKey!, visual.iconUrl);
    }
  });

  test('영웅 형태 렌더 매니페스트는 도달 가능한 조합 · 파일 SHA · 형상 원본과 일치한다', () => {
    const targets = itemFormRenderTargets(ITEM_BY_ID);
    // 검성 N/S/E 한손검 23쌍만 기본 그림을 쓰고 나머지 일반 무기 197쌍 + 병기고 장식 18쌍은 전용 그림이 있다.
    expect(targets.filter((target) => target.variant === 'hero-form').length).toBe(197);
    expect(targets.filter((target) => target.variant === 'armory-ornament').length).toBe(18);
    expect(variants.variants.map((entry: any) => entry.key)).toEqual(targets.map((target) => target.key));
    for (const entry of variants.variants) {
      const target = targets.find((candidate) => candidate.key === entry.key)!;
      expect({ id: entry.id, heroes: entry.heroes, variant: entry.variant, form: entry.form, count: entry.count, formKey: entry.formKey })
        .toEqual({ id: target.id, heroes: target.heroes, variant: target.variant, form: target.form, count: target.count, formKey: target.formKey });
      const bytes = readFileSync('public/img/item-renders/forms/' + entry.file);
      expect(sha(bytes)).toBe(entry.sha256);
      expect(bytes.length).toBe(entry.bytes);
      expect(entry.occupancy).toBeGreaterThanOrEqual(0.5);
      expect(entry.occupancy).toBeLessThanOrEqual(0.95);
    }
    for (const [path, hash] of Object.entries(variants.sourceHashes)) expect(sha(readFileSync(path, 'utf8').replace(/\r\n/g, '\n'))).toBe(hash as string);
    for (const [path, hash] of Object.entries(variants.assetHashes)) expect(sha(readFileSync(path))).toBe(hash as string);
  });

  test('선택 3D 는 목록 그림과 같은 빌더 · 같은 형태 · 같은 자루 수로 만든다', async () => {
    const samples = [['w_storm', 'barbarian'], ['w_storm', 'ranger'], ['w_storm', 'mage'], ['w_storm', null]] as const;
    const pairItem = WEAPONS.find((item) => !item.modelNode && resolveItemForm(item, 'rogue').count === 2)!;
    for (const [id, heroId] of [...samples, [pairItem.id, 'rogue'] as const]) {
      const item = ITEM_BY_ID[id], form = resolveItemForm(item, heroId);
      const model = await buildItemVisualModel(item, form);
      const meshes: any[] = [];
      model.traverse((node: any) => { if (node.isMesh) meshes.push(node); });
      expect(model.userData.itemVisual.formKey).toBe(itemVisual(item, { heroId }).formKey);
      expect(meshes.length).toBe(form.count);
      const expected = buildItemGeometry(form.form, item);
      for (const mesh of meshes) expect(mesh.geometry.attributes.position.count).toBe(expected.attributes.position.count);
      expected.dispose();
      model.userData.dispose();
    }
  });

  test('캡션은 사실만 짧게 말하고 구현 설명 문구가 없다', () => {
    const ranger = WEAPONS.find((item) => !item.modelNode && item.rarity === 'N')!;
    expect(previewCaption(ranger, 'ranger')).toBe('실바 착용 · 장궁');
    expect(previewCaption(ITEM_BY_ID.w_storm, 'knight')).toBe('아르카 착용 · 양손 대검');
    expect(previewCaption(ITEM_BY_ID.arm_aegis_weapon, 'mage')).toBe('리아 착용 · 대마법 지팡이 + 병기고 장식');
    expect(previewCaption(ITEM_BY_ID.arm_aegis_weapon, 'knight')).toBe('아르카 착용 · 병기고 전용 모델');
    expect(itemVisual(ITEM_BY_ID.w_storm).caption).toBe('기본 형태 · 한손검');
    for (const heroId of [null, ...itemFormHeroIds()]) for (const item of ITEMS) {
      const caption = itemVisual(item, { heroId }).caption;
      expect(caption.length).toBeGreaterThan(0);
      expect(caption).not.toMatch(/기준|목록 그림은/);
    }
    const preview = readFileSync('src/ui/item-preview-3d.js', 'utf8');
    expect(preview).not.toContain('목록 그림은');
    expect(preview).toContain('buildItemVisualModel');
  });

  test('모르는 영웅 · 문맥 없음은 기본 그림, img 는 형태 · 영웅을 data 속성으로 남긴다', () => {
    expect(itemVisual(ITEM_BY_ID.w_storm, { heroId: 'nobody' })).toEqual(itemVisual(ITEM_BY_ID.w_storm));
    expect(itemVisual(ITEM_BY_ID.w_storm).contextual).toBe(false);
    const html = itemIconHtml(ITEM_BY_ID.w_storm, ' class="x"', { heroId: 'ranger' });
    expect(html).toContain('src="/img/item-renders/forms/w_storm--bow.webp"');
    expect(html).toContain('data-item-form="bow"');
    expect(html).toContain('data-item-hero="ranger"');
    expect(itemIconHtml(ITEM_BY_ID.w_storm)).toContain('data-item-form="sword"');
  });
});
