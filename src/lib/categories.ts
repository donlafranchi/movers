export type CategorySlug =
  | 'bread'
  | 'produce'
  | 'honey-jams'
  | 'soap-body'
  | 'candles'
  | 'plants-flowers'
  | 'crafts'
  | 'meat-eggs'

export interface CategoryMeta {
  slug: CategorySlug
  label: string
  emoji: string
  pinColor: string
}

export const CATEGORIES: Record<CategorySlug, CategoryMeta> = {
  bread: { slug: 'bread', label: 'Bread & Baked', emoji: '🍞', pinColor: '#b45309' },
  produce: { slug: 'produce', label: 'Produce', emoji: '🥬', pinColor: '#15803d' },
  'honey-jams': { slug: 'honey-jams', label: 'Honey & Jams', emoji: '🍯', pinColor: '#d97706' },
  'soap-body': { slug: 'soap-body', label: 'Soap & Body', emoji: '🧼', pinColor: '#0369a1' },
  candles: { slug: 'candles', label: 'Candles', emoji: '🕯️', pinColor: '#a16207' },
  'plants-flowers': { slug: 'plants-flowers', label: 'Plants & Flowers', emoji: '🌸', pinColor: '#be185d' },
  crafts: { slug: 'crafts', label: 'Crafts', emoji: '🎨', pinColor: '#7c3aed' },
  'meat-eggs': { slug: 'meat-eggs', label: 'Meat & Eggs', emoji: '🥚', pinColor: '#b91c1c' },
}

export const CATEGORY_ORDER: CategorySlug[] = [
  'bread',
  'produce',
  'honey-jams',
  'soap-body',
  'candles',
  'plants-flowers',
  'crafts',
  'meat-eggs',
]

export function getCategoryPinColor(slug: string): string {
  return CATEGORIES[slug as CategorySlug]?.pinColor ?? '#64748b'
}
