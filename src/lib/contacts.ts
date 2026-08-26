/**
 * Counting the numbers an order actually targets, server-side.
 *
 * Quantity pricing turns the contact count into the multiplier on the invoice, which makes it
 * the one number in the order a customer has a reason to misreport. The browser already
 * counts - it has to, to quote a running total - but that figure is a convenience, never the
 * basis of a charge. Everything billed is counted here.
 *
 * Like `@/lib/storage` and `@/lib/pricing`, this deliberately is NOT a `'use server'` module:
 * every export of one is an endpoint callable from any browser, and `countContactsInFile`
 * takes a storage key.
 */

import * as XLSX from 'xlsx'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { STORAGE_BUCKET } from '@/lib/uploads'
import { countNumbers } from '@/lib/quantity'

/**
 * Largest contact file this will pull back to count.
 *
 * Counting means downloading the object into the web instance, which on Render's small plan
 * is the same 512 MB the rest of the app runs in - the reason uploads were moved off the
 * server in the first place (see `@/lib/uploads`). 12 MB is far beyond a realistic list: a
 * plain-text file of that size holds roughly 800,000 numbers, well past the ceiling any
 * service is going to set. A file larger than this is refused with an explanation rather than
 * billed on the browser's word.
 */
const COUNT_SIZE_LIMIT = 12 * 1024 * 1024

/** Spreadsheet extensions worth handing to the xlsx parser rather than reading as text. */
const SPREADSHEET = /\.(xlsx|xls|xlsm|ods)$/i

export type ContactCount =
  | { ok: true; count: number }
  | { ok: false; error: string }

/**
 * Counts the phone numbers in an uploaded contact list.
 *
 * Text formats are matched with the same parser the browser uses, so a list that quoted one
 * total in the modal bills that total here. Spreadsheets are flattened to CSV first, which
 * also picks up numbers stored in a second or third column.
 */
export async function countContactsInFile(key: string, declaredSize: number): Promise<ContactCount> {
  if (declaredSize > COUNT_SIZE_LIMIT) {
    return {
      ok: false,
      error:
        'That contact list is too large to price automatically. Split it into smaller ' +
        'campaigns, or paste the numbers in directly using "Type / paste".',
    }
  }

  const supabase = await createServiceRoleClient()
  const { data, error } = await supabase.storage.from(STORAGE_BUCKET).download(key)

  if (error || !data) {
    console.error('countContactsInFile download failed:', error)
    return { ok: false, error: 'The uploaded contact list could not be read. Please attach it again.' }
  }

  try {
    if (SPREADSHEET.test(key)) {
      const buffer = await data.arrayBuffer()
      const workbook = XLSX.read(new Uint8Array(buffer), { type: 'array' })
      let count = 0
      // Every sheet, not just the first: a list split across tabs is still one campaign, and
      // charging for only the first tab would under-bill an order the operator then has to
      // deliver in full.
      for (const name of workbook.SheetNames) {
        const sheet = workbook.Sheets[name]
        if (sheet) count += countNumbers(XLSX.utils.sheet_to_csv(sheet))
      }
      return { ok: true, count }
    }

    // CSV, TXT, and anything else the operator can read as text. A PDF or a binary format
    // lands here too and simply yields no matches, which surfaces below as a clear message
    // rather than a silent zero-charge order.
    return { ok: true, count: countNumbers(await data.text()) }
  } catch (e) {
    console.error('countContactsInFile parse failed:', e)
    return {
      ok: false,
      error:
        'The contact list could not be read. Upload it as CSV, TXT or XLSX, or paste the ' +
        'numbers in directly using "Type / paste".',
    }
  }
}
