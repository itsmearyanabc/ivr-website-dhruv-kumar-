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

  const categoryId = String(formData.get("categoryId") || "")
  const categoryName = String(formData.get("categoryName") || "")
  const serviceId = String(formData.get("serviceId") || "")
  const serviceName = String(formData.get("serviceName") || "")
  const voiceType = String(formData.get("voiceType") || "MALE").toUpperCase()
  const notes = String(formData.get("notes") || "")
  const contactsInputType = String(formData.get("contactsInputType") || "FILE").toUpperCase()
  const manualContacts = String(formData.get("manualContacts") || "")
  const contactCount = formData.get("contactCount") ? parseInt(String(formData.get("contactCount")), 10) : 0
  // FIX: Securely recalculate charge based on service price in DB instead of trusting frontend
  let charge = 0;
  if (serviceId) {
    const { data: svc } = await supabase.from('services').select('price').eq('id', serviceId).single();
    if (svc) charge = Number(svc.price);
  }

  const audio = formData.get("audio") as File | null
  const contacts = formData.get("contacts") as File | null
  const audioInputMethod = String(formData.get("audioInputMethod") || "FILE")
  const ttsText = String(formData.get("ttsText") || "")

  // Validate audio input based on method
  if (audioInputMethod === 'FILE' && (!audio || !audio.name || audio.size === 0)) {
    return { error: 'Please upload an audio file.' }
  }
  if (audioInputMethod === 'TTS' && !ttsText.trim()) {
    return { error: 'Text to convert to speech is required.' }
  }

  if (contactsInputType === 'FILE' && (!contacts || !contacts.name || contacts.size === 0)) {
    return { error: 'Please upload a contact list file.' }
  }

  if (contactsInputType === 'MANUAL' && !manualContacts.trim()) {
    return { error: 'Please enter target phone numbers.' }
  }

  const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB
  if (audio && audio.size > MAX_FILE_SIZE) {
    return { error: 'Audio file exceeds 25 MB limit.' }
  }
  if (contacts && contacts.size > MAX_FILE_SIZE) {
    return { error: 'Contacts file exceeds 25 MB limit.' }
  }

  if (charge < 0 || isNaN(charge)) {
    return { error: 'Invalid charge amount.' }
  }

  // FIX Bug 1 & 3: Deduct balance FIRST using atomic safe_deduct_balance RPC
  // This prevents race conditions and ensures balance is deducted before order creation
  if (charge > 0) {
    const { data: deductResult, error: deductError } = await supabase.rpc('safe_deduct_balance', {
      uid: user.id,
      amt: charge
    })

    if (deductError) {
      console.error('Balance deduction RPC error:', deductError)
      // Fallback: read balance and check manually
      const { data: userProfile } = await supabase
        .from('users')
        .select('balance')
        .eq('id', user.id)
        .single()

      const currentBalance = userProfile ? Number(userProfile.balance) : 0
      if (currentBalance < charge) {
        return { error: `Insufficient funds. Wallet balance is ₹${currentBalance.toFixed(2)}, but order cost is ₹${charge.toFixed(2)}. Please add funds to proceed.` }
      }

      // Attempt atomic deduction via increment_balance with negative amount
      const { error: fallbackDeductError } = await supabase.rpc('increment_balance', {
        uid: user.id,
        amt: -charge
      })

      if (fallbackDeductError) {
        console.error('Fallback balance deduction error:', fallbackDeductError)
        return { error: `Insufficient funds or failed to deduct balance. Please try again.` }
      }
    } else {
      const resultData = Array.isArray(deductResult) ? deductResult[0] : deductResult;
      if (!resultData?.success) {
      // safe_deduct_balance returned success=false (insufficient funds)
      const currentBalance = Number(resultData?.new_balance || 0)
      return { error: `Insufficient funds. Wallet balance is ₹${currentBalance.toFixed(2)}, but order cost is ₹${charge.toFixed(2)}. Please add funds to proceed.` }
    }
    }
  }

  // Upload Audio to Supabase Storage or store TTS text
  let audio_key: string
  if (audioInputMethod === 'TTS') {
    // For TTS, store the text as a .txt file
    const ttsBlob = new Blob([ttsText], { type: 'text/plain' })
    const ttsFile = new File([ttsBlob], `tts-${Date.now()}.txt`, { type: 'text/plain' })
    audio_key = `audio/tts-${crypto.randomUUID()}.txt`
    const audioUpload = await supabase.storage.from('xpack_files').upload(audio_key, ttsFile)
    if (audioUpload.error) {
      console.error('TTS Upload Error:', audioUpload.error)
      if (charge > 0) {
        await supabase.rpc('increment_balance', { uid: user.id, amt: charge })
      }
      return { error: 'Failed to save text for speech conversion.' }
    }
  } else {
    // For file upload
    if (!audio) {
      return { error: 'Audio file is required.' }
    }
    audio_key = `audio/${crypto.randomUUID()}-${audio.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`
    const audioUpload = await supabase.storage.from('xpack_files').upload(audio_key, audio)
    if (audioUpload.error) {
      console.error('Audio Upload Error:', audioUpload.error)
      // FIX Bug 3: Refund balance since we already deducted but upload failed
      if (charge > 0) {
        await supabase.rpc('increment_balance', { uid: user.id, amt: charge })
      }
      return { error: 'Failed to upload audio file.' }
    }
  }

  // Upload Contacts if file input type
  let contacts_key: string | null = null
  if (contactsInputType === 'FILE' && contacts && contacts.name) {
    contacts_key = `contacts/${crypto.randomUUID()}-${contacts.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`
    const contactsUpload = await supabase.storage.from('xpack_files').upload(contacts_key, contacts)
    if (contactsUpload.error) {
      console.error('Contacts Upload Error:', contactsUpload.error)
      await supabase.storage.from('xpack_files').remove([audio_key])
      // FIX Bug 3: Refund balance since we already deducted but upload failed
      if (charge > 0) {
        await supabase.rpc('increment_balance', { uid: user.id, amt: charge })
      }
      return { error: 'Failed to upload contacts file.' }
    }
  }

  const reference_no = `BR-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`
  const schedule = String(formData.get("schedule") || "")
  const scheduled_for = schedule && schedule !== 'Start on processing' ? new Date(schedule).toISOString() : null
  const broadcastName = serviceName ? `${categoryName} - ${serviceName}` : `Broadcast ${reference_no}`

  const { data, error } = await supabase
    .from('broadcasts')
    .insert([
      {
        user_id: user.id,
        reference_no,
        name: broadcastName,
        category_id: categoryId || null,
        service_id: serviceId || null,
        category_name: categoryName || null,
        service_name: serviceName || null,
        voice_type: voiceType,
        description: notes,
        audio_key,
        contacts_input_type: contactsInputType,
        contacts_key,
        manual_contacts: contactsInputType === 'MANUAL' ? manualContacts : null,
        contact_count: contactCount,
        charge,
        scheduled_for,
        status: 'PLACED'
      }
    ])
    .select()
    .single()

  if (error) {
    console.error('Create Broadcast Error:', error)
    // Cleanup uploaded files
    await supabase.storage.from('xpack_files').remove([audio_key])
    if (contacts_key) await supabase.storage.from('xpack_files').remove([contacts_key])
    // FIX Bug 3: Refund balance since we already deducted but insert failed
    if (charge > 0) {
      await supabase.rpc('increment_balance', { uid: user.id, amt: charge })
    }
    return { error: 'Failed to create broadcast order' }
  }

  // Insert initial history record
  await supabase.from('broadcast_status_history').insert([{
    broadcast_id: data.id,
    status: 'PLACED'
  }])

  // Record the debit transaction (balance was already deducted above)
  if (charge > 0) {
    await supabase.from('transactions').insert([{
      user_id: user.id,
      amount: charge,
      type: 'DEBIT',
      status: 'SUCCESS',
      order_id: reference_no
    }])
  }

  return { data }
}

