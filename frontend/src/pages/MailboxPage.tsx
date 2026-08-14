import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { StarIcon } from '../components/Icons'
import { ApiError, getScheduledEmails, getSentEmails } from '../lib/api'
import type { EmailSummary } from '../lib/api'
import { formatMailboxDateTime } from '../lib/dateTime'

type MailboxPageProps = {
  type: 'scheduled' | 'sent'
}

export default function MailboxPage({ type }: MailboxPageProps) {
  const navigate = useNavigate()
  const [emails, setEmails] = useState<EmailSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const loadEmails = useCallback(async (showLoading = false) => {
    if (showLoading) {
      setLoading(true)
    }
    setError('')

    try {
      const response =
        type === 'scheduled' ? await getScheduledEmails() : await getSentEmails()
      setEmails(response.emails)
    } catch (requestError) {
      const message =
        requestError instanceof ApiError
          ? requestError.message
          : 'Could not load emails.'
      setError(message)
    } finally {
      setLoading(false)
    }
  }, [type])

  useEffect(() => {
    queueMicrotask(() => void loadEmails(true))
  }, [loadEmails])

  useEffect(() => {
    function handleRefresh() {
      void loadEmails()
    }

    const timer = window.setInterval(handleRefresh, 12_000)
    window.addEventListener('focus', handleRefresh)
    window.addEventListener('outbox:refresh-mailbox', handleRefresh)

    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', handleRefresh)
      window.removeEventListener('outbox:refresh-mailbox', handleRefresh)
    }
  }, [loadEmails])

  return (
    <section className="mailbox-list">
      {loading && <p className="state-text">Loading emails...</p>}
      {error && <p className="error-text">{error}</p>}
      {!loading && !error && emails.length === 0 && (
        <p className="state-text">No {type} emails yet.</p>
      )}

      {emails.map((email) => {
        const time = type === 'scheduled' ? email.scheduledAt : email.sentAt

        return (
          <button
            key={email.id}
            className="email-row"
            type="button"
            onClick={() => navigate(`/email/${email.id}`)}
          >
            <div className="email-recipient">To: {email.recipient}</div>
            <div className="email-main">
              <span className={type === 'scheduled' ? 'badge orange' : 'badge'}>
                {type === 'scheduled' ? formatMailboxDateTime(time) : formatMailboxDateTime(time) || 'Sent'}
              </span>
              <span className="status-pill">{email.status}</span>
              <span className="email-subject">{email.subject}</span>
              <span className="email-preview">
                - {email.body || email.status || 'Open email details'}
              </span>
            </div>
            <StarIcon className="row-star" />
          </button>
        )
      })}
    </section>
  )
}
