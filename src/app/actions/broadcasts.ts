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
      ),
      broadcast_status_history (
        status,
        reason,
        created_at
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
    history: b.broadcast_status_history?.sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) || [],
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

  // Insert initial history record
  await supabase.from('broadcast_status_history').insert([{
    broadcast_id: data.id,
    status: 'PLACED'
  }])

  return { data }
}

export async function updateBroadcastStatus(formData: FormData) {
  const isAdmin = await checkIsAdmin()
  if (!isAdmin) return { error: 'Unauthorized' }
  const supabase = await createServiceRoleClient()

  const id = String(formData.get("id"))
  const status = String(formData.get("status")).toUpperCase()
  const validBroadcastStatuses = ['PLACED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'ON_HOLD', 'REFUNDED']
  if (!validBroadcastStatuses.includes(status)) {
    return { error: 'Invalid status value.' }
  }
  const reportFile = formData.get("report") as File | null
  const holdReason = String(formData.get("holdReason") || "")
  const cancelReason = String(formData.get("cancelReason") || "")
  const refundReason = String(formData.get("refundReason") || "")
  const refundAmount = formData.get("refundAmount") ? parseFloat(String(formData.get("refundAmount"))) : null

  const updatePayload: any = { status, updated_at: new Date().toISOString() }
  
  updatePayload.hold_reason = status === 'ON_HOLD' ? (holdReason || null) : null
  updatePayload.cancel_reason = status === 'CANCELLED' ? (cancelReason || null) : null
  updatePayload.refund_reason = status === 'REFUNDED' ? (refundReason || null) : null
  updatePayload.refund_amount = status === 'REFUNDED' ? refundAmount : null

  let query = supabase
    .from('broadcasts')
    .update(updatePayload)

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

  // Record history
  let historyReason = null
  if (status === 'ON_HOLD') historyReason = holdReason
  if (status === 'CANCELLED') historyReason = cancelReason
  if (status === 'REFUNDED') historyReason = refundReason ? `${refundReason} (Amount: ${refundAmount})` : `Amount: ${refundAmount}`

  await supabase.from('broadcast_status_history').insert([{
    broadcast_id: data.id,
    status,
    reason: historyReason
  }])

  return { success: true }
}

export async function resubmitFiles(formData: FormData) {
  const supabaseAuth = await createClient()
  const { data: { user } } = await supabaseAuth.auth.getUser()
  if (!user) return { error: 'Unauthorized' }

  const supabase = await createServiceRoleClient()

  const referenceNo = String(formData.get("id"))
  const newAudio = formData.get("audio") as File | null
  const newContacts = formData.get("contacts") as File | null

  if ((!newAudio || !newAudio.name || newAudio.size === 0) && (!newContacts || !newContacts.name || newContacts.size === 0)) {
    return { error: 'Please select at least one file to resubmit.' }
  }

  // Fetch the broadcast and verify ownership + ON_HOLD status
  let fetchQuery = supabase
    .from('broadcasts')
    .select('*')

  if (referenceNo.startsWith('BR-')) {
    fetchQuery = fetchQuery.eq('reference_no', referenceNo)
  } else {
    fetchQuery = fetchQuery.eq('id', referenceNo)
  }

  const { data: broadcast, error: fetchError } = await fetchQuery
    .eq('user_id', user.id)
    .single()

  if (fetchError || !broadcast) {
    return { error: 'Broadcast not found or access denied.' }
  }

  if (broadcast.status !== 'ON_HOLD') {
    return { error: 'Files can only be resubmitted when the order is on hold.' }
  }

  const updatePayload: any = {
    status: 'PLACED',
    hold_reason: null,
    updated_at: new Date().toISOString()
  }

  // Handle audio file replacement
  if (newAudio && newAudio.name && newAudio.size > 0) {
    const new_audio_key = `audio/${crypto.randomUUID()}-${newAudio.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`
    const { error: audioUpErr } = await supabase.storage.from('xpack_files').upload(new_audio_key, newAudio)
    if (audioUpErr) {
      console.error('Audio resubmit upload error:', audioUpErr)
      return { error: 'Failed to upload new audio file.' }
    }
    // Remove old audio file
    if (broadcast.audio_key) {
      await supabase.storage.from('xpack_files').remove([broadcast.audio_key])
    }
    updatePayload.audio_key = new_audio_key
  }

  // Handle contacts file replacement
  if (newContacts && newContacts.name && newContacts.size > 0) {
    const new_contacts_key = `contacts/${crypto.randomUUID()}-${newContacts.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`
    const { error: contactsUpErr } = await supabase.storage.from('xpack_files').upload(new_contacts_key, newContacts)
    if (contactsUpErr) {
      console.error('Contacts resubmit upload error:', contactsUpErr)
      return { error: 'Failed to upload new contacts file.' }
    }
    // Remove old contacts file
    if (broadcast.contacts_key) {
      await supabase.storage.from('xpack_files').remove([broadcast.contacts_key])
    }
    updatePayload.contacts_key = new_contacts_key
  }

  // Update broadcast: reset to PLACED, clear hold reason, update file keys
  const { error: updateError } = await supabase
    .from('broadcasts')
    .update(updatePayload)
    .eq('id', broadcast.id)

  if (updateError) {
    console.error('Resubmit update error:', updateError)
    return { error: 'Failed to update broadcast after resubmission.' }
  }

  // Record history
  await supabase.from('broadcast_status_history').insert([{
    broadcast_id: broadcast.id,
    status: 'PLACED',
    reason: 'Files resubmitted by customer'
  }])

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