export async function updateBroadcastStatus(formData: FormData) {
  const isAdmin = await checkIsAdmin()
  if (!isAdmin) return { error: 'Unauthorized' }
  const supabase = await createServiceRoleClient()

  const id = String(formData.get("id"))
  const status = String(formData.get("status")).toUpperCase()
  const validBroadcastStatuses = ['PLACED', 'IN_PROGRESS', 'COMPLETED', 'PARTIAL', 'CANCELLED', 'ON_HOLD', 'REFUNDED']
  if (!validBroadcastStatuses.includes(status)) {
    return { error: 'Invalid status value.' }
  }
  const reportFile = formData.get("report") as File | null
  const holdReason = String(formData.get("holdReason") || "")
  const cancelReason = String(formData.get("cancelReason") || "")
  const refundReason = String(formData.get("refundReason") || "")
  const adminComment = String(formData.get("adminComment") || "")

  const partialRefundStr = String(formData.get("partialRefundAmount") || "")
  const confirmPartialRefundStr = String(formData.get("confirmPartialRefundAmount") || "")

  let partialRefundAmount: number | null = null
  if (partialRefundStr || confirmPartialRefundStr) {
    const val1 = parseFloat(partialRefundStr)
    const val2 = parseFloat(confirmPartialRefundStr)
    if (isNaN(val1) || isNaN(val2) || val1 !== val2 || val1 < 0) {
      return { error: 'Partial refund amount and confirmation refund amount must match exactly and be valid non-negative numbers.' }
    }
    if (val1 > 0) {
      partialRefundAmount = val1
    }
  }

  // Fetch the broadcast first to get original charge and current status
  let fetchQuery = supabase.from('broadcasts').select('*')
  if (id.startsWith('BR-')) {
    fetchQuery = fetchQuery.eq('reference_no', id)
  } else {
    fetchQuery = fetchQuery.eq('id', id)
  }
  const { data: existingBroadcast, error: fetchErr } = await fetchQuery.single()

  if (fetchErr || !existingBroadcast) {
    return { error: 'Broadcast not found.' }
  }

  const originalCharge = Number(existingBroadcast.charge || 0)

  // FIX Bug 6: Validate partial refund amount doesn't exceed original charge
  if (partialRefundAmount !== null && partialRefundAmount > originalCharge) {
    return { error: `Partial refund amount (₹${partialRefundAmount.toFixed(2)}) cannot exceed the original charge (₹${originalCharge.toFixed(2)}).` }
  }

  // FIX Bug 2 & 9: Prevent invalid double-refunds
  const currentStatus = existingBroadcast.status
  const alreadyRefundedStatuses = ['CANCELLED', 'REFUNDED']
  if (alreadyRefundedStatuses.includes(currentStatus) && alreadyRefundedStatuses.includes(status)) {
    return { error: `Broadcast is already ${currentStatus}. Cannot change to ${status}.` }
  }

  const updatePayload: any = { status, updated_at: new Date().toISOString() }
  
  updatePayload.hold_reason = status === 'ON_HOLD' ? (holdReason || null) : null
  updatePayload.cancel_reason = status === 'CANCELLED' ? (cancelReason || null) : null
  updatePayload.refund_reason = status === 'REFUNDED' ? (refundReason || null) : null
  if (adminComment) updatePayload.admin_comment = adminComment
  if (partialRefundAmount !== null) updatePayload.partial_refund_amount = partialRefundAmount

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

  // Handle report file upload for COMPLETED or PARTIAL
  if ((status === 'COMPLETED' || status === 'PARTIAL') && reportFile && reportFile.size > 0) {
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

  // FIX Bug 2: Auto full refund on CANCELLED status
  if (status === 'CANCELLED' && originalCharge > 0) {
    const { error: creditError } = await supabase.rpc('increment_balance', {
      uid: data.user_id,
      amt: originalCharge
    })

    if (creditError) {
      console.error('Cancel refund increment_balance error:', creditError)
      const { data: owner } = await supabase
        .from('users')
        .select('balance')
        .eq('id', data.user_id)
        .single()

      if (owner) {
        await supabase
          .from('users')
          .update({ balance: Number(owner.balance) + originalCharge })
          .eq('id', data.user_id)
      }
    }

    // Record credit transaction for cancellation refund
    await supabase.from('transactions').insert([{
      user_id: data.user_id,
      amount: originalCharge,
      type: 'CREDIT',
      status: 'SUCCESS',
      order_id: data.reference_no
    }])
  }

  // FIX Bug 9: Auto full refund on REFUNDED status (if no partial refund specified)
  if (status === 'REFUNDED' && originalCharge > 0 && partialRefundAmount === null) {
    const { error: creditError } = await supabase.rpc('increment_balance', {
      uid: data.user_id,
      amt: originalCharge
    })

    if (creditError) {
      console.error('Refund increment_balance error:', creditError)
      const { data: owner } = await supabase
        .from('users')
        .select('balance')
        .eq('id', data.user_id)
        .single()

      if (owner) {
        await supabase
          .from('users')
          .update({ balance: Number(owner.balance) + originalCharge })
          .eq('id', data.user_id)
      }
    }

    // Record credit transaction for full refund
    await supabase.from('transactions').insert([{
      user_id: data.user_id,
      amount: originalCharge,
      type: 'CREDIT',
      status: 'SUCCESS',
      order_id: data.reference_no
    }])
  }

  // Process partial refund credit to user wallet if partial refund amount > 0
  if (partialRefundAmount && partialRefundAmount > 0) {
    const { error: creditError } = await supabase.rpc('increment_balance', {
      uid: data.user_id,
      amt: partialRefundAmount
    })

    if (creditError) {
      console.error('Partial refund increment_balance error:', creditError)
      // FIX Bug 5: Re-read balance right before fallback to avoid stale value
      const { data: owner } = await supabase
        .from('users')
        .select('balance')
        .eq('id', data.user_id)
        .single()

      if (owner) {
        const freshBalance = Number(owner.balance)
        await supabase
          .from('users')
          .update({ balance: freshBalance + partialRefundAmount })
          .eq('id', data.user_id)
      }
    }

    // Record credit transaction
    await supabase.from('transactions').insert([{
      user_id: data.user_id,
      amount: partialRefundAmount,
      type: 'CREDIT',
      status: 'SUCCESS',
      order_id: data.reference_no
    }])
  }

  // Record history
  let historyReason = adminComment || null
  if (status === 'ON_HOLD') historyReason = holdReason
  if (status === 'CANCELLED') historyReason = cancelReason
  if (status === 'REFUNDED') historyReason = refundReason ? `${refundReason} (Amount: ₹${originalCharge.toFixed(2)})` : `Full refund: ₹${originalCharge.toFixed(2)}`
  if (partialRefundAmount && partialRefundAmount > 0) {
    historyReason = `Partial refund processed: ₹${partialRefundAmount.toFixed(2)}. ${adminComment || ''}`
  }

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
    // FIX Bug 11: Check ownership via broadcast user_id for audio/contacts
    const { data: ownedBroadcasts } = await supabase
      .from('broadcasts')
      .select('id')
      .eq('user_id', user.id)
      .or(`audio_key.eq.${path},contacts_key.eq.${path}`)
      .limit(1)

    // Check report ownership via broadcast join
    const { data: ownedReports } = await supabase
      .from('reports')
      .select('broadcast_id, broadcasts!inner(user_id)')
      .eq('file_key', path)
      .eq('broadcasts.user_id', user.id)
      .limit(1)
    
    const isOwner = (ownedBroadcasts && ownedBroadcasts.length > 0) || (ownedReports && ownedReports.length > 0)
    
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