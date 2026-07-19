/* eslint-disable @typescript-eslint/no-explicit-any */
'use server'

import { createClient, createAdminClient, createServiceRoleClient } from '@/lib/supabase/server'
import { checkIsAdmin } from '@/app/actions/auth'

export async function getBroadcasts() {
  const isAdmin = await checkIsAdmin()
  
  const supabaseAuth = await createClient()
  const { data: { user } } = await supabaseAuth.auth.getUser()
  if (!user) return { error: 'Unauthorized' }

  const supabase = await createServiceRoleClient()

  let query = supabase
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
    
  if (!isAdmin) {
    query = query.eq('user_id', user.id)
  }

  const { data: broadcasts, error } = await query

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
  const supabaseAuth = await createClient()
  const { data: { user }, error: authError } = await supabaseAuth.auth.getUser()

  if (authError) {
    console.error('Broadcast auth error:', authError.message)
    return { error: 'Unauthorized. Please sign in again.' }
  }
  if (!user) return { error: 'Unauthorized: No active user session.' }

  const supabase = await createServiceRoleClient()

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
  const reference_no = `BR-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`

  const audioUpload = await supabase.storage.from('xpack_files').upload(audio_key, audio)
  const contactsUpload = await supabase.storage.from('xpack_files').upload(contacts_key, contacts)

  if (audioUpload.error || contactsUpload.error) {
    console.error('Storage Upload Error:', audioUpload.error || contactsUpload.error)
    // Clean up any successfully uploaded file to avoid orphans
    if (!audioUpload.error) await supabase.storage.from('xpack_files').remove([audio_key])
    if (!contactsUpload.error) await supabase.storage.from('xpack_files').remove([contacts_key])
    return { error: 'Failed to upload files.' }
  }

  const schedule = String(formData.get("schedule") || "")
  const scheduled_for = schedule && schedule !== 'Start on processing' ? new Date(schedule).toISOString() : null

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
        scheduled_for,
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
  const supabase = await createServiceRoleClient()

  const id = String(formData.get("id"))
  const status = String(formData.get("status")).toUpperCase()
  const validBroadcastStatuses = ['PLACED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']
  if (!validBroadcastStatuses.includes(status)) {
    return { error: 'Invalid status value.' }
  }
  const reportFile = formData.get("report") as File | null

  let query = supabase
    .from('broadcasts')
    .update({ status, updated_at: new Date().toISOString() })

  if (id.startsWith('BR-')) {
    query = query.eq('reference_no', id)
  } else {
    query = query.eq('id', id)
  }

  const { data, error } = await query
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

    const { error: upsertError } = await supabase
      .from('reports')
      .upsert({
        broadcast_id: data.id,
        file_key
      }, { onConflict: 'broadcast_id' })
      
    if (upsertError) {
      console.error('Report Upsert Error:', upsertError)
      return { error: 'Failed to link report file to broadcast' }
    }
  }

  return { success: true }
}

export async function getDownloadUrl(path: string) {
  const supabaseAuth = await createClient()
  const { data: { user } } = await supabaseAuth.auth.getUser()
  if (!user) return { error: 'Unauthorized' }

  const isAdmin = await checkIsAdmin()
  const supabase = await createServiceRoleClient()
  
  if (!isAdmin) {
    const { data: b1 } = await supabase.from('broadcasts').select('id').eq('user_id', user.id).eq('audio_key', path).limit(1)
    const { data: b2 } = await supabase.from('broadcasts').select('id').eq('user_id', user.id).eq('contacts_key', path).limit(1)
    const { data: r1 } = await supabase.from('reports').select('broadcast_id, broadcasts!inner(user_id)').eq('file_key', path).eq('broadcasts.user_id', user.id).limit(1)
    
    const isOwner = (b1 && b1.length > 0) || (b2 && b2.length > 0) || (r1 && r1.length > 0)
    
    if (!isOwner) {
      return { error: 'Unauthorized: You do not have permission to access this file.' }
    }
  }

  const { data, error } = await supabase.storage.from('xpack_files').createSignedUrl(path, 60 * 60) // 1 hour

  if (error || !data) {
    return { error: 'Failed to generate download link' }
  }
  return { url: data.signedUrl }
}
