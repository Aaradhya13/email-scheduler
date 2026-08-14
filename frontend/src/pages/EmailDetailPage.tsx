import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AttachmentIcon, StarIcon } from '../components/Icons'
import { API_BASE_URL, ApiError, getEmailById } from '../lib/api'
import type { EmailDetail } from '../lib/api'

function formatDateTime(value?: string | null) {
  if (!value) return ''
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value))
}

export default function EmailDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [email, setEmail] = useState<EmailDetail | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!id) return

    getEmailById(id)
      .then((response) => setEmail(response.email))
      .catch((requestError) => {
        const message =
          requestError instanceof ApiError
            ? requestError.message
            : 'Could not load email.'
        setError(message)
      })
  }, [id])

  if (error) {
    return <p className="error-text detail-error">{error}</p>
  }

  if (!email) {
    return <p className="state-text detail-error">Loading email...</p>
  }

  return (
    <article className="detail-pane">
      <header className="detail-header">
        <button className="back-button" type="button" onClick={() => navigate(-1)}>
          <span aria-hidden="true">&larr;</span> {email.subject}
        </button>
        <div className="detail-actions">
          <StarIcon />
          <div className="avatar small">A</div>
        </div>
      </header>

      <div className="message-meta">
        <div className="avatar initial">A</div>
        <div>
          <div className="sender-line">Outbox Labs</div>
          <div className="muted">to {email.recipient}</div>
        </div>
        <time>{formatDateTime(email.sentAt || email.scheduledAt)}</time>
      </div>

      <div className="message-body">
        {email.body.split('\n').map((line, index) => (
          <p key={`${index}-${line.slice(0, 16)}`}>{line || '\u00A0'}</p>
        ))}
      </div>

      {email.previewUrl && (
        <a
          className="preview-link"
          href={email.previewUrl}
          target="_blank"
          rel="noreferrer"
        >
          Open Ethereal preview
        </a>
      )}

      {email.attachments && email.attachments.length > 0 && (
        <div className="attachment-strip">
          {email.attachments.map((attachment) => {
            const url = `${API_BASE_URL}${attachment.url}`
            const isImage = attachment.mimeType.startsWith('image/')

            return (
              <a
                className="attachment-card"
                href={url}
                target="_blank"
                rel="noreferrer"
                key={attachment.id}
              >
                {isImage ? (
                  <img src={url} alt="" />
                ) : (
                  <AttachmentIcon />
                )}
                <div>
                  <strong>{attachment.filename}</strong>
                  <span>
                    {attachment.mimeType} · {(attachment.size / 1024).toFixed(1)} KB
                  </span>
                </div>
              </a>
            )
          })}
        </div>
      )}
    </article>
  )
}
