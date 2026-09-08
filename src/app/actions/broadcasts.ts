/* eslint-disable @typescript-eslint/no-explicit-any */
'use server'

import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { checkIsAdmin } from '@/app/actions/auth'
import { logActivity, describeActor } from '@/lib/activity'
import { STORAGE_BUCKET } from '@/lib/uploads'
import { consumeUploadedKey, discardUpload } from '@/lib/storage'
import { resolveServicePrice, serviceIsQuantityPriced } from '@/lib/pricing'
import { countNumbers } from '@/lib/quantity'
import { countContactsInFile } from '@/lib/contacts'
import { calculateFailedCallRefund } from '@/lib/refunds'
import { hasDeliveryCountColumns } from '@/lib/supabase/schema'
import { guard } from '@/lib/errors'
import { getAuthUser } from '@/lib/session'

/**
 * The columns the orders list actually renders.
 *
 * Named explicitly rather than selected with `*` for one reason: `manual_contacts` holds the
 * customer's entire pasted number list, and `*` shipped every one of them, for every order,
 * on every load of the panel. Under quantity pricing a single order can carry tens of
 * thousands of numbers, so that column alone would come to dominate the payload of a screen
 * that only ever shows a count. It is fetched on demand instead, by `getBroadcastContacts`,
 * when an operator actually opens the order.
 *
 * Anything added here must exist on every database this code can reach - a column that does
 * not fails the whole query rather than coming back null - which is why the delivery counts
 * are appended separately below, behind their schema probe.
 */
const BROADCAST_LIST_COLUMNS = [
  'id',
  'user_id',
  'reference_no',
  'name',
  'status',
  'created_at',
  'scheduled_for',
  'description',
  'audio_key',
  'contacts_key',
  'contacts_input_type',
  'contact_count',
  'charge',
  'category_name',
  'service_name',
  'voice_type',
  'hold_reason',
  'cancel_reason',
  'refund_reason',
  'refund_amount',
  'partial_refund_amount',
  'admin_comment',
].join(',')

