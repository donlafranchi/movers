'use client'

import Link from 'next/link'
import { Plus, Star, ChevronDown } from 'lucide-react'

interface Category {
  name: string
  emoji: string
  spots: string[]
  example: { name: string; tagline: string }
}

const RECRUITMENT_CATEGORIES: Category[] = [
  {
    name: 'Food Makers',
    emoji: '🍞',
    spots: ['Home Baker', 'Fermenter', 'Preserves & Honey Maker'],
    example: { name: "Clara's Kitchen", tagline: 'Sourdough loaves, cookies & seasonal jams — baked in small batches' },
  },
  {
    name: 'Growers',
    emoji: '🌱',
    spots: ['Urban Farmer / CSA', 'Backyard Orchardist', 'Mushroom Grower'],
    example: { name: 'Eastside Urban Farm', tagline: 'Weekly CSA boxes, heritage tomatoes & culinary mushrooms grown in Sacramento' },
  },
  {
    name: 'Home & Body Goods',
    emoji: '🕯️',
    spots: ['Candlemaker', 'Soap & Skincare Maker', 'Potter / Ceramicist'],
    example: { name: 'Oak & Ember Candles', tagline: 'Small-batch soy candles scented with botanicals foraged in Northern California' },
  },
  {
    name: 'Textile & Fiber',
    emoji: '🧵',
    spots: ['Seamstress / Tailor', 'Knitter or Crocheter', 'Leatherworker'],
    example: { name: 'Thread & Thrift', tagline: 'Mending, alterations & made-to-order bags — slow fashion from a Sacramento home studio' },
  },
  {
    name: 'Wood & Metal Makers',
    emoji: '🪵',
    spots: ['Furniture Maker', 'Knifemaker / Bladesmith', 'Jeweler'],
    example: { name: 'Sierra Bench Works', tagline: 'Custom cutting boards, kitchen tools & small furniture made from California hardwood' },
  },
  {
    name: 'Repair & Restoration',
    emoji: '🔧',
    spots: ['Bicycle Mechanic', 'Shoe & Leather Repair', 'Watch & Clock Repair'],
    example: { name: "Del's Bike Shop", tagline: 'Independent repair and tune-ups — no chain shop, just honest work and fair prices' },
  },
  {
    name: 'Traditional Trades',
    emoji: '🏗️',
    spots: ['Carpenter / Cabinetmaker', 'Mason / Restoration', 'Native Plant Landscaper'],
    example: { name: 'Vega Custom Carpentry', tagline: 'Finish carpentry, built-ins & cabinetry — family-owned since 1989' },
  },
  {
    name: 'Teachers & Workshops',
    emoji: '📚',
    spots: ['Cooking or Baking Instructor', 'Fermentation Workshop', 'Sewing & Mending Teacher'],
    example: { name: 'The Fermentation Lab', tagline: 'Weekend workshops on kimchi, miso & kraut — beginners welcome, jars provided' },
  },
  {
    name: 'Animal Products',
    emoji: '🐝',
    spots: ['Beekeeper', 'Wool Producer', 'Small-Flock Egg Producer'],
    example: { name: 'Valley Apiary', tagline: 'Raw wildflower honey from hives in the Sacramento Valley — seasonal and limited' },
  },
  {
    name: 'Local Service Providers',
    emoji: '💼',
    spots: ['Independent Auto Mechanic', 'Bookkeeper / Accountant', 'Independent House Cleaner'],
    example: { name: "Marco's Auto", tagline: 'Honest diagnostics, fair rates — family-owned shop serving East Sac since 2003' },
  },
]

function OpenSpotCard({ type, emoji }: { type: string; emoji: string }) {
  return (
    <div className="h-full flex-shrink-0 w-44 border-2 border-dashed border-neutral-300 rounded-xl overflow-hidden bg-neutral-50 flex flex-col">
      <div className="h-28 flex items-center justify-center bg-neutral-100 text-2xl text-neutral-400">
        {emoji}
      </div>
      <div className="p-3 flex-1 flex flex-col gap-2">
        <p className="text-xs font-medium text-neutral-500">{type}</p>
        <p className="text-[11px] text-neutral-400 leading-snug">No one listed yet in Sacramento</p>
        <Link
          href="/join"
          className="mt-auto inline-flex items-center gap-1 text-[11px] font-semibold text-[--color-accent] hover:text-[--color-accent]"
        >
          <Plus size={11} />
          List here — it's free
        </Link>
      </div>
    </div>
  )
}

