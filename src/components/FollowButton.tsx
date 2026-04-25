'use client'

import { useEffect, useState, useTransition } from 'react'
import { Heart } from 'lucide-react'
import { createBrowserClient } from '@supabase/ssr'
import { Toast } from './Toast'

interface Props {
  vendorId: string
  vendorName: string
  size?: 'sm' | 'md'
}

function supabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
  )
}

export function FollowButton({ vendorId, vendorName, size = 'md' }: Props) {
  const [following, setFollowing] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [toast, setToast] = useState<string | null>(null)
  const [showSignupPrompt, setShowSignupPrompt] = useState(false)

  useEffect(() => {
    const client = supabase()
    client.auth.getUser().then(({ data }) => {
      const uid = data.user?.id ?? null
      setUserId(uid)
      if (uid) {
        client
          .from('follows')
          .select('id, unfollowed_at')
          .eq('user_id', uid)
          .eq('vendor_id', vendorId)
          .maybeSingle()
          .then(({ data: row }) => setFollowing(!!row && !row.unfollowed_at))
      }
    })
  }, [vendorId])

  const handleClick = () => {
    if (!userId) {
      setShowSignupPrompt(true)
      return
    }
    const next = !following
    setFollowing(next)
    startTransition(async () => {
      const client = supabase()
      if (next) {
        const { error } = await client.from('follows').upsert(
          { user_id: userId, vendor_id: vendorId, unfollowed_at: null, last_active_at: new Date().toISOString() },
          { onConflict: 'user_id,vendor_id' }
        )
        if (error) {
          setFollowing(false)
          setToast(`Couldn't follow — try again`)
        } else {
          setToast(`Following ${vendorName}`)
        }
      } else {
        const { error } = await client
          .from('follows')
          .update({ unfollowed_at: new Date().toISOString() })
          .eq('user_id', userId)
          .eq('vendor_id', vendorId)
        if (error) {
          setFollowing(true)
          setToast(`Couldn't unfollow — try again`)
        }
      }
    })
  }

  const base =
    size === 'sm'
      ? 'inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium border transition-colors'
      : 'inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium border transition-colors'

  const classes = following
    ? `${base} bg-emerald-700 text-white border-emerald-700`
    : `${base} bg-white text-neutral-900 border-neutral-300 hover:border-neutral-400`

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className={classes}
        data-following={following ? 'true' : 'false'}
        aria-pressed={following}
      >
        <Heart size={size === 'sm' ? 14 : 16} fill={following ? 'currentColor' : 'none'} />
        {following ? 'Following' : 'Follow'}
      </button>

      <Toast message={toast ?? ''} visible={!!toast} onHide={() => setToast(null)} />

      {showSignupPrompt && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6">
            <h3 className="text-lg font-semibold">Sign up to follow {vendorName}</h3>
            <p className="text-sm text-neutral-600 mt-2">
              Get notified when they&apos;re at the market and keep track of makers you love.
            </p>
            <div className="mt-4 flex gap-2">
              <a
                href="/auth/signup"
                className="flex-1 inline-flex items-center justify-center rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white"
              >
                Sign Up
              </a>
              <button
                type="button"
                onClick={() => setShowSignupPrompt(false)}
                className="flex-1 inline-flex items-center justify-center rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700"
              >
                Maybe Later
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
