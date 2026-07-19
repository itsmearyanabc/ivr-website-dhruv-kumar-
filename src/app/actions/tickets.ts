/* eslint-disable @typescript-eslint/no-explicit-any */
'use server'

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { checkIsAdmin } from '@/app/actions/auth'

export async function getTickets() {
  const isAdmin = await checkIsAdmin()
  const supabase = isAdmin ? await createAdminClient() : await createClient()

  // RLS filters tickets automatically
  const { data: tickets, error } = await supabase
    .from('support_tickets')
    .select(`
      *,
      users!inner (
        company_name
      ),
      support_messages (
        body,
        created_at
      )
    `)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('Fetch Tickets Error:', error)
    return { error: 'Failed to fetch tickets' }
  }

  // Format payload for frontend
  const formatted = tickets?.map((t: any) => {
    // Find earliest non-internal message for 'message' field
    const sortedMessages = t.support_messages?.sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) || []
    const firstMessage = sortedMessages[0]
    const latestMessageTime = sortedMessages.length > 0 ? sortedMessages[sortedMessages.length - 1].created_at : null

    return {
      ...t,
      customer: t.users?.company_name || 'Unknown',
      message: firstMessage?.body || '',
      latest_message_time: latestMessageTime
    }
  })

  return { data: formatted }
}

export async function createTicket(formData: FormData) {
  const isAdmin = await checkIsAdmin()
  if (!isAdmin) return { error: 'Unauthorized' }
  const supabase = await createAdminClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) return { error: 'Unauthorized' }

  const subject = String(formData.get("subject") || "")
  const priority = String(formData.get("priority") || "NORMAL").toUpperCase()
  const message = String(formData.get("message") || "")

  if (!subject || !message) {
    return { error: 'Missing subject or message.' }
  }

  const reference_no = `TK-${209 + Math.floor(Math.random() * 90)}`

  const { data: ticket, error } = await supabase
    .from('support_tickets')
    .insert([
      {
        user_id: user.id,
        reference_no,
        subject,
        priority,
        status: 'OPEN'
      }
    ])
    .select()
    .single()

  if (error || !ticket) {
    console.error('Create Ticket Error:', error)
    return { error: 'Failed to create ticket' }
  }

  // Insert initial message
  await supabase
    .from('support_messages')
    .insert([
      {
        ticket_id: ticket.id,
        sender_id: user.id,
        body: message
      }
    ])

  return { data: ticket }
}

export async function updateTicketStatus(id: string, status: string, replyMessage?: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: ticket, error } = await supabase
    .from('support_tickets')
    .update({ status: status.toUpperCase(), updated_at: new Date().toISOString() })
    .or(`reference_no.eq.${id},id.eq.${id}`)
    .select()
    .single()

  if (error || !ticket) {
    console.error('Update Ticket Error:', error)
    return { error: 'Failed to update ticket' }
  }

  if (replyMessage && user) {
    await supabase
      .from('support_messages')
      .insert([
        {
          ticket_id: ticket.id,
          sender_id: user.id,
          body: replyMessage
        }
      ])
  }

  return { data: ticket }
}
