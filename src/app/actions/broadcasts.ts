/* eslint-disable @typescript-eslint/no-explicit-any */
'use server'

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { checkIsAdmin } from '@/app/actions/auth'

export async function getBroadcasts() {
  const isAdmin = await checkIsAdmin()
  const supabase = isAdmin ? await createAdminClient() : await createClient()

  // Supabase RLS will automatically filter this down to just the user's broadcasts,
  // or all broadcasts if the user is an admin (based on the RLS policy defined in SQL)
  const { data: broadcasts, error } = await supabase
    .from('broadcasts')
    .select(`
      *,
      users!inner (
        company_name,
        email
      ),
      reports (
        file_key
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
  const isAdmin = await checkIsAdmin()
  const supabase = isAdmin ? await createAdminClient() : await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) return { error: 'Unauthorized' }

  const name = String(formData.get("name") || "")
  const notes = String(formData.get("notes") || "")
  
  const audio = formData.get("audio") as File
  const contacts = formData.get("contacts") as File

  if (!name || !audio?.name || !contacts?.name) {
    return { error: 'Missing required fields or files.' }
  }

  // Upload to Supabase Storage
  const audio_key = `audio/${crypto.randomUUID()}-${audio.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`
  const contacts_key = `contacts/${crypto.randomUUID()}-${contacts.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`
  const reference_no = `BR-${Date.now().toString().slice(-4)}${Math.floor(10 + Math.random() * 90)}`

  const [audioUpload, contactsUpload] = await Promise.all([
    supabase.storage.from('xpack_files').upload(audio_key, audio),
    supabase.storage.from('xpack_files').upload(contacts_key, contacts)
  ])

  if (audioUpload.error || contactsUpload.error) {
    console.error('Storage Upload Error:', audioUpload.error || contactsUpload.error)
    return { error: 'Failed to upload files.' }
  }

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

export async function updateBroadcastStatus(formData: FormData) {
  const isAdmin = await checkIsAdmin()
  if (!isAdmin) return { error: 'Unauthorized' }
  const supabase = await createAdminClient()

  const id = String(formData.get("id"))
  const status = String(formData.get("status")).toUpperCase()
  const reportFile = formData.get("report") as File | null

  // RLS will enforce that only admins can update broadcasts
  const { data, error } = await supabase
    .from('broadcasts')
    .update({ status: status.toUpperCase(), updated_at: new Date().toISOString() })
    .or(`reference_no.eq.${id},id.eq.${id}`)
    .select()
    .single()

  if (error || !data) {
    console.error('Update Broadcast Error:', error)
    return { error: 'Failed to update broadcast' }
  }

  if (status === 'COMPLETED' && reportFile && reportFile.size > 0) {
    const file_key = `reports/${crypto.randomUUID()}-${reportFile.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`
    
    const { error: uploadError } = await supabase.storage.from('xpack_files').upload(file_key, reportFile)
    if (uploadError) {
      console.error('Report Upload Error:', uploadError)
      return { error: 'Failed to upload report file' }
    }

    await supabase
      .from('reports')
      .upsert({
        broadcast_id: data.id,
        file_key
      }, { onConflict: 'broadcast_id' })
  }

  return { success: true }
}

export async function getDownloadUrl(path: string) {
  const isAdmin = await checkIsAdmin()
  const supabase = isAdmin ? await createAdminClient() : await createClient()
  const { data, error } = await supabase.storage.from('xpack_files').createSignedUrl(path, 60 * 60) // 1 hour

  if (error || !data) {
    return { error: 'Failed to generate download link' }
  }
  return { url: data.signedUrl }
}
