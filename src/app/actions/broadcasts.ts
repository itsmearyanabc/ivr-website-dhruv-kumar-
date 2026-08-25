/* eslint-disable @typescript-eslint/no-explicit-any */
'use server'

import { createClient, createAdminClient, createServiceRoleClient } from '@/lib/supabase/server'
import { checkIsAdmin } from '@/app/actions/auth'
import { logActivity, describeActor } from '@/app/actions/activity'
import { STORAGE_BUCKET } from '@/lib/uploads'
import { consumeUploadedKey, discardUpload } from '@/lib/storage'
import { resolveServicePrice } from '@/lib/pricing'
import { calculateFailedCallRefund } from '@/lib/refunds'
import { hasDeliveryCountColumns } from '@/lib/supabase/schema'
import { guard } from '@/lib/errors'

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
  return guard('createBroadcast', () => runCreateBroadcast(formData))
}

async function runCreateBroadcast(formData: FormData) {
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
  // FIX: Securely recalculate charge based on service price in DB instead of trusting frontend.
  // resolveServicePrice also applies this customer's own price where one is set, and refuses
  // a service that is hidden from them - so the catalogue they were shown is the catalogue
  // they can actually buy from.
  let charge = 0;
  if (serviceId) {
    const resolved = await resolveServicePrice(supabase, user.id, serviceId)
    if (!resolved.ok) return { error: resolved.error }
    charge = resolved.price
  }

  // The browser uploads straight to Supabase Storage and posts the resulting keys here, so
  // this action never handles file bytes and cannot trip the Server Action body limit.
  const audioUploadKey = String(formData.get("audioKey") || "")
  const contactsUploadKey = String(formData.get("contactsKey") || "")
  const audioInputMethod = String(formData.get("audioInputMethod") || "FILE")
  const ttsText = String(formData.get("ttsText") || "")

  // Validate audio input based on method
  if (audioInputMethod === 'FILE' && !audioUploadKey) {
    return { error: 'Please upload an audio file.' }
  }
  if (audioInputMethod === 'TTS' && !ttsText.trim()) {
    return { error: 'Text to convert to speech is required.' }
  }

  if (contactsInputType === 'FILE' && !contactsUploadKey) {
    return { error: 'Please upload a contact list file.' }
  }

  if (contactsInputType === 'MANUAL' && !manualContacts.trim()) {
    return { error: 'Please enter target phone numbers.' }
  }

  if (charge < 0 || isNaN(charge)) {
    return { error: 'Invalid charge amount.' }
  }

  // Prove the keys the browser handed back are this customer's own objects, exist, and are
  // within the size limit, before any money moves.
  if (audioUploadKey) {
    const check = await consumeUploadedKey('audio', audioUploadKey, user.id)
    if (!check.ok) return { error: check.error }
  }
  if (contactsUploadKey) {
    const check = await consumeUploadedKey('contacts', contactsUploadKey, user.id)
    if (!check.ok) return { error: check.error }
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

  // The audio and contact files are already in storage by the time this runs. Only the TTS
  // text still needs writing, and that is a few kilobytes of plain text.
  let audio_key: string
  if (audioInputMethod === 'TTS') {
    const ttsBlob = new Blob([ttsText], { type: 'text/plain' })
    const ttsFile = new File([ttsBlob], `tts-${Date.now()}.txt`, { type: 'text/plain' })
    audio_key = `audio/${user.id}/tts-${crypto.randomUUID()}.txt`
    const audioUpload = await supabase.storage.from(STORAGE_BUCKET).upload(audio_key, ttsFile)
    if (audioUpload.error) {
      console.error('TTS Upload Error:', audioUpload.error)
      // FIX Bug 3: Refund balance since we already deducted but the write failed
      if (charge > 0) {
        await supabase.rpc('increment_balance', { uid: user.id, amt: charge })
      }
      return { error: 'Failed to save text for speech conversion.' }
    }
  } else {
    audio_key = audioUploadKey
  }

  const contacts_key: string | null = contactsInputType === 'FILE' ? contactsUploadKey : null

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
    // Cleanup uploaded files so a failed order does not leave orphans in the bucket
    await discardUpload(audio_key)
    await discardUpload(contacts_key)
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

  await logActivity({
    ...(await describeActor(user.id)),
    actionType: 'ORDER_CREATED',
    entityType: 'BROADCAST',
    entityId: reference_no,
    description: `New broadcast ${reference_no} placed: ${broadcastName} (${contactCount} contacts, Rs ${charge.toFixed(2)}).`,
    metadata: { charge, contactCount, categoryName, serviceName, voiceType },
  })

  return { data }
}

/**
 * Moves money into a customer wallet, preferring the atomic RPC and falling back to a
 * re-read + write only when the RPC itself is unavailable. Returns false when even the
 * fallback failed, so the caller can refuse to record a transaction that never happened.
 */
async function creditWallet(
  supabase: Awaited<ReturnType<typeof createServiceRoleClient>>,
  userId: string,
  amount: number,
): Promise<boolean> {
  if (!(amount > 0)) return true

  const { error } = await supabase.rpc('increment_balance', { uid: userId, amt: amount })
  if (!error) return true

  console.error('increment_balance failed, falling back to read-then-write:', error)
  const { data: owner } = await supabase
    .from('users')
    .select('balance')
    .eq('id', userId)
    .single()

  if (!owner) return false

  const { error: writeError } = await supabase
    .from('users')
    .update({ balance: Number(owner.balance) + amount })
    .eq('id', userId)

  if (writeError) {
    console.error('Fallback wallet credit failed:', writeError)
    return false
  }
  return true
}

export async function updateBroadcastStatus(formData: FormData) {
  return guard('updateBroadcastStatus', () => runUpdateBroadcastStatus(formData))
}

async function runUpdateBroadcastStatus(formData: FormData) {
  const isAdmin = await checkIsAdmin()
  if (!isAdmin) return { error: 'Unauthorized' }

  const supabaseAuth = await createClient()
  const { data: { user: actor } } = await supabaseAuth.auth.getUser()
  if (!actor) return { error: 'Your session expired. Please sign in again.' }
  const adminUserId = actor.id

  const supabase = await createServiceRoleClient()

  const id = String(formData.get("id"))
  const status = String(formData.get("status")).toUpperCase()
  const validBroadcastStatuses = ['PLACED', 'IN_PROGRESS', 'COMPLETED', 'PARTIAL', 'CANCELLED', 'ON_HOLD', 'REFUNDED']
  if (!validBroadcastStatuses.includes(status)) {
    return { error: 'Invalid status value.' }
  }
  // Already uploaded straight to storage by the browser; this is just the key.
  const reportUploadKey = String(formData.get("reportKey") || "")
  const holdReason = String(formData.get("holdReason") || "")
  const cancelReason = String(formData.get("cancelReason") || "")
  const refundReason = String(formData.get("refundReason") || "")
  const adminComment = String(formData.get("adminComment") || "")

  // Delivery counts read off the fulfilment report. When these are present the refund is
  // derived from them and the typed amount below is ignored entirely - the operator enters
  // how many calls failed, not how many rupees to hand back.
  const deliveredCallsStr = String(formData.get("deliveredCalls") || "")
  const failedCallsStr = String(formData.get("failedCalls") || "")
  const hasCallCounts = deliveredCallsStr !== "" || failedCallsStr !== ""

  let deliveredCalls: number | null = null
  let failedCalls: number | null = null
  if (hasCallCounts) {
    deliveredCalls = Number.parseInt(deliveredCallsStr || "0", 10)
    failedCalls = Number.parseInt(failedCallsStr || "0", 10)
    if (!Number.isInteger(deliveredCalls) || !Number.isInteger(failedCalls) || deliveredCalls < 0 || failedCalls < 0) {
      return { error: 'Delivered and failed call counts must be whole numbers, zero or more.' }
    }
  }

  const partialRefundStr = String(formData.get("partialRefundAmount") || "")
  const confirmPartialRefundStr = String(formData.get("confirmPartialRefundAmount") || "")

  let partialRefundAmount: number | null = null
  if (!hasCallCounts && (partialRefundStr || confirmPartialRefundStr)) {
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
  const currentStatus = existingBroadcast.status

  // FIX Bug 2 & 9: Prevent invalid double-refunds
  const alreadyRefundedStatuses = ['CANCELLED', 'REFUNDED']
  if (alreadyRefundedStatuses.includes(currentStatus) && alreadyRefundedStatuses.includes(status)) {
    return { error: `Broadcast is already ${currentStatus}. Cannot change to ${status}.` }
  }

  // Two separate questions that used to share one flag.
  //
  // A report can be attached whenever the run is being closed out, COMPLETED or PARTIAL - a
  // fully delivered campaign still gets its report.
  //
  // A partial refund only belongs on PARTIAL. COMPLETED means every call landed, so there is
  // nothing to give back; and carrying an amount into a CANCELLED or REFUNDED save paid the
  // customer the partial amount *and* the full charge.
  const allowsReport = status === 'COMPLETED' || status === 'PARTIAL'
  const allowsPartialRefund = status === 'PARTIAL'
  if (!allowsPartialRefund) partialRefundAmount = null

  // The transaction ledger - not the order row - is the authority on what has already been
  // paid back. Every refund path below writes a CREDIT against the order reference, so this
  // sum stays correct across repeated saves and across status round-trips, which is what
  // stopped a second click on "Save & process fulfilment" from crediting the refund twice.
  const { data: priorCredits, error: creditsError } = await supabase
    .from('transactions')
    .select('amount')
    .eq('order_id', existingBroadcast.reference_no)
    .eq('type', 'CREDIT')
    .eq('status', 'SUCCESS')

  if (creditsError) {
    console.error('Refund history lookup failed:', creditsError)
    return { error: 'Could not verify what has already been refunded on this order. No changes were made.' }
  }

  const alreadyRefunded = (priorCredits || []).reduce((sum: number, row: any) => sum + Number(row.amount || 0), 0)
  const refundableRemaining = Math.max(0, Number((originalCharge - alreadyRefunded).toFixed(2)))

  // The refund is recomputed here from the call counts, never taken from the browser. The
  // admin screen runs the same function to preview the figure, so what they approved and
  // what gets credited are the same number - but this is the one that moves money.
  if (hasCallCounts && allowsPartialRefund) {
    const breakdown = calculateFailedCallRefund(
      originalCharge,
      deliveredCalls as number,
      failedCalls as number,
      refundableRemaining,
    )
    if (!breakdown.ok) return { error: breakdown.error }
    partialRefundAmount = breakdown.refund > 0 ? breakdown.refund : null
  } else if (hasCallCounts && !allowsPartialRefund) {
    // Counts recorded against a status that does not refund - keep the numbers on the row
    // for the record, but move no money.
    partialRefundAmount = null
  }

  if (partialRefundAmount !== null && partialRefundAmount > refundableRemaining) {
    return {
      error: alreadyRefunded > 0
        ? `Only ₹${refundableRemaining.toFixed(2)} of the ₹${originalCharge.toFixed(2)} charge is still refundable — ₹${alreadyRefunded.toFixed(2)} has already been credited back.`
        : `Partial refund amount (₹${partialRefundAmount.toFixed(2)}) cannot exceed the original charge (₹${originalCharge.toFixed(2)}).`
    }
  }

  // Confirm the report actually landed in storage BEFORE the status moves. Attaching it
  // afterwards meant a failed upload left the order sitting at Completed with no report and
  // no way to tell from the row.
  let reportKey: string | null = null
  if (allowsReport && reportUploadKey) {
    const check = await consumeUploadedKey('report', reportUploadKey, adminUserId)
    if (!check.ok) return { error: `${check.error} The order status was not changed.` }
    reportKey = reportUploadKey
  } else if (reportUploadKey) {
    // The browser uploads before submitting, so a report picked against a status that cannot
    // carry one is already sitting in the bucket. Drop it rather than leaving it to count
    // against the storage quota forever with nothing pointing at it.
    await discardUpload(reportUploadKey)
  }

  const updatePayload: any = { status, updated_at: new Date().toISOString() }

  updatePayload.hold_reason = status === 'ON_HOLD' ? (holdReason || null) : null
  updatePayload.cancel_reason = status === 'CANCELLED' ? (cancelReason || null) : null
  updatePayload.refund_reason = status === 'REFUNDED' ? (refundReason || null) : null
  if (adminComment) updatePayload.admin_comment = adminComment

  // Full refunds only return what is still owed, so an order that was already partly
  // refunded and is then cancelled cannot pay out more than the customer was charged.
  const fullRefundAmount = alreadyRefundedStatuses.includes(status) ? refundableRemaining : 0
  const creditAmount = partialRefundAmount && partialRefundAmount > 0 ? partialRefundAmount : fullRefundAmount

  if (partialRefundAmount !== null) {
    updatePayload.partial_refund_amount = Number(
      (Number(existingBroadcast.partial_refund_amount || 0) + partialRefundAmount).toFixed(2)
    )
  }

  // Keep the numbers the refund was derived from on the order, so the credit can be checked
  // against the report later without re-reading the attachment. Skipped on a database where
  // the migration has not run - the refund itself does not depend on these being stored.
  if (hasCallCounts && await hasDeliveryCountColumns()) {
    updatePayload.delivered_calls = deliveredCalls
    updatePayload.failed_calls = failedCalls
  }

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
    if (reportKey) await supabase.storage.from(STORAGE_BUCKET).remove([reportKey])
    return { error: 'Failed to update broadcast' }
  }

  if (reportKey) {
    // Note the file being replaced before the row points somewhere else, otherwise the old
    // blob is orphaned in the bucket forever - which adds up fast against a 1 GB quota.
    const { data: previousReport } = await supabase
      .from('reports')
      .select('file_key')
      .eq('broadcast_id', data.id)
      .maybeSingle()

    const { error: upsertError } = await supabase
      .from('reports')
      .upsert({ broadcast_id: data.id, file_key: reportKey }, { onConflict: 'broadcast_id' })

    if (upsertError) {
      console.error('Report Upsert Error:', upsertError)
      await supabase.storage.from(STORAGE_BUCKET).remove([reportKey])
      return { error: 'The status was updated, but the report could not be attached. Please re-upload it.' }
    }

    if (previousReport?.file_key && previousReport.file_key !== reportKey) {
      await supabase.storage.from(STORAGE_BUCKET).remove([previousReport.file_key])
    }
  }

  // One credit path for every refund flavour: a full return on cancel/refund, or the partial
  // amount an admin typed against a completed run. Never both.
  if (creditAmount > 0) {
    const credited = await creditWallet(supabase, data.user_id, creditAmount)

    if (credited) {
      await supabase.from('transactions').insert([{
        user_id: data.user_id,
        amount: creditAmount,
        type: 'CREDIT',
        status: 'SUCCESS',
        order_id: data.reference_no
      }])
    } else {
      // No ledger row without a balance move - a phantom CREDIT would make the next save
      // think this money was already returned and silently short the customer.
      console.error('Refund credit failed for broadcast', data.reference_no)
      return { error: `The status was updated, but the ₹${creditAmount.toFixed(2)} refund could not be credited. Please credit it manually from the customer directory.` }
    }
  }

  // Record history
  let historyReason = adminComment || null
  if (status === 'ON_HOLD') historyReason = holdReason
  if (status === 'CANCELLED') historyReason = cancelReason || null
  if (status === 'REFUNDED') historyReason = refundReason || null
  if (fullRefundAmount > 0) {
    historyReason = `${historyReason ? `${historyReason}. ` : ''}Refunded ₹${fullRefundAmount.toFixed(2)} to the customer wallet.`
  }
  if (partialRefundAmount && partialRefundAmount > 0) {
    // Say what the customer is owed for and why, not just the figure - the call counts are
    // the whole justification for the amount.
    const basis = hasCallCounts
      ? ` ${failedCalls} of ${(deliveredCalls as number) + (failedCalls as number)} calls failed.`
      : ''
    historyReason = `Partial refund processed: ₹${partialRefundAmount.toFixed(2)}.${basis}${adminComment ? ` ${adminComment}` : ''}`
  }

  await supabase.from('broadcast_status_history').insert([{
    broadcast_id: data.id,
    status,
    reason: historyReason
  }])

  await logActivity({
    ...(await describeActor(adminUserId)),
    actionType: 'ORDER_UPDATED',
    entityType: 'BROADCAST',
    entityId: data.reference_no,
    description: `Broadcast ${data.reference_no} moved from ${currentStatus} to ${status}${
      partialRefundAmount ? ` with a Rs ${partialRefundAmount.toFixed(2)} partial refund` : ''
    }.`,
    metadata: { from: currentStatus, to: status, partialRefundAmount },
  })

  return { success: true }
}

export async function resubmitFiles(formData: FormData) {
  return guard('resubmitFiles', () => runResubmitFiles(formData))
}

async function runResubmitFiles(formData: FormData) {
  const supabaseAuth = await createClient()
  const { data: { user } } = await supabaseAuth.auth.getUser()
  if (!user) return { error: 'Unauthorized' }

  const supabase = await createServiceRoleClient()

  const referenceNo = String(formData.get("id"))
  const newAudioKey = String(formData.get("audioKey") || "")
  const newContactsKey = String(formData.get("contactsKey") || "")

  if (!newAudioKey && !newContactsKey) {
    return { error: 'Please select at least one file to resubmit.' }
  }

  // The create path validated its uploads but the resubmit path did not, so a file rejected
  // at order time could be slipped in afterwards through the on-hold flow.
  if (newAudioKey) {
    const check = await consumeUploadedKey('audio', newAudioKey, user.id)
    if (!check.ok) return { error: check.error }
  }
  if (newContactsKey) {
    const check = await consumeUploadedKey('contacts', newContactsKey, user.id)
    if (!check.ok) return { error: check.error }
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

  if (newAudioKey) updatePayload.audio_key = newAudioKey
  if (newContactsKey) updatePayload.contacts_key = newContactsKey

  // Update broadcast: reset to PLACED, clear hold reason, update file keys
  const { error: updateError } = await supabase
    .from('broadcasts')
    .update(updatePayload)
    .eq('id', broadcast.id)

  if (updateError) {
    console.error('Resubmit update error:', updateError)
    // The new uploads are orphans now - the order still points at the originals.
    if (newAudioKey) await discardUpload(newAudioKey)
    if (newContactsKey) await discardUpload(newContactsKey)
    return { error: 'Failed to update broadcast after resubmission.' }
  }

  // Only once the row points at the replacements is it safe to drop the originals.
  if (newAudioKey && broadcast.audio_key) await discardUpload(broadcast.audio_key)
  if (newContactsKey && broadcast.contacts_key) await discardUpload(broadcast.contacts_key)

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

  const { data, error } = await supabase.storage.from(STORAGE_BUCKET).createSignedUrl(path, 60 * 60) // 1 hour

  if (error || !data) {
    return { error: 'Failed to generate download link' }
  }
  return { url: data.signedUrl }
}