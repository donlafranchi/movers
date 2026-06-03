// T093 — Unit tests for the QR-card lib (F041).
// Trace: F041 § AC "QR resolves to canonical URL" + "Works across all kinds" +
//        "PNG at print DPI (≥300 DPI @ 4in ⇒ ≥1200px)".

import { describe, it, expect } from 'vitest'
import {
  memberScopedItemPath,
  groupScopedItemPath,
  buildItemSlug,
  qrCardFilename,
  absoluteItemUrl,
  generateQrCardPng,
} from './qr-card'

describe('buildItemSlug', () => {
  it('appends the first 8 chars of the item id to a slugified title', () => {
    expect(buildItemSlug('Country Sourdough Loaf', 'deadbeef-0000-0000-0000-000000000000')).toBe(
      'country-sourdough-loaf-deadbeef',
    )
  })

  it('falls back to "item" for an unsluggable title', () => {
    expect(buildItemSlug('!!!', 'abcd1234-0000-0000-0000-000000000000')).toBe('item-abcd1234')
  })
})

describe('memberScopedItemPath', () => {
  it('uses the kind-specific URL segment for each kind', () => {
    expect(memberScopedItemPath({ handle: 'maya', kind: 'product', slug: 'loaf-deadbeef' })).toBe(
      '/m/maya/p/loaf-deadbeef',
    )
    expect(memberScopedItemPath({ handle: 'maya', kind: 'service', slug: 'lessons-abcd1234' })).toBe(
      '/m/maya/s/lessons-abcd1234',
    )
    expect(memberScopedItemPath({ handle: 'maya', kind: 'gathering', slug: 'run-club-99887766' })).toBe(
      '/m/maya/e/run-club-99887766',
    )
  })
})

describe('groupScopedItemPath', () => {
  it('nests the item under the place path + group slug with the kind segment', () => {
    expect(
      groupScopedItemPath({
        placePath: 'ca/sacramento/oak-park',
        groupSlug: 'oak-park-sourdough-7gx9',
        kind: 'product',
        slug: 'country-sourdough-loaf-4mzx',
      }),
    ).toBe('/p/ca/sacramento/oak-park/g/oak-park-sourdough-7gx9/p/country-sourdough-loaf-4mzx')
  })
})

describe('qrCardFilename', () => {
  it('produces a .png filename keyed on the slug', () => {
    expect(qrCardFilename('product', 'country-sourdough-loaf-4mzx')).toBe(
      'qr-country-sourdough-loaf-4mzx.png',
    )
  })
})

describe('absoluteItemUrl', () => {
  it('prefixes the path with the production origin so a scanner can open it', () => {
    expect(absoluteItemUrl('/m/maya/p/loaf-deadbeef', 'https://movers-makers-shakers.com')).toBe(
      'https://movers-makers-shakers.com/m/maya/p/loaf-deadbeef',
    )
  })

  it('returns the relative path unchanged when no base is given', () => {
    expect(absoluteItemUrl('/m/maya/p/loaf-deadbeef')).toBe('/m/maya/p/loaf-deadbeef')
  })
})

describe('generateQrCardPng', () => {
  const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

  it('returns a valid PNG buffer', async () => {
    const png = await generateQrCardPng('/m/maya/p/loaf-deadbeef')
    expect(Buffer.isBuffer(png)).toBe(true)
    expect(png.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true)
  })

  it('renders at print DPI — IHDR width ≥ 1200px (4in @ 300 DPI)', async () => {
    const png = await generateQrCardPng('/m/maya/p/loaf-deadbeef')
    // PNG IHDR width is a big-endian uint32 at byte offset 16.
    const width = png.readUInt32BE(16)
    expect(width).toBeGreaterThanOrEqual(1200)
  })

  it('is deterministic for the same URL', async () => {
    const a = await generateQrCardPng('/m/maya/p/loaf-deadbeef')
    const b = await generateQrCardPng('/m/maya/p/loaf-deadbeef')
    expect(a.equals(b)).toBe(true)
  })

  it('encodes different URLs to different rasters', async () => {
    const a = await generateQrCardPng('/m/maya/p/loaf-deadbeef')
    const b = await generateQrCardPng('/m/maya/s/lessons-abcd1234')
    expect(a.equals(b)).toBe(false)
  })
})
