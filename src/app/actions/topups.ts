/* eslint-disable @typescript-eslint/no-explicit-any */
'use server'

import { createHash } from 'crypto'
import { headers } from 'next/headers'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { checkIsAdmin } from '@/app/actions/auth'
import { getVerifier, canAutoCredit } from '@/lib/payments/utr'
import { logActivity, describeActor } from '@/lib/activity'
import { STORAGE_BUCKET } from '@/lib/uploads'
import { consumeUploadedKey, discardUpload } from '@/lib/storage'
import { guard } from '@/lib/errors'
import { getAuthUser } from '@/lib/session'
import { guardRecaptcha } from '@/lib/recaptcha'

const METHOD_CODE = 'UPI_QR'

/** How far back a bank lookup is allowed to search for a credit. */
const LOOKUP_WINDOW_DAYS = 7

/**
 * Rate limits for UTR submission. A UTR is 12 digits, so guessing one at random is
 * hopeless - but guessing one that a *neighbouring merchant* was paid is not. These
 * windows make an enumeration attempt take longer than it is worth and leave a trail.
 */
const RATE_LIMITS = {
  perUserPerHour: 5,
  perIpPerHour: 15,
  maxOpenRequests: 3,
}

/**
 * Which recorded outcomes actually consume a submission slot.
 *
 * Every attempt is written to `topup_submission_attempts` for the audit trail, but only these
 * two reached the UTR namespace, and that is the thing being rationed: a well-formed 12-digit
 * UTR that either landed (`ACCEPTED`) or collided with one already spent (`DUPLICATE_UTR`) is
 * exactly what an enumeration attempt looks like.
 *
 * Everything else is excluded on purpose:
 *
 *  - `RATE_LIMITED_USER` / `RATE_LIMITED_IP` are the limiter's own refusals. Counting them
 *    made the lockout feed itself - the window is rolling on `created_at`, so every blocked
 *    retry wrote a fresh row and pushed the unlock further away. A customer who kept clicking
 *    could never get back in, and nothing on screen said to stop.
 *  - `TOO_MANY_PENDING` is a different limiter's refusal, with the same problem.
 *  - `INVALID_UTR`, `INVALID_AMOUNT` and `AMOUNT_OUT_OF_RANGE` are typos, rejected on format
 *    before any lookup happens. They cannot be a guess at someone else's UTR, so spending
 *    five of the hour's five slots on mistyping is a lockout that protects nothing.
 *  - `METHOD_DISABLED` and `INSERT_FAILED` are faults on our side, not attempts.
 */
const RATE_LIMITED_OUTCOMES = ['ACCEPTED', 'DUPLICATE_UTR']

// ---------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------

/**
 * Salted SHA-256 of the caller IP. We need to throttle by network origin without keeping
 * an identifiable address in the database.
 */
async function getIpHash(): Promise<string | null> {
  try {
    const headerList = await headers()
    const forwarded = headerList.get('x-forwarded-for') || headerList.get('x-real-ip') || ''
    const ip = forwarded.split(',')[0]?.trim()
    if (!ip) return null

    const salt = process.env.IP_HASH_SALT || process.env.SUPABASE_SERVICE_ROLE_KEY || ''
    return createHash('sha256').update(`${salt}:${ip}`).digest('hex')
  } catch {
    return null
  }
}

async function recordAttempt(userId: string | null, ipHash: string | null, outcome: string) {
  try {
    const supabase = await createServiceRoleClient()
    await supabase.from('topup_submission_attempts').insert([
      { user_id: userId, ip_hash: ipHash, outcome },
    ])
  } catch (e) {
    // Never let audit logging break the user-facing flow.
    console.error('Failed to record top-up attempt:', e)
  }
}