export async function getBroadcasts() {
  const isAdmin = await checkIsAdmin()

  const user = await getAuthUser()
  if (!user) return { error: 'Unauthorized' }

  const supabase = await createServiceRoleClient()

  const columns = (await hasDeliveryCountColumns())
    ? `${BROADCAST_LIST_COLUMNS},delivered_calls,failed_calls`
    : BROADCAST_LIST_COLUMNS

  let query = supabase
    .from('broadcasts')
    .select(`
      ${columns},
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

  const formatted = broadcasts?.map((b: any) => ({
    ...b,
    customer: b.users?.company_name || 'Unknown',
    email: b.users?.email || 'Unknown',
  }))

  return { data: formatted }
}

/**
 * The status timeline for one order, fetched only when someone opens it.
 *
 * Kept out of `getBroadcasts` for the same reason as `manual_contacts`: it is a one-to-many
 * join, so every order multiplied its own row by however many transitions it had been
 * through, and the list screen never shows any of them - only the order modal does. On a
 * panel holding a few thousand orders that join was the bulk of the payload of the heaviest
 * query in the app, and it ran on every load.
 *
 * Access is the same as for the order itself: the owner, or an admin.
 */
export async function getBroadcastHistory(referenceNo: string) {
  const isAdmin = await checkIsAdmin()

  const user = await getAuthUser()
  if (!user) return { error: 'Unauthorized' }

  const supabase = await createServiceRoleClient()

  // Scoped to the caller for a customer, so a guessed reference returns nothing rather than
  // somebody else's fulfilment history.
  let owner = supabase.from('broadcasts').select('id').eq('reference_no', referenceNo)
  if (!isAdmin) owner = owner.eq('user_id', user.id)

  const { data: order, error: ownerError } = await owner.maybeSingle()
  if (ownerError || !order) return { data: [] }

  const { data, error } = await supabase
    .from('broadcast_status_history')
    .select('status, reason, created_at')
    .eq('broadcast_id', order.id)
    .order('created_at', { ascending: true })

  if (error) {
    console.error('getBroadcastHistory error:', error)
    return { error: 'Could not load the status history for this order.' }
  }

  return { data: data || [] }
}

/**
 * The pasted number list for one order, fetched only when someone opens it.
 *
 * Kept out of `getBroadcasts` because it is by far the largest column on the row and the list
 * screen never shows it. Access is the same as for the order itself: the owner, or an admin.
 */
export async function getBroadcastContacts(referenceNo: string) {
  const isAdmin = await checkIsAdmin()

  const user = await getAuthUser()
  if (!user) return { error: 'Unauthorized' }

  const supabase = await createServiceRoleClient()

  let query = supabase
    .from('broadcasts')
    .select('manual_contacts')
    .eq('reference_no', referenceNo)

  // Scoped to the caller for a customer, so a guessed reference number returns nothing rather
  // than someone else's contact list.
  if (!isAdmin) query = query.eq('user_id', user.id)

  const { data, error } = await query.maybeSingle()

  if (error) {
    console.error('getBroadcastContacts error:', error)
    return { error: 'Could not load the phone numbers for this order.' }
  }

  return { data: data?.manual_contacts || '' }
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
  // What the browser thought the list held. Kept only to be compared against the real count
  // below - a quantity-priced order is never billed on this number.
  const claimedContactCount = formData.get("contactCount") ? parseInt(String(formData.get("contactCount")), 10) : 0

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

  // Prove the keys the browser handed back are this customer's own objects, exist, and are
  // within the size limit, before any money moves.
  if (audioUploadKey) {
    const check = await consumeUploadedKey('audio', audioUploadKey, user.id)
    if (!check.ok) return { error: check.error }
  }

  let contactsSize = 0
  if (contactsUploadKey) {
    const check = await consumeUploadedKey('contacts', contactsUploadKey, user.id)
    if (!check.ok) return { error: check.error }
    contactsSize = check.size
  }

  // ---------------------------------------------------------------------------------------
  // How many numbers this order actually targets.
  // ---------------------------------------------------------------------------------------
  // Under quantity pricing this is the multiplier on the charge, so it is counted here rather
  // than accepted from the form: the modal counts as the customer types purely so it can show
  // a running total. Pasted numbers are counted with the same parser the browser used, so the
  // two agree; an uploaded list is read back out of storage.
  let contactCount = claimedContactCount
  if (contactsInputType === 'MANUAL') {
    contactCount = countNumbers(manualContacts)
    if (contactCount <= 0) {
      return { error: 'No phone numbers were found in what you entered. Enter one number per line.' }
    }
  } else if (contactsUploadKey) {
    const counted = await countContactsInFile(contactsUploadKey, contactsSize)
    if (!counted.ok) {
      // Counting only has to succeed for a service that bills on it. A flat-priced service is
      // charged the same whatever the list holds, so an unreadable format (a PDF the operator
      // will open by hand, say) must not block the order the way it did not before.
      const billsOnQuantity = serviceId ? await serviceIsQuantityPriced(supabase, serviceId) : false
      if (billsOnQuantity) return { error: counted.error }
      contactCount = claimedContactCount
    } else {
      contactCount = counted.count
    }
  }

  // FIX: Securely recalculate charge based on service price in DB instead of trusting frontend.
  // resolveServicePrice also applies this customer's own price where one is set, refuses a
  // service that is hidden from them, and enforces the service's own min/max order quantity -
  // so the catalogue they were shown is the catalogue they can actually buy from, at the
  // quantity it allows.
  let charge = 0;
  if (serviceId) {
    const resolved = await resolveServicePrice(supabase, user.id, serviceId, contactCount)
    if (!resolved.ok) return { error: resolved.error }
    charge = resolved.price
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

  // Sequential 4-digit ID: "BR-0001"
  const { data: maxBroadcast } = await supabase
    .from('broadcasts')
    .select('reference_no')
    .like('reference_no', 'BR-%')
    .order('created_at', { ascending: false })
    .limit(10);
    
  let nextId = 1;
  for (const b of (maxBroadcast || [])) {
    const match = b.reference_no?.match(/^BR-(\d{4})$/);
    if (match) {
      nextId = parseInt(match[1], 10) + 1;
      break;
    }
  }
  const reference_no = `BR-${String(nextId).padStart(4, "0")}`;
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

/** 'IN_PROGRESS' -> 'In progress', for a message an operator reads. */
function formatStatusLabel(status: string): string {
  const word = status.replace(/_/g, ' ').toLowerCase()
  return word.charAt(0).toUpperCase() + word.slice(1)
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

  // The failure count read off the fulfilment report. When it is present the refund is
  // derived from it and the typed amount below is ignored entirely - the operator enters how
  // many calls failed, not how many rupees to hand back.
  //
  // Delivered is NOT read from the form. The browser sends it, but it is recomputed below
  // from the order's own contact count: the campaign targeted a known number of contacts, so
  // whatever did not fail was delivered. Trusting a delivered figure from the client would
  // let the denominator of the refund rate (delivered + failed) be set from outside the
  // order - post a small pair and every call on a large order reprices upward.
  const failedCallsStr = String(formData.get("failedCalls") || "")
  const hasCallCounts = failedCallsStr !== ""

  let failedCalls: number | null = null
  if (hasCallCounts) {
    failedCalls = Number.parseInt(failedCallsStr || "0", 10)
    if (!Number.isInteger(failedCalls) || failedCalls < 0) {
      return { error: 'The failed call count must be a whole number, zero or more.' }
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

  // Delivered is derived here, from the order rather than the form: the campaign targeted a
  // known list, so every number that did not fail was delivered. This also fixes the refund
  // denominator to the order's own size, which is what makes the per-call rate simply
  // `charge / contacts` - the same rate the customer was quoted when they placed it.
  const totalCalls = Number(existingBroadcast.contact_count || 0)
  const countsReconcile = totalCalls > 0 && (failedCalls ?? 0) <= totalCalls

  // Refused only when the refund actually depends on the figure. The browser prefills the
  // failure count from the order and resends it on every save whatever status is chosen, and
  // `resubmitFiles` can lower an order's contact_count after the counts were recorded - so
  // enforcing this on every save would block an unrelated On hold or Cancelled behind an
  // error about a refund that is not being paid, with no control on screen to clear it.
  let deliveredCalls: number | null = null
  if (hasCallCounts && countsReconcile) {
    deliveredCalls = totalCalls - (failedCalls as number)
  } else if (hasCallCounts && status === 'PARTIAL') {
    return {
      error: totalCalls <= 0
        ? "This order has no contact count on file, so the delivered figure cannot be worked out from it. Refund it from the customer's wallet instead."
        : `This broadcast targeted ${totalCalls} numbers, so at most ${totalCalls} calls can have failed. You entered ${failedCalls}.`,
    }
  } else if (hasCallCounts) {
    // Not a refunding save and the numbers do not reconcile: let the status change through and
    // leave the recorded delivered figure exactly as it was rather than overwriting it.
    deliveredCalls = existingBroadcast.delivered_calls ?? null
  }

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

  // ---------------------------------------------------------------------------------------
  // What each closing status must carry.
  // ---------------------------------------------------------------------------------------
  // Closing a run out is a claim about work that was done, so it has to come with the
  // evidence: COMPLETED and PARTIAL are what the customer sees as "here is what you paid
  // for", and an order sitting at Completed with nothing attached gives them no way to check
  // it and the operator no record of what was delivered.
  //
  // An order already carrying a report satisfies this - the status can be corrected, or a
  // report replaced, without forcing the operator to re-upload a file that has not changed.
  if (allowsReport && !reportUploadKey) {
    const { data: attached } = await supabase
      .from('reports')
      .select('file_key')
      .eq('broadcast_id', existingBroadcast.id)
      .maybeSingle()

    if (!attached?.file_key) {
      return {
        error: `A fulfilment report is required before an order can be marked ${formatStatusLabel(status)}. Attach the delivery report and save again.`,
      }
    }
  }

  // The statuses that stop or suspend an order instead of completing it carry no report, so
  // the reason *is* the record. It is also the only thing the customer is told: a cancelled
  // order with no explanation reads as money taken and nothing said, and a held order with no
  // reason leaves them nothing to act on in the resubmit flow.
  const requiredReasons: Record<string, string> = {
    CANCELLED: cancelReason,
    ON_HOLD: holdReason,
    REFUNDED: refundReason,
  }
  if (status in requiredReasons && !requiredReasons[status].trim()) {
    // The browser uploads before it submits, so a report picked against a status that is
    // about to be refused is already in the bucket with nothing to point at it.
    await discardUpload(reportUploadKey)
    return {
      error: `A reason is required when an order is marked ${formatStatusLabel(status)}. The customer is shown it, so say what happened.`,
    }
  }

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
  //
  // The counts describe the order's *total* entitlement, so what is credited is the shortfall
  // against what the ledger says has already gone back. That is what makes re-saving safe:
  // correcting a fulfilment report used to pay the whole failed-call refund a second time,
  // and a third save refunded what was left of the order entirely.
  if (hasCallCounts && allowsPartialRefund) {
    const breakdown = calculateFailedCallRefund(
      originalCharge,
      deliveredCalls as number,
      failedCalls as number,
      alreadyRefunded,
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
      ? ` ${failedCalls} of ${totalCalls} calls failed.`
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
  const user = await getAuthUser()
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
  let newContactsSize = 0
  if (newContactsKey) {
    const check = await consumeUploadedKey('contacts', newContactsKey, user.id)
    if (!check.ok) return { error: check.error }
    newContactsSize = check.size
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

  // ---------------------------------------------------------------------------------------
  // Re-price a replaced contact list.
  // ---------------------------------------------------------------------------------------
  // Swapping the contact list changes how many numbers the campaign targets, and under
  // quantity pricing that count *is* the multiplier on the invoice. This path used to update
  // only the storage key, so an order placed for 100 numbers could be put on hold and come
  // back carrying half a million - still recorded, and still billed, as 100. The count is
  // re-derived from the file the same way `createBroadcast` derives it, and the difference is
  // settled before the order returns to the queue.
  //
  // A flat-priced service is deliberately left alone: its charge does not depend on the count,
  // so re-resolving would do nothing but silently apply today's catalogue price to an order
  // sold at an older one. Only its recorded contact_count is refreshed.
  const originalCharge = Number(broadcast.charge || 0)
  let settledCharge: number | null = null
  let chargeDelta = 0

  /**
   * Abandons the resubmission, leaving the order exactly as it was.
   *
   * Both replacements are dropped, not just the one that failed: the browser uploads audio
   * and contacts before submitting, so refusing on the contact list would otherwise leave a
   * new audio file in the bucket with nothing pointing at it.
   */
  const abandon = async (message: string) => {
    await discardUpload(newAudioKey)
    await discardUpload(newContactsKey)
    return { error: message }
  }

  if (newContactsKey) {
    const counted = await countContactsInFile(newContactsKey, newContactsSize)
    const billsOnQuantity = broadcast.service_id
      ? await serviceIsQuantityPriced(supabase, broadcast.service_id)
      : false

    if (!counted.ok) {
      // Same rule as the create path: a service that bills on the count cannot be sold
      // without one, but a flat-priced order is unaffected by an unreadable format - the
      // operator opens the file by hand either way.
      if (billsOnQuantity) {
        return abandon(counted.error)
      }
    } else {
      updatePayload.contact_count = counted.count

      if (billsOnQuantity && broadcast.service_id) {
        const resolved = await resolveServicePrice(
          supabase,
          broadcast.user_id,
          broadcast.service_id,
          counted.count,
        )
        if (!resolved.ok) {
          return abandon(resolved.error)
        }

        settledCharge = resolved.price
        chargeDelta = Number((settledCharge - originalCharge).toFixed(2))
      }
    }
  }

  // Money moves before the row does, so an order can never point at a bigger list than it
  // was charged for. A shortfall stops the resubmission outright rather than half-applying it.
  if (chargeDelta > 0) {
    const { data: deductResult, error: deductError } = await supabase.rpc('safe_deduct_balance', {
      uid: broadcast.user_id,
      amt: chargeDelta,
    })
    const deducted = Array.isArray(deductResult) ? deductResult[0] : deductResult

    // A failed RPC and a declined one mean different things to the customer: one is a fault
    // they can do nothing about, the other is a shortfall they can top up. Reporting a
    // balance of zero for the first would send them to Add funds for no reason.
    if (deductError) {
      console.error('Resubmit balance deduction error:', deductError)
      return abandon(
        'The larger contact list could not be charged for just now. Nothing was changed — ' +
        'please try again shortly.',
      )
    }
    if (!deducted?.success) {
      const balance = Number(deducted?.new_balance || 0)
      return abandon(
        `This contact list has ${Number(updatePayload.contact_count).toLocaleString('en-IN')} numbers, ` +
        `which brings the order to ₹${settledCharge!.toFixed(2)} — ₹${chargeDelta.toFixed(2)} more than ` +
        `you have already paid. Your wallet holds ₹${balance.toFixed(2)}. Add funds, or upload a shorter list.`,
      )
    }
  } else if (chargeDelta < 0) {
    // The list shrank. Hand back the difference before the order is re-queued at the lower
    // charge, so the ledger never shows the customer paying for numbers the order no longer
    // carries.
    const refunded = await creditWallet(supabase, broadcast.user_id, -chargeDelta)
    if (!refunded) {
      console.error('Resubmit refund failed for broadcast', broadcast.reference_no)
      return abandon(
        'The smaller contact list could not be re-priced because the wallet refund failed. ' +
        'Nothing was changed — please try again, or raise a support ticket.',
      )
    }
  }

  if (settledCharge !== null) updatePayload.charge = settledCharge

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
    // The row still carries the original charge, so any settlement made for the list that
    // was not applied has to be put back or the customer is out of pocket for nothing.
    if (chargeDelta > 0) {
      await creditWallet(supabase, broadcast.user_id, chargeDelta)
    } else if (chargeDelta < 0) {
      await supabase.rpc('safe_deduct_balance', { uid: broadcast.user_id, amt: -chargeDelta })
    }
    return { error: 'Failed to update broadcast after resubmission.' }
  }

  // Only once the row points at the replacements is it safe to drop the originals.
  if (newAudioKey && broadcast.audio_key) await discardUpload(broadcast.audio_key)
  if (newContactsKey && broadcast.contacts_key) await discardUpload(broadcast.contacts_key)

  // The adjustment is booked against its own reference, not the order's.
  //
  // `updateBroadcastStatus` works out what is still refundable by summing every CREDIT filed
  // under the order's reference_no. A re-pricing credit is not a refund - it is the other half
  // of a charge that was lowered at the same time - so filing it there would make a later
  // cancellation believe that money had already been handed back and pay out nothing.
  if (chargeDelta !== 0) {
    await supabase.from('transactions').insert([{
      user_id: broadcast.user_id,
      amount: Math.abs(chargeDelta),
      type: chargeDelta > 0 ? 'DEBIT' : 'CREDIT',
      status: 'SUCCESS',
      order_id: `${broadcast.reference_no}-ADJ`,
    }])
  }

  // Record history
  const priceNote =
    chargeDelta !== 0
      ? ` Contact list changed to ${Number(updatePayload.contact_count).toLocaleString('en-IN')} numbers; ` +
        `order re-priced from ₹${originalCharge.toFixed(2)} to ₹${settledCharge!.toFixed(2)} ` +
        `(${chargeDelta > 0 ? 'debited' : 'refunded'} ₹${Math.abs(chargeDelta).toFixed(2)}).`
      : ''

  await supabase.from('broadcast_status_history').insert([{
    broadcast_id: broadcast.id,
    status: 'PLACED',
    reason: `Files resubmitted by customer.${priceNote}`
  }])

  return { success: true }
}

export async function getDownloadUrl(path: string) {
  const user = await getAuthUser()
  if (!user) return { error: 'Unauthorized' }

  const isAdmin = await checkIsAdmin()
  const supabase = await createServiceRoleClient()
  
  if (!isAdmin) {
    // Ownership is proved with two plain equality filters rather than one `.or()`.
    //
    // `.or()` takes a *string* that PostgREST parses as filter syntax, so interpolating a
    // browser-supplied path into it let the caller write filters rather than just supply a
    // value: a path of `x,audio_key.not.is.null` turned the ownership probe into "any order
    // this user owns", which answers yes for a key they do not own. Nothing in the bucket can
    // currently carry a comma - `safeName` in createUploadTicket strips keys to
    // [A-Za-z0-9.-] - so it was not reachable, but that is an accident of another function's
    // behaviour and not something this check should depend on.
    const [byAudio, byContacts] = await Promise.all([
      supabase.from('broadcasts').select('id').eq('user_id', user.id).eq('audio_key', path).limit(1),
      supabase.from('broadcasts').select('id').eq('user_id', user.id).eq('contacts_key', path).limit(1),
    ])
    const ownedBroadcasts = [...(byAudio.data || []), ...(byContacts.data || [])]

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