function ExampleCard({ name, tagline, emoji }: { name: string; tagline: string; emoji: string }) {
  return (
    <div className="h-full flex-shrink-0 w-44 bg-white border border-neutral-200 rounded-xl overflow-hidden relative flex flex-col">
      <div className="absolute top-2 right-2 z-10 bg-amber-100 text-amber-700 text-[10px] font-semibold px-1.5 py-0.5 rounded-full">
        Example
      </div>
      <div className="h-28 bg-gradient-to-br from-[--color-accent-tint] to-amber-100 flex items-center justify-center text-3xl">
        {emoji}
      </div>
      <div className="p-3 flex-1 flex flex-col">
        <p className="font-medium text-sm text-neutral-900 line-clamp-1">{name}</p>
        <p className="text-xs text-neutral-500 mt-0.5 line-clamp-2">{tagline}</p>
        <Link
          href="/join"
          className="mt-auto pt-2 block text-center text-[11px] font-semibold bg-[--color-accent] text-white rounded-lg py-1.5 hover:bg-[--color-accent-hover]"
        >
          Sign up like this
        </Link>
      </div>
    </div>
  )
}

function FeaturedExampleCard() {
  return (
    <div className="relative bg-white border border-neutral-200 rounded-2xl overflow-hidden shadow-sm">
      <div className="absolute top-3 right-3 z-10 bg-amber-100 text-amber-800 text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wide">
        Example listing
      </div>
      <div className="md:flex">
        <div className="h-40 md:h-auto md:w-56 bg-gradient-to-br from-[--color-accent-tint] via-amber-50 to-amber-100 flex items-center justify-center text-6xl shrink-0">
          🍞
        </div>
        <div className="p-4 md:p-5 flex-1">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-700 uppercase tracking-wide">
            <Star size={12} className="fill-amber-500 text-amber-500" />
            Featured Maker
          </div>
          <h3 className="mt-1 text-lg font-semibold text-neutral-900">Clara's Kitchen</h3>
          <p className="text-sm text-neutral-600 mt-1">
            Sourdough loaves, brown-butter cookies, and seasonal jams — baked from a home kitchen in Oak Park.
            Pickup Saturdays at the Midtown Farmers Market.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-neutral-600">
            <span className="bg-neutral-100 rounded-full px-2 py-0.5">Home Baker</span>
            <span className="bg-neutral-100 rounded-full px-2 py-0.5">Cottage Food Permit</span>
            <span className="bg-neutral-100 rounded-full px-2 py-0.5">Sacramento, CA</span>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <Link
              href="/join"
              className="inline-flex items-center gap-1 bg-[--color-accent] hover:bg-[--color-accent-hover] text-white text-sm font-semibold rounded-lg px-3 py-2"
            >
              <Plus size={14} />
              Create your listing
            </Link>
            <span className="text-xs text-neutral-500">Free · 90 seconds · No fees, ever</span>
          </div>
        </div>
      </div>
    </div>
  )
}

export function RecruitmentGrid() {
  return (
    <div className="space-y-8">
      <div className="px-3 md:px-6 pt-6">
        <h2 className="text-base font-semibold text-neutral-900">We're looking for makers in Sacramento</h2>
        <p className="text-sm text-neutral-600 mt-1">
          Every spot below is open. It's free to list, takes 90 seconds, and you keep every customer relationship.
        </p>
      </div>

      <div className="px-3 md:px-6">
        <FeaturedExampleCard />
      </div>

      <div className="px-3 md:px-6 -mb-2 flex flex-col items-center text-center">
        <p className="text-xs font-medium text-neutral-500 uppercase tracking-wide">
          Open spots by category
        </p>
        <ChevronDown size={18} className="text-neutral-400 animate-bounce mt-1" />
      </div>

      {RECRUITMENT_CATEGORIES.map((cat) => (
        <section key={cat.name} className="px-3 md:px-6">
          <h3 className="text-sm font-semibold text-neutral-700 mb-3">
            {cat.emoji} {cat.name}
          </h3>
          <div className="flex items-stretch gap-3 overflow-x-auto pb-2 snap-x">
            {cat.spots.map((spot) => (
              <div key={spot} className="snap-start flex">
                <OpenSpotCard type={spot} emoji={cat.emoji} />
              </div>
            ))}
            <div className="snap-start flex">
              <ExampleCard name={cat.example.name} tagline={cat.example.tagline} emoji={cat.emoji} />
            </div>
          </div>
        </section>
      ))}
    </div>
  )
}
