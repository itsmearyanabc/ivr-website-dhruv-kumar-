/* eslint-disable @typescript-eslint/no-explicit-any */
'use server'

import { createClient, createAdminClient, createServiceRoleClient } from '@/lib/supabase/server'
import { checkIsAdmin } from '@/app/actions/auth'

export async function getTickets() {
  const isAdmin = await checkIsAdmin()
  const supabaseAuth = await createClient()
  const { data: { user } } = await supabaseAuth.auth.getUser()
  if (!user) return { error: 'Unauthorized' }

  const supabase = await createServiceRoleClient()

  let query = supabase
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
    
  if (!isAdmin) {
    query = query.eq('user_id', user.id)
  }

  const { data: tickets, error } = await query

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
    const replyMessage = sortedMessages.length > 1 ? sortedMessages[sortedMessages.length - 1].body : undefined

    return {
      ...t,
      customer: t.users?.company_name || 'Unknown',
      message: firstMessage?.body || '',
      latest_message_time: latestMessageTime,
      reply: replyMessage
    }
  })

  return { data: formatted }
}

export async function createTicket(formData: FormData) {
  const supabaseAuth = await createClient()
  const { data: { user }, error: authError } = await supabaseAuth.auth.getUser()

  if (authError) return { error: 'Unauthorized: ' + authError.message }
  if (!user) return { error: 'Unauthorized: No active user session.' }

  const supabase = await createServiceRoleClient()

  const subject = String(formData.get("subject") || "")
  const priority = String(formData.get("priority") || "NORMAL").toUpperCase()
  const message = String(formData.get("message") || "")

  if (!subject || !message) {
    return { error: 'Missing subject or message.' }
  }

  const reference_no = `TK-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`

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
  const { error: msgError } = await supabase
    .from('support_messages')
    .insert([
      {
        ticket_id: ticket.id,
        sender_id: user.id,
        body: message
      }
    ])

  if (msgError) {
    console.error('Create Ticket Message Error:', msgError)
  }

  return { data: ticket }
}

export async function updateTicketStatus(id: string, status: string, replyMessage?: string) {
  const isAdmin = await checkIsAdmin()
  if (!isAdmin) return { error: 'Unauthorized' }
  
  const supabaseAuth = await createClient()
  const { data: { user } } = await supabaseAuth.auth.getUser()
  if (!user) return { error: 'Unauthorized' }

  const supabase = await createServiceRoleClient()

  const validTicketStatuses = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']
  if (!validTicketStatuses.includes(status.toUpperCase())) {
    return { error: 'Invalid status value.' }
  }

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

  if (replyMessage) {
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
