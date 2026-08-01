/* eslint-disable @typescript-eslint/no-explicit-any */
'use server'

import { createHash } from 'crypto'
import { headers } from 'next/headers'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { checkIsAdmin } from '@/app/actions/auth'
import { getVerifier, canAutoCredit } from '@/lib/payments/utr'

const METHOD_CODE = 'UPI_QR'
const STORAGE_BUCKET = 'xpack_files'

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
  const supabaseAuth = await createClient()
  const { data: { user } } = await supabaseAuth.auth.getUser()
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
  if (!(await checkIsAdmin())) return { error: 'Admin access required' }

  const supabaseAuth = await createClient()
  const { data: { user } } = await supabaseAuth.auth.getUser()
  if (!user) return { error: 'Unauthorized' }

  const isEnabled = String(formData.get('is_enabled') || 'false') === 'true'
  const upiVpa = String(formData.get('upi_vpa') || '').trim()
  const payeeName = String(formData.get('upi_payee_name') || '').trim()
  const instructions = String(formData.get('instructions') || '').trim()
  const verificationMode = String(formData.get('verification_mode') || 'MANUAL')
  const autoCredit = String(formData.get('auto_credit_on_match') || 'false') === 'true'
  const minAmount = parseFloat(String(formData.get('min_amount') || '0'))
  const maxAmount = parseFloat(String(formData.get('max_amount') || '0'))
  const qrFile = formData.get('qr_image') as File | null

  if (!['MANUAL', 'DECENTRO'].includes(verificationMode)) {
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

  const supabase = await createServiceRoleClient()

  const { data: existing } = await supabase
    .from('payment_methods')
    .select('qr_image_key')
    .eq('code', METHOD_CODE)
    .single()

  let qrKey = existing?.qr_image_key || null

  if (qrFile && qrFile.size > 0) {
    if (!qrFile.type.startsWith('image/')) {
      return { error: 'The QR code must be an image file (PNG or JPG).' }
    }
    if (qrFile.size > 4 * 1024 * 1024) {
      return { error: 'QR image must be smaller than 4 MB.' }
    }

    const extension = qrFile.name.split('.').pop()?.toLowerCase() || 'png'
    const newKey = `payment-methods/${METHOD_CODE}-${Date.now()}.${extension}`

    const { error: uploadError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(newKey, qrFile, { contentType: qrFile.type })

    if (uploadError) {
      console.error('QR upload error:', uploadError)
      return { error: 'Failed to upload the QR image.' }
    }

    const previousKey = qrKey
    qrKey = newKey
    if (previousKey) {
      await supabase.storage.from(STORAGE_BUCKET).remove([previousKey])
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

export async function submitTopupRequest(formData: FormData) {
  const supabaseAuth = await createClient()
  const { data: { user } } = await supabaseAuth.auth.getUser()
  if (!user) return { error: 'Unauthorized' }

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
    .gte('created_at', oneHourAgo)

  if ((userAttempts || 0) >= RATE_LIMITS.perUserPerHour) {
    await recordAttempt(user.id, ipHash, 'RATE_LIMITED_USER')
    return { error: 'Too many top-up attempts. Please wait an hour or contact support.' }
  }

  if (ipHash) {
    const { count: ipAttempts } = await supabase
      .from('topup_submission_attempts')
      .select('id', { count: 'exact', head: true })
      .eq('ip_hash', ipHash)
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
  const supabaseAuth = await createClient()
  const { data: { user } } = await supabaseAuth.auth.getUser()
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

  return data.map((row: any) => ({
    ...row,
    customer: row.users?.company_name || row.users?.full_name || 'Unknown',
    email: row.users?.email || 'Unknown',
    customer_balance: Number(row.users?.balance || 0),
  }))
}

// ---------------------------------------------------------------------------------------
// admin decisions
// ---------------------------------------------------------------------------------------

export async function approveTopupRequest(requestId: string, note?: string) {
  if (!(await checkIsAdmin())) return { error: 'Admin access required' }

  const supabaseAuth = await createClient()
  const { data: { user } } = await supabaseAuth.auth.getUser()
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

  return { success: true, message: result.message, newBalance: Number(result.new_balance) }
}

export async function rejectTopupRequest(requestId: string, reason: string) {
  if (!(await checkIsAdmin())) return { error: 'Admin access required' }

  const trimmed = reason?.trim()
  if (!trimmed) return { error: 'A rejection reason is required so the customer knows what to fix.' }

  const supabaseAuth = await createClient()
  const { data: { user } } = await supabaseAuth.auth.getUser()
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
