/* eslint-disable @typescript-eslint/no-explicit-any */
'use server'

import { createClient } from '@/lib/supabase/server'

export async function getBroadcasts() {
  const supabase = await createClient()

  // Supabase RLS will automatically filter this down to just the user's broadcasts,
  // or all broadcasts if the user is an admin (based on the RLS policy defined in SQL)
  const { data: broadcasts, error } = await supabase
    .from('broadcasts')
    .select(`
      *,
      users!inner (
        company_name,
        email
      )
    `)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('Fetch Broadcasts Error:', error)
    return { error: 'Failed to fetch broadcasts' }
  }

  // Flatten the payload for the frontend
  const formatted = broadcasts?.map((b: any) => ({
    ...b,
    customer: b.users?.company_name || 'Unknown',
    email: b.users?.email || 'Unknown',
  }))

  return { data: formatted }
}

export async function createBroadcast(formData: FormData) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) return { error: 'Unauthorized' }

  const name = String(formData.get("name") || "")
    const notes = String(formData.get("notes") || "")
  
  const audio = formData.get("audio") as File
  const contacts = formData.get("contacts") as File

  if (!name || !audio?.name || !contacts?.name) {
    return { error: 'Missing required fields or files.' }
  }

  // Placeholder keys until actual bucket uploads are wired up if they have S3
  const audio_key = `audio/${crypto.randomUUID()}-${audio.name}`
  const contacts_key = `contacts/${crypto.randomUUID()}-${contacts.name}`
  const reference_no = `BR-${1050 + Math.floor(Math.random() * 850)}`

  const { data, error } = await supabase
    .from('broadcasts')
    .insert([
      {
        user_id: user.id,
        reference_no,
        name,
        description: notes,
        audio_key,
        contacts_key,
        status: 'PLACED'
      }
    ])
    .select()
    .single()

  if (error) {
    console.error('Create Broadcast Error:', error)
    return { error: 'Failed to create broadcast' }
  }

  return { data }
}

export async function updateBroadcastStatus(id: string, status: string, reportFile?: File) {
  const supabase = await createClient()

  // RLS will enforce that only admins can update broadcasts
  const { data, error } = await supabase
    .from('broadcasts')
    .update({ status: status.toUpperCase(), updated_at: new Date().toISOString() })
    .or(`reference_no.eq.\${id},id.eq.\${id}`)
    .select()
    .single()

  if (error || !data) {
    console.error('Update Broadcast Error:', error)
    return { error: 'Failed to update broadcast' }
  }

  if (status.toUpperCase() === 'COMPLETED' && reportFile) {
    const file_key = `reports/${crypto.randomUUID()}-${reportFile.name}`
    await supabase
      .from('reports')
      .upsert({
        broadcast_id: data.id,
        file_key
      }, { onConflict: 'broadcast_id' })
  }

  return { data }
}
