// T073 — Unit tests for <SellCta>.
// Trace: T073 § Acceptance Criteria — /you Sell CTA wiring (3-branch routing).

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { labelFor, SellCta } from './SellCta'

const pushSpy = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushSpy, replace: vi.fn() }),
}))

// Mock the server-action module so the CTA can mount without a real DB.
vi.mock('@/app/you/sell/actions', () => ({
  sellCreateDraftAction: vi.fn(),
  sellUpdateDraftAction: vi.fn(),
  sellActivateAction: vi.fn(),
  sellCreateLocationAction: vi.fn(),
}))

afterEach(() => {
  pushSpy.mockClear()
  cleanup()
})

function makeSupabaseStub(responses: {
  group_memberships?: unknown[]
  groups?: unknown[]
  locations?: unknown[]
}) {
  const builder = (table: string) => {
    const chain: Record<string, unknown> = {}
    const passthrough = () => chain
    chain.select = passthrough
    chain.eq = passthrough
    chain.is = passthrough
    chain.order = passthrough
    chain.limit = passthrough
    chain.then = (onFulfilled: (v: unknown) => unknown) =>
      Promise.resolve({
        data: responses[table as keyof typeof responses] ?? [],
        error: null,
      }).then(onFulfilled)
    return chain
  }
  return () =>
    ({
      from: vi.fn((table: string) => builder(table)),
    }) as unknown as ReturnType<
      typeof import('@supabase/ssr').createBrowserClient
    >
}

describe('labelFor', () => {
  it('returns "Sell" when nothing is resolved', () => {
    expect(labelFor(null)).toBe('Sell')
  })
  it('returns "Sell" for active-business-Group owner (route to /you/sell)', () => {
    expect(
      labelFor({ draftGroup: null, hasActiveBusinessGroup: true }),
    ).toBe('Sell')
  })
  it('returns "Continue setting up your shop" when a draft is in flight', () => {
    expect(
      labelFor({
        draftGroup: {
          groupId: 'g',
          brandName: 'X',
          anchorLocationId: null,
          publicDescription: null,
          resumeFromStep: 1,
        },
        hasActiveBusinessGroup: false,
      }),
    ).toBe('Continue setting up your shop')
  })
  it('returns "Sell" for first-time Seller', () => {
    expect(
      labelFor({ draftGroup: null, hasActiveBusinessGroup: false }),
    ).toBe('Sell')
  })
})

describe('SellCta — render branches', () => {
  it('renders nothing when there is no signed-in Member', () => {
    const { container } = render(
      <SellCta memberId={null} supabaseFactory={makeSupabaseStub({})} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('shows the "Sell" CTA for a first-time Seller', async () => {
    render(
      <SellCta
        memberId="m1"
        supabaseFactory={makeSupabaseStub({})}
        initialLocations={[]}
      />,
    )
    await waitFor(() => {
      const cta = screen.getByTestId('you-sell-cta')
      expect(cta).toHaveTextContent(/^Sell$/)
      expect(cta).toHaveAttribute('data-cta-state', 'fresh')
    })
  })

  it('shows "Continue setting up your shop" when a draft exists', async () => {
    render(
      <SellCta
        memberId="m1"
        supabaseFactory={makeSupabaseStub({
          groups: [
            {
              id: 'g-draft',
              name: 'Oak Park Sourdough',
              anchor_location_id: 'loc-1',
              group_businesses: [
                {
                  display_name: 'Oak Park Sourdough',
                  public_description: null,
                },
              ],
            },
          ],
        })}
        initialLocations={[]}
      />,
    )
    await waitFor(() => {
      const cta = screen.getByTestId('you-sell-cta')
      expect(cta).toHaveTextContent(/Continue setting up your shop/i)
      expect(cta).toHaveAttribute('data-cta-state', 'resume')
    })
  })

  it('routes to /you/sell when an active business Group is owned', async () => {
    render(
      <SellCta
        memberId="m1"
        supabaseFactory={makeSupabaseStub({
          group_memberships: [
            {
              group_id: 'g',
              groups: { kind: 'business', lifecycle_state: 'active' },
            },
          ],
        })}
        initialLocations={[]}
      />,
    )
    const cta = await screen.findByTestId('you-sell-cta')
    expect(cta).toHaveAttribute('data-cta-state', 'active')
    fireEvent.click(cta)
    expect(pushSpy).toHaveBeenCalledWith('/you/sell')
  })

  it('falls back to fresh-Seller branch on lookup error (CTA still visible)', async () => {
    const errorFactory = () =>
      ({
        from: () => {
          const chain: Record<string, unknown> = {}
          const passthrough = () => chain
          chain.select = passthrough
          chain.eq = passthrough
          chain.is = passthrough
          chain.order = passthrough
          chain.limit = passthrough
          chain.then = (onFulfilled: (v: unknown) => unknown) =>
            Promise.resolve({
              data: null,
              error: { message: 'rls denied' },
            }).then(onFulfilled)
          return chain
        },
      }) as unknown as ReturnType<
        typeof import('@supabase/ssr').createBrowserClient
      >
    render(
      <SellCta
        memberId="m1"
        supabaseFactory={errorFactory}
        initialLocations={[]}
      />,
    )
    await waitFor(() => {
      const cta = screen.getByTestId('you-sell-cta')
      expect(cta).toHaveTextContent(/^Sell$/)
      expect(cta).toHaveAttribute('data-cta-state', 'fresh')
    })
  })

  it('opens the walkthrough on fresh-Seller CTA click', async () => {
    render(
      <SellCta
        memberId="m1"
        supabaseFactory={makeSupabaseStub({})}
        initialLocations={[]}
      />,
    )
    const cta = await screen.findByTestId('you-sell-cta')
    fireEvent.click(cta)
    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: /Brand name/i }),
      ).toBeInTheDocument()
    })
  })
})
