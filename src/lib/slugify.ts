import { createClient } from '@/lib/supabase'

export function toSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export async function uniqueSlug(name: string): Promise<string> {
  const base = toSlug(name)
  const supabase = createClient()

  const { count } = await supabase
    .from('businesses')
    .select('id', { count: 'exact', head: true })
    .like('slug', `${base}%`)

  if (!count || count === 0) return base
  return `${base}-${count}`
}