/** Only ever return the QR to a signed-in caller, and only as a short-lived signed URL. */
async function signQrUrl(key: string | null): Promise<string | null> {
  if (!key) return null
  try {
    const supabase = await createServiceRoleClient()
    const { data } = await supabase.storage.from(STORAGE_BUCKET).createSignedUrl(key, 60 * 30)
    return data?.signedUrl || null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------------------
// payment method configuration
// ---------------------------------------------------------------------------------------

/**
 * Everything the customer top-up screen needs, and nothing else. Verification mode and
 * auto-credit policy are operator concerns and are deliberately not exposed here.
 */
export async function getPaymentMethod() {
  const user = await getAuthUser()
  if (!user) return { error: 'Unauthorized' }

  const supabase = await createServiceRoleClient()
  const { data, error } = await supabase
    .from('payment_methods')
    .select('code, label, is_enabled, upi_vpa, upi_payee_name, qr_image_key, min_amount, max_amount, instructions')
    .eq('code', METHOD_CODE)
    .single()

  if (error || !data) {
    return { error: 'Payment method is not configured yet. Please contact support.' }
  }

  if (!data.is_enabled) {
    return { data: { ...data, qr_url: null, is_enabled: false } }
  }

  return { data: { ...data, qr_url: await signQrUrl(data.qr_image_key) } }
}

/** Full configuration for the admin settings screen. */
export async function getPaymentMethodAdmin() {
  if (!(await checkIsAdmin())) return { error: 'Admin access required' }

  const supabase = await createServiceRoleClient()
  const { data, error } = await supabase
    .from('payment_methods')
    .select('*')
    .eq('code', METHOD_CODE)
    .single()

  if (error || !data) return { error: 'Payment method row is missing. Run the latest migration.' }

  const verifier = getVerifier(data.verification_mode)

  return {
    data: {
      ...data,
      qr_url: await signQrUrl(data.qr_image_key),
      /** Lets the settings screen warn before an unusable mode is saved. */
      verifier_configured: verifier.isConfigured,
    },
  }
}

export async function updatePaymentMethod(formData: FormData) {
  return guard('updatePaymentMethod', () => runUpdatePaymentMethod(formData))
}

async function runUpdatePaymentMethod(formData: FormData) {
  if (!(await checkIsAdmin())) return { error: 'Admin access required' }

  const user = await getAuthUser()
  if (!user) return { error: 'Unauthorized' }

  const isEnabled = String(formData.get('is_enabled') || 'false') === 'true'
  const upiVpa = String(formData.get('upi_vpa') || '').trim()
  const payeeName = String(formData.get('upi_payee_name') || '').trim()
  const instructions = String(formData.get('instructions') || '').trim()
  const verificationMode = String(formData.get('verification_mode') || 'MANUAL')
  const autoCredit = String(formData.get('auto_credit_on_match') || 'false') === 'true'
  const minAmount = parseFloat(String(formData.get('min_amount') || '0'))
  const maxAmount = parseFloat(String(formData.get('max_amount') || '0'))
  // Uploaded straight to storage by the browser; this is just the resulting key.
  const qrUploadKey = String(formData.get('qr_image_key') || '')

  if (!['MANUAL', 'DECENTRO', 'GENERIC_UPI', 'PAYTM'].includes(verificationMode)) {
    return { error: 'Unsupported verification mode.' }
  }
  if (!Number.isFinite(minAmount) || minAmount <= 0) {
    return { error: 'Minimum amount must be greater than zero.' }
  }
  if (!Number.isFinite(maxAmount) || maxAmount < minAmount) {
    return { error: 'Maximum amount must be greater than or equal to the minimum amount.' }
  }
  if (upiVpa && !/^[\w.\-]{2,64}@[a-zA-Z]{2,32}$/.test(upiVpa)) {
    return { error: 'Enter a valid UPI ID, for example business@okhdfcbank.' }
  }

  // Turning the method on without a destination would show customers a dead screen.
  if (isEnabled && !upiVpa) {
    return { error: 'Add the UPI ID before enabling this payment method.' }
  }

  if (verificationMode === 'DECENTRO' && !getVerifier('DECENTRO').isConfigured) {
    return {
      error:
        'Decentro credentials are missing on the server. Set the DECENTRO_* environment variables before selecting this mode.',
    }
  }

  if (verificationMode === 'GENERIC_UPI' && !getVerifier('GENERIC_UPI').isConfigured) {
    return {
      error:
        'UPI Gateway credentials are missing on the server. Set the UPI_GATEWAY_* environment variables before selecting this mode.',
    }
  }

  if (verificationMode === 'PAYTM' && !getVerifier('PAYTM').isConfigured) {
    return {
      error:
        'The Paytm Merchant ID is missing on the server. Set PAYTM_MID in the server environment before selecting this mode.',
    }
  }

  const supabase = await createServiceRoleClient()

  const { data: existing } = await supabase
    .from('payment_methods')
    .select('qr_image_key')
    .eq('code', METHOD_CODE)
    .single()

  let qrKey = existing?.qr_image_key || null

  if (qrUploadKey) {
    const check = await consumeUploadedKey('qr', qrUploadKey, user.id)
    if (!check.ok) return { error: check.error }

    const previousKey = qrKey
    qrKey = qrUploadKey
    if (previousKey && previousKey !== qrKey) {
      await discardUpload(previousKey)
    }
  }

  if (isEnabled && !qrKey) {
    return { error: 'Upload the static QR image before enabling this payment method.' }
  }

  const { error } = await supabase
    .from('payment_methods')
    .update({
      is_enabled: isEnabled,
      upi_vpa: upiVpa || null,
      upi_payee_name: payeeName || null,
      qr_image_key: qrKey,
      min_amount: minAmount,
      max_amount: maxAmount,
      instructions: instructions || null,
      verification_mode: verificationMode,
      auto_credit_on_match: verificationMode === 'MANUAL' ? false : autoCredit,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    })
    .eq('code', METHOD_CODE)

  if (error) {
    console.error('Payment method update error:', error)
    return { error: 'Failed to save payment settings.' }
  }

  return { success: true }
}

// ---------------------------------------------------------------------------------------
// customer submission
// ---------------------------------------------------------------------------------------

/** Explicit contract so callers can narrow on `error` without fighting the union. */
export type TopupSubmitResult =
  | { error: string; success?: undefined; status?: undefined; reference?: undefined; message?: undefined }
  | { success: true; status: 'PENDING' | 'APPROVED'; reference: string; message: string; error?: undefined }

export async function submitTopupRequest(formData: FormData): Promise<TopupSubmitResult> {
  return guard('submitTopupRequest', () => runSubmitTopupRequest(formData))
}

async function runSubmitTopupRequest(formData: FormData): Promise<TopupSubmitResult> {
  const user = await getAuthUser()
  if (!user) return { error: 'Unauthorized' }

  // Checked before the attempt is recorded, so a scripted run of guessed UTRs cannot use the
  // limiter's own bookkeeping as a side channel. The per-user and per-IP limits below still
  // apply; this stops the traffic that never came from the page at all.
  const refused = await guardRecaptcha(String(formData.get('recaptchaToken') || ''), 'topup')
  if (refused) return { error: refused.error }

  const ipHash = await getIpHash()
  const supabase = await createServiceRoleClient()

  // --- format validation -----------------------------------------------------------
  const amount = parseFloat(String(formData.get('amount') || '0'))
  const utr = String(formData.get('utr') || '').replace(/[\s-]/g, '')

  if (!/^\d{12}$/.test(utr)) {
    await recordAttempt(user.id, ipHash, 'INVALID_UTR')
    return { error: 'The UTR must be exactly 12 digits. Copy it from your UPI app.' }
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    await recordAttempt(user.id, ipHash, 'INVALID_AMOUNT')
    return { error: 'Enter the amount you paid.' }
  }

  // --- method must be live ---------------------------------------------------------
  const { data: method } = await supabase
    .from('payment_methods')
    .select('*')
    .eq('code', METHOD_CODE)
    .single()

  if (!method || !method.is_enabled) {
    await recordAttempt(user.id, ipHash, 'METHOD_DISABLED')
    return { error: 'Wallet top-ups are temporarily unavailable. Please contact support.' }
  }

  const minAmount = Number(method.min_amount)
  const maxAmount = Number(method.max_amount)
  if (amount < minAmount || amount > maxAmount) {
    await recordAttempt(user.id, ipHash, 'AMOUNT_OUT_OF_RANGE')
    return { error: `Amount must be between Rs ${minAmount.toFixed(2)} and Rs ${maxAmount.toFixed(2)}.` }
  }

  // --- rate limiting ---------------------------------------------------------------
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()

  const { count: userAttempts } = await supabase
    .from('topup_submission_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .in('outcome', RATE_LIMITED_OUTCOMES)
    .gte('created_at', oneHourAgo)

  if ((userAttempts || 0) >= RATE_LIMITS.perUserPerHour) {
    await recordAttempt(user.id, ipHash, 'RATE_LIMITED_USER')
    return {
      error:
        `You have submitted ${RATE_LIMITS.perUserPerHour} top-ups in the last hour, which is the limit. ` +
        'Wait for those to be reviewed, or contact support if one of them needs attention.',
    }
  }

  if (ipHash) {
    const { count: ipAttempts } = await supabase
      .from('topup_submission_attempts')
      .select('id', { count: 'exact', head: true })
      .eq('ip_hash', ipHash)
      .in('outcome', RATE_LIMITED_OUTCOMES)
      .gte('created_at', oneHourAgo)

    if ((ipAttempts || 0) >= RATE_LIMITS.perIpPerHour) {
      await recordAttempt(user.id, ipHash, 'RATE_LIMITED_IP')
      return { error: 'Too many top-up attempts from this network. Please try again later.' }
    }
  }

  const { count: openRequests } = await supabase
    .from('wallet_topup_requests')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('status', 'PENDING')

  if ((openRequests || 0) >= RATE_LIMITS.maxOpenRequests) {
    await recordAttempt(user.id, ipHash, 'TOO_MANY_PENDING')
    return {
      error: `You already have ${openRequests} top-up requests awaiting review. Please wait for those to be processed.`,
    }
  }

  // --- optional automated bank lookup ----------------------------------------------
  const verifier = getVerifier(method.verification_mode)
  const since = new Date(Date.now() - LOOKUP_WINDOW_DAYS * 24 * 60 * 60 * 1000)
  const verification = await verifier.verify({ utr, amount, since })

  // --- create the request ----------------------------------------------------------
  // The partial unique index on utr_number is what actually prevents a UTR being spent
  // twice; a duplicate lands here as a 23505 and is reported as a clean error.
  const referenceNo = `TU-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`

  const { data: created, error: insertError } = await supabase
    .from('wallet_topup_requests')
    .insert([
      {
        reference_no: referenceNo,
        user_id: user.id,
        method_code: METHOD_CODE,
        amount,
        utr_number: utr,
        status: 'PENDING',
        verification_mode: verifier.mode,
        verification_state: verification.state,
        verified_amount: verification.verifiedAmount ?? null,
        verification_note: verification.note,
        verified_at: verifier.mode === 'MANUAL' ? null : new Date().toISOString(),
        submitted_ip_hash: ipHash,
      },
    ])
    .select('id, reference_no')
    .single()

  if (insertError) {
    if (insertError.code === '23505') {
      await recordAttempt(user.id, ipHash, 'DUPLICATE_UTR')

      // The partial unique index refused the row, so a live claim on this UTR already exists.
      // Who holds it decides whether this is someone re-submitting their own reference after
      // a page refresh, or one account trying to bank a payment another account already
      // claimed - which is the shape of an actual attempt to spend a UTR twice, and the one
      // thing here worth waking an operator up for.
      const { data: holder } = await supabase
        .from('wallet_topup_requests')
        .select('reference_no, user_id, status')
        .eq('utr_number', utr)
        .neq('status', 'REJECTED')
        .maybeSingle()

      if (holder && holder.user_id !== user.id) {
        await logActivity({
          ...(await describeActor(user.id)),
          actionType: 'PAYMENT_UTR_CONFLICT',
          entityType: 'TOPUP',
          entityId: holder.reference_no,
          description:
            `Rejected a top-up for Rs ${amount.toFixed(2)}: UTR ${utr} is already claimed by ` +
            `a different customer on ${holder.reference_no} (${holder.status}).`,
          metadata: { utr, claimedBy: holder.user_id, claimStatus: holder.status },
        })
      }

      return {
        error:
          'This UTR has already been submitted. If you believe this is a mistake, raise a support ticket.',
      }
    }
    console.error('Top-up insert error:', insertError)
    await recordAttempt(user.id, ipHash, 'INSERT_FAILED')
    return { error: 'Could not record your top-up request. Please try again.' }
  }

  await recordAttempt(user.id, ipHash, 'ACCEPTED')

  await logActivity({
    ...(await describeActor(user.id)),
    actionType: 'PAYMENT_SUBMITTED',
    entityType: 'TOPUP',
    entityId: created.reference_no,
    description: `Top-up ${created.reference_no} submitted for Rs ${amount.toFixed(2)} (UTR ${utr}).`,
    metadata: { amount, verificationState: verification.state },
  })

  // --- auto-credit, only on an exact verified match --------------------------------
  if (canAutoCredit(verification, Boolean(method.auto_credit_on_match))) {
    const { data: approval, error: approvalError } = await supabase.rpc('approve_wallet_topup', {
      p_request_id: created.id,
      p_admin_id: null,
      p_note: 'Auto-approved: bank credit matched this UTR and amount.',
    })

    const result = Array.isArray(approval) ? approval[0] : approval

    if (approvalError || !result?.success) {
      console.error('Auto-credit failed, leaving request pending:', approvalError || result?.message)
      return {
        success: true,
        status: 'PENDING',
        reference: created.reference_no,
        message: 'Payment verified. Your wallet will be credited shortly after a final check.',
      }
    }

    return {
      success: true,
      status: 'APPROVED',
      reference: created.reference_no,
      message: `Verified. Rs ${amount.toFixed(2)} has been credited to your wallet.`,
    }
  }

  return {
    success: true,
    status: 'PENDING',
    reference: created.reference_no,
    message: 'Top-up submitted. Your wallet is credited once our team verifies the payment.',
  }
}

// ---------------------------------------------------------------------------------------
// reads
// ---------------------------------------------------------------------------------------

export async function getMyTopupRequests() {
  const user = await getAuthUser()
  if (!user) return []

  const supabase = await createServiceRoleClient()
  const { data, error } = await supabase
    .from('wallet_topup_requests')
    .select('id, reference_no, amount, utr_number, status, rejection_reason, admin_note, created_at, reviewed_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(50)

  if (error || !data) return []
  return data
}

/** Drives the queue badge in the admin navigation. */
export async function getTopupPendingCount(): Promise<number> {
  if (!(await checkIsAdmin())) return 0

  const supabase = await createServiceRoleClient()
  const { count } = await supabase
    .from('wallet_topup_requests')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'PENDING')

  return count || 0
}

export async function getAllTopupRequests() {
  if (!(await checkIsAdmin())) return []

  const supabase = await createServiceRoleClient()
  const { data, error } = await supabase
    .from('wallet_topup_requests')
    .select(`
      *,
      users!wallet_topup_requests_user_id_fkey (
        full_name,
        company_name,
        email,
        balance
      )
    `)
    .order('created_at', { ascending: false })
    .limit(500)

  if (error || !data) {
    if (error) console.error('Fetch top-up requests error:', error)
    return []
  }

  // ---------------------------------------------------------------------------------------
  // Prior claims on the same UTR.
  // ---------------------------------------------------------------------------------------
  // A rejected request releases its UTR - deliberately, so a mistyped reference can be
  // corrected - which means the same UTR can be presented over and over with a different
  // amount each time until an approval goes through. The database stops a UTR being held
  // twice at once; it cannot judge whether the operator *should* approve this attempt. That
  // judgement needs the history, so it is put in front of them rather than left to be
  // discovered by searching the queue.
  const utrs = Array.from(new Set(data.map((row: any) => row.utr_number).filter(Boolean)))
  const history = new Map<string, { rejected: number; otherUsers: Set<string> }>()

  if (utrs.length > 0) {
    const { data: claims, error: claimsError } = await supabase
      .from('wallet_topup_requests')
      .select('utr_number, user_id, status')
      .in('utr_number', utrs)

    if (claimsError) {
      // Losing the history is not a reason to lose the queue - the amounts and UTRs still
      // render, just without the prior-claim warning.
      console.error('Top-up UTR history lookup failed:', claimsError)
    } else {
      for (const claim of claims || []) {
        const entry = history.get(claim.utr_number) || { rejected: 0, otherUsers: new Set<string>() }
        if (claim.status === 'REJECTED') entry.rejected++
        entry.otherUsers.add(claim.user_id)
        history.set(claim.utr_number, entry)
      }
    }
  }

  return data.map((row: any) => {
    const seen = history.get(row.utr_number)
    return {
      ...row,
      customer: row.users?.company_name || row.users?.full_name || 'Unknown',
      email: row.users?.email || 'Unknown',
      customer_balance: Number(row.users?.balance || 0),
      /** How many times this exact UTR was submitted and turned down before. */
      utr_rejected_before: seen ? seen.rejected : 0,
      /** True when more than one account has ever claimed this UTR. */
      utr_claimed_by_others: seen ? seen.otherUsers.size > 1 : false,
    }
  })
}

// ---------------------------------------------------------------------------------------
// admin decisions
// ---------------------------------------------------------------------------------------

export async function approveTopupRequest(requestId: string, note?: string) {
  if (!(await checkIsAdmin())) return { error: 'Admin access required' }

  const user = await getAuthUser()
  if (!user) return { error: 'Unauthorized' }

  const supabase = await createServiceRoleClient()

  // The RPC locks the row and re-checks the status, so a double click credits once.
  const { data, error } = await supabase.rpc('approve_wallet_topup', {
    p_request_id: requestId,
    p_admin_id: user.id,
    p_note: note?.trim() || null,
  })

  if (error) {
    console.error('Approve top-up error:', error)
    return { error: 'Failed to approve this top-up.' }
  }

  const result = Array.isArray(data) ? data[0] : data
  if (!result?.success) return { error: result?.message || 'Failed to approve this top-up.' }

  await logActivity({
    ...(await describeActor(user.id)),
    actionType: 'PAYMENT_APPROVED',
    entityType: 'TOPUP',
    entityId: requestId,
    description: `Top-up approved and wallet credited. New balance Rs ${Number(result.new_balance).toFixed(2)}.`,
    metadata: { newBalance: Number(result.new_balance) },
  })

  return { success: true, message: result.message, newBalance: Number(result.new_balance) }
}

export async function rejectTopupRequest(requestId: string, reason: string) {
  if (!(await checkIsAdmin())) return { error: 'Admin access required' }

  const trimmed = reason?.trim()
  if (!trimmed) return { error: 'A rejection reason is required so the customer knows what to fix.' }

  const user = await getAuthUser()
  if (!user) return { error: 'Unauthorized' }

  const supabase = await createServiceRoleClient()
  const { data, error } = await supabase.rpc('reject_wallet_topup', {
    p_request_id: requestId,
    p_admin_id: user.id,
    p_reason: trimmed,
  })

  if (error) {
    console.error('Reject top-up error:', error)
    return { error: 'Failed to reject this top-up.' }
  }

  const result = Array.isArray(data) ? data[0] : data
  if (!result?.success) return { error: result?.message || 'Failed to reject this top-up.' }

  await logActivity({
    ...(await describeActor(user.id)),
    actionType: 'PAYMENT_REJECTED',
    entityType: 'TOPUP',
    entityId: requestId,
    description: `Top-up rejected: ${trimmed}`,
  })

  return { success: true, message: result.message }
}

/** Re-runs the bank lookup for a pending request without changing its status. */
export async function recheckTopupRequest(requestId: string) {
  if (!(await checkIsAdmin())) return { error: 'Admin access required' }

  const supabase = await createServiceRoleClient()

  const { data: request } = await supabase
    .from('wallet_topup_requests')
    .select('id, amount, utr_number, status, created_at')
    .eq('id', requestId)
    .single()

  if (!request) return { error: 'Top-up request not found.' }
  if (request.status !== 'PENDING') return { error: 'Only pending requests can be re-checked.' }

  const { data: method } = await supabase
    .from('payment_methods')
    .select('verification_mode')
    .eq('code', METHOD_CODE)
    .single()

  const verifier = getVerifier(method?.verification_mode)
  if (verifier.mode === 'MANUAL') {
    return { error: 'This payment method is set to manual verification, so there is nothing to re-check.' }
  }

  const since = new Date(Date.now() - LOOKUP_WINDOW_DAYS * 24 * 60 * 60 * 1000)
  const verification = await verifier.verify({
    utr: request.utr_number,
    amount: Number(request.amount),
    since,
  })

  await supabase
    .from('wallet_topup_requests')
    .update({
      verification_mode: verifier.mode,
      verification_state: verification.state,
      verified_amount: verification.verifiedAmount ?? null,
      verification_note: verification.note,
      verified_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', requestId)

  return { success: true, state: verification.state, note: verification.note }
}
