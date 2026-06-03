'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import type { User } from '@supabase/supabase-js'

export function useAuth() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user)
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
      setLoading(false)
    })

    return () => subscription.unsubscribe()
  }, [])

  const signUp = useCallback(async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signUp({ email, password })
    return { data, error }
  }, [])

  const signIn = useCallback(async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    return { data, error }
  }, [])

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut()
    return { error }
  }, [])

  const signInWithOtp = useCallback(async (email: string, next?: string) => {
    const origin = typeof window !== 'undefined' ? window.location.origin : ''
    const redirectTo = `${origin}/auth/callback${next ? `?next=${encodeURIComponent(next)}` : ''}`
    const { data, error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo },
    })
    return { data, error }
  }, [])

  const signInWithGoogle = useCallback(async (next?: string) => {
    const origin = typeof window !== 'undefined' ? window.location.origin : ''
    const redirectTo = `${origin}/auth/callback${next ? `?next=${encodeURIComponent(next)}` : ''}`
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo },
    })
    return { data, error }
  }, [])

  // F030: returning-user detection for the email-first signup page.
  const checkEmailRegistered = useCallback(async (email: string) => {
    const { data, error } = await supabase.rpc('email_is_registered', {
      p_email: email,
    })
    if (error) throw error
    return data === true
  }, [])

  return {
    user,
    loading,
    signUp,
    signIn,
    signOut,
    signInWithOtp,
    signInWithGoogle,
    checkEmailRegistered,
  }
}
