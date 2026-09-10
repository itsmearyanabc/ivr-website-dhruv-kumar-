export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { settlePaytmOrder } from '@/app/actions/paytm'

/**
 * Where Paytm returns the customer after checkout.
 *
 * Paytm POSTs a form here carrying the outcome. None of it is trusted: the ORDERID is read
 * out and handed to settlePaytmOrder, which asks Paytm directly what happened before any
 * money moves. Anyone can POST to this URL, so treating its contents as fact would mean
 * anyone could credit their own wallet.
 *
 * The wallet is therefore already credited by the time the customer's browser lands back on
 * the panel - the redirect below is presentation, not the thing that pays.
 */
async function handle(request: Request) {
  const origin = new URL(request.url).origin
  let orderId = ''

  try {
    const contentType = request.headers.get('content-type') || ''
    if (contentType.includes('form')) {
      const form = await request.formData()
      orderId = String(form.get('ORDERID') || form.get('orderId') || '')
    } else {
      orderId = new URL(request.url).searchParams.get('ORDERID') || ''
    }
  } catch {
    /* falls through to the missing-reference redirect below */
  }

  if (!orderId) {
    return NextResponse.redirect(new URL('/?topup=unknown', origin), { status: 303 })
  }

  const result = await settlePaytmOrder(orderId)
  const state =
    'status' in result && result.status === 'APPROVED' ? 'success'
    : 'status' in result && result.status === 'PENDING' ? 'pending'
    : 'failed'

  // 303 so the browser follows with GET: without it the redirect repeats this POST.
  return NextResponse.redirect(new URL(`/?topup=${state}`, origin), { status: 303 })
}

export async function POST(request: Request) { return handle(request) }
export async function GET(request: Request) { return handle(request) }
