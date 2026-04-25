'use client'

import { useEffect, useState, useTransition } from 'react'
import { Heart } from 'lucide-react'
import { createBrowserClient } from '@supabase/ssr'
import { Toast } from './Toast'
import { AuthGateModal } from './AuthGateModal'

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
    ? `${base} bg-[--color-accent] text-white border-[--color-accent]`
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

      <AuthGateModal
        open={showSignupPrompt}
        onClose={() => setShowSignupPrompt(false)}
        intent="follow"
        headline={`Sign up to follow ${vendorName}`}
        subtext="Get notified when they're at the market and keep track of makers you love."
      />
    </>
  )
}
