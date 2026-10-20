import type { GameConfig, Title } from './protocol';

export function titleForRank(config: GameConfig, contentId: string, rank: number): Title | null {
  const content = config.contents.find(item => item.id === contentId);
  const tier = [...config.titleTiers].sort((a, b) => a.maxRank - b.maxRank).find(item => rank >= 1 && rank <= item.maxRank);
  return content && tier ? { id: `${tier.id}:${contentId}`, label: `${tier.label} · ${content.name}` } : null;
}
export function titleLabel(config: GameConfig, id: string): Title | null {
  if (id === config.founders.titleId) return { id, label: config.founders.label };
  if (id === config.completion.titleId) return { id, label: config.completion.label };
  for (const content of config.contents) {
    const tier = config.titleTiers.find(item => id === `${item.id}:${content.id}`);
    if (tier) return { id, label: `${tier.label} · ${content.name}` };
  }
  return null;
}
