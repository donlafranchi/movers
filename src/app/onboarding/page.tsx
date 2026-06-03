// T089 — Post-auth onboarding page (F030).
// Gate: unauthenticated → signup; already-onboarded (active primary_home) → /.
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { OnboardingFlow, type LocalityOption } from '@/components/onboarding/OnboardingFlow'

export default async function OnboardingPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/auth/signup?next=/onboarding')

  // Idempotent re-entry: a Member who already set a home locality is done.
  const { data: home } = await supabase
    .from('member_place_interests')
    .select('place_id')
    .eq('member_id', user.id)
    .eq('scope_kind', 'primary_home')
    .is('removed_at', null)
    .maybeSingle()
  if (home) redirect('/')

  const { data: member } = await supabase
    .from('members')
    .select('handle, display_name')
    .eq('id', user.id)
    .maybeSingle()

  const { data: places } = await supabase
    .from('places')
    .select('id, display_name, kind')
    .in('kind', ['neighborhood', 'city'])
    .is('deleted_at', null)
    .order('kind')
    .limit(40)

  const localityOptions: LocalityOption[] = ((places ?? []) as {
    id: string
    display_name: string
  }[]).map((p) => ({ placeId: p.id, displayName: p.display_name }))

  const m = member as { handle: string; display_name: string } | null

  return (
    <OnboardingFlow
      initialDisplayName={m?.display_name ?? ''}
      initialHandle={m?.handle ?? ''}
      localityOptions={localityOptions}
    />
  )
}
