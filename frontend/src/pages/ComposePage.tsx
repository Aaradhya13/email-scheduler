import Papa from 'papaparse'
import { useMemo, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { AttachmentIcon } from '../components/Icons'
import { useAuth } from '../context/AuthContext'
import { ApiError, createScheduledEmail } from '../lib/api'
import type { AttachmentPayload, EmailDetail } from '../lib/api'
import { parseDateTimeLocal, toDateTimeLocalValue } from '../lib/dateTime'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MAX_ATTACHMENT_SIZE_BYTES = 5 * 1024 * 1024

function tomorrowAt(hour: number) {
  const date = new Date()
  date.setDate(date.getDate() + 1)
  date.setHours(hour, 0, 0, 0)
  return date
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`))
    reader.readAsDataURL(file)
  })
}

async function createAttachmentPayloads(files: File[]): Promise<AttachmentPayload[]> {
  return Promise.all(
    files.map(async (file) => ({
      filename: file.name,
      mimeType: file.type || 'application/octet-stream',
      data: await readFileAsDataUrl(file),
    })),
  )
}

export default function ComposePage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const editorRef = useRef<HTMLDivElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const csvInputRef = useRef<HTMLInputElement | null>(null)

  const [recipientInput, setRecipientInput] = useState('')
  const [recipients, setRecipients] = useState<string[]>([])
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [delayBetweenEmails, setDelayBetweenEmails] = useState('0')
  const [hourlyLimit, setHourlyLimit] = useState('0')
  const [csvImport, setCsvImport] = useState<{
    valid: string[]
    invalidCount: number
    duplicateCount: number
  } | null>(null)
  const [attachments, setAttachments] = useState<File[]>([])
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [scheduledAt, setScheduledAt] = useState<Date | null>(null)
  const [draftScheduleValue, setDraftScheduleValue] = useState(
    toDateTimeLocalValue(tomorrowAt(10)),
  )
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [sending, setSending] = useState(false)

  const scheduleLabel = useMemo(() => {
    if (!scheduledAt) return 'Send Later'

    return new Intl.DateTimeFormat('en', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(scheduledAt)
  }, [scheduledAt])

  const csvFeedback = useMemo(() => {
    if (!csvImport) return ''

    const selectedImportedCount = csvImport.valid.filter((email) =>
      recipients.includes(email),
    ).length
    const removedCount = csvImport.valid.length - selectedImportedCount
    const parts = [
      `${selectedImportedCount} of ${csvImport.valid.length} imported recipients currently selected`,
    ]

    if (removedCount > 0) {
      parts.push(`${removedCount} removed`)
    }

    if (csvImport.duplicateCount > 0) {
      parts.push(`${csvImport.duplicateCount} duplicate${csvImport.duplicateCount === 1 ? '' : 's'} skipped`)
    }

    if (csvImport.invalidCount > 0) {
      parts.push(`${csvImport.invalidCount} invalid address${csvImport.invalidCount === 1 ? '' : 'es'} skipped`)
    }

    return parts.join(' - ')
  }, [csvImport, recipients])

  function addRecipient(value: string): boolean {
    const clean = value.trim().replace(/,$/, '').toLowerCase()

    if (!clean) return true

    if (!EMAIL_PATTERN.test(clean)) {
      setFieldErrors((current) => ({
        ...current,
        recipients: `Enter a valid email address: ${clean}`,
      }))
      return false
    }

    setRecipients((current) =>
      current.includes(clean) ? current : [...current, clean],
    )
    setRecipientInput('')
    setFieldErrors((current) => ({ ...current, recipients: '' }))
    setError('')
    return true
  }

  function removeRecipient(email: string) {
    setRecipients((current) => current.filter((item) => item !== email))
  }

  function handleRecipientKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (['Enter', ',', 'Tab'].includes(event.key)) {
      event.preventDefault()
      addRecipient(recipientInput)
    }
  }

  function runEditorCommand(command: string, value?: string) {
    editorRef.current?.focus()
    document.execCommand(command, false, value)
    setBody(editorRef.current?.innerText.trim() || '')
    setFieldErrors((current) => ({ ...current, body: '' }))
  }

  function handleCsvUpload(file: File) {
    Papa.parse<string[]>(file, {
      complete: (result) => {
        const found = new Set<string>()
        const invalid: string[] = []

        result.data.flat().forEach((cell) => {
          const candidates = String(cell)
            .split(/[\s,;]+/)
            .map((value) => value.trim().toLowerCase())
            .filter(Boolean)

          candidates.forEach((candidate) => {
            if (EMAIL_PATTERN.test(candidate)) {
              found.add(candidate)
            } else if (candidate.includes('@')) {
              invalid.push(candidate)
            }
          })
        })

        let duplicateCount = 0
        setRecipients((current) => {
          const merged = new Set(current)
          found.forEach((email) => {
            if (merged.has(email)) {
              duplicateCount += 1
            } else {
              merged.add(email)
            }
          })
          return Array.from(merged)
        })

        setCsvImport({
          valid: Array.from(found),
          invalidCount: invalid.length,
          duplicateCount,
        })
        setFieldErrors((current) => ({ ...current, recipients: '' }))
        setError('')
      },
      error: () =>
        setFieldErrors((current) => ({
          ...current,
          recipients: 'Could not parse the CSV file.',
        })),
    })
  }

  function validateForm(requireSchedule: boolean, scheduleDate = scheduledAt): string[] | null {
    const nextErrors: Record<string, string> = {}
    const cleanInput = recipientInput.trim().replace(/,$/, '').toLowerCase()

    if (cleanInput && !EMAIL_PATTERN.test(cleanInput)) {
      nextErrors.recipients = `Enter a valid email address: ${cleanInput}`
      setFieldErrors(nextErrors)
      return null
    }

    const finalRecipients = collectRecipients()

    if (!finalRecipients.length) {
      nextErrors.recipients = 'Add at least one valid recipient.'
    }

    if (!subject.trim()) {
      nextErrors.subject = 'Subject is required.'
    }

    const currentBody = editorRef.current?.innerText.trim() || body.trim()

    if (!currentBody) {
      nextErrors.body = 'Email body is required.'
    }

    if (requireSchedule) {
      if (!scheduleDate) {
        nextErrors.schedule = 'Choose a future date and time.'
      } else if (scheduleDate.getTime() <= Number(new Date())) {
        nextErrors.schedule = 'Choose a future date and time.'
      }
    }

    if (Object.keys(nextErrors).length > 0) {
      setFieldErrors(nextErrors)
      return null
    }

    setBody(currentBody)
    setRecipients(finalRecipients)
    setRecipientInput('')
    setFieldErrors({})
    setError('')
    return finalRecipients
  }

  function collectRecipients() {
    const cleanInput = recipientInput.trim().replace(/,$/, '').toLowerCase()

    if (!cleanInput) return recipients

    if (!EMAIL_PATTERN.test(cleanInput)) return recipients

    return Array.from(new Set([...recipients, cleanInput]))
  }

  function getDelayMs() {
    const numericDelay = Number(delayBetweenEmails)

    if (!Number.isFinite(numericDelay) || numericDelay < 0) {
      return null
    }

    return numericDelay * 1000
  }

  function getHourlyLimit() {
    if (!hourlyLimit.trim() || Number(hourlyLimit) === 0) {
      return null
    }

    const numericLimit = Number(hourlyLimit)

    if (!Number.isInteger(numericLimit) || numericLimit < 1) {
      return null
    }

    return numericLimit
  }

  function normalizeNonNegativeNumber(value: string) {
    if (value === '') return ''
    const numericValue = Number(value)
    if (!Number.isFinite(numericValue) || numericValue < 0) return '0'
    return String(Math.floor(numericValue))
  }

  function handleNumberInput(value: string, setter: (nextValue: string) => void) {
    if (value === '') {
      setter('')
      return
    }

    if (!/^\d+$/.test(value)) return

    setter(String(Number(value)))
  }

  async function submitEmail(
    event?: FormEvent,
    sendLater = false,
    scheduleOverride?: Date | null,
  ) {
    event?.preventDefault()

    const selectedSchedule = scheduleOverride ?? scheduledAt
    const finalRecipients = validateForm(sendLater, selectedSchedule)

    if (!finalRecipients) return

    const delayMs = getDelayMs()
    const parsedHourlyLimit = getHourlyLimit()

    if (delayMs === null) {
      setFieldErrors({ delay: 'Delay must be a non-negative number of seconds.' })
      return
    }

    if (hourlyLimit.trim() && Number(hourlyLimit) !== 0 && parsedHourlyLimit === null) {
      setFieldErrors({
        hourlyLimit: 'Hourly Limit must be a positive whole number, or 0 to use the backend default.',
      })
      return
    }

    const baseSendAt = sendLater
      ? selectedSchedule
      : new Date(Number(new Date()) + 10_000)

    if (!baseSendAt) {
      setFieldErrors({ schedule: 'Choose a future date and time.' })
      return
    }

    if (baseSendAt.getTime() <= Number(new Date())) {
      setFieldErrors({ schedule: 'Choose a future date and time.' })
      return
    }

    setSending(true)
    setError('')
    setMessage('')
    setFieldErrors({})

    try {
      const created: EmailDetail[] = []
      const failures: string[] = []
      const attachmentPayloads = await createAttachmentPayloads(attachments)
      const batchId =
        finalRecipients.length > 1
          ? `compose-${Number(new Date())}-${Math.random().toString(36).slice(2, 8)}`
          : undefined

      for (const [index, recipient] of finalRecipients.entries()) {
        const recipientSendAt = new Date(baseSendAt.getTime() + index * delayMs)

        try {
          const response = await createScheduledEmail({
            recipient,
            subject: subject.trim(),
            body: editorRef.current?.innerText.trim() || body.trim(),
            scheduledAt: recipientSendAt.toISOString(),
            hourlyLimit: parsedHourlyLimit,
            batchId,
            attachments: attachmentPayloads,
          })
          created.push(response.email)
        } catch (requestError) {
          const nextMessage =
            requestError instanceof ApiError
              ? requestError.message
              : 'Scheduling failed.'
          failures.push(`${recipient}: ${nextMessage}`)
        }
      }

      if (created.length > 0) {
        setMessage(
          `Scheduled ${created.length} of ${finalRecipients.length} email${finalRecipients.length === 1 ? '' : 's'}.`,
        )
        setRecipients([])
        setRecipientInput('')
        setSubject('')
        setBody('')
        setScheduledAt(null)
        setCsvImport(null)
        setAttachments([])
        if (editorRef.current) editorRef.current.innerText = ''
        window.dispatchEvent(new Event('outbox:refresh-mailbox'))
      }

      if (failures.length > 0) {
        setError(`Some emails failed: ${failures.slice(0, 3).join(' | ')}`)
      } else {
        setTimeout(() => navigate('/scheduled'), 700)
      }
    } catch (requestError) {
      const nextMessage =
        requestError instanceof ApiError
          ? requestError.message
          : 'Could not schedule email.'
      setError(nextMessage)
    } finally {
      setSending(false)
    }
  }

  return (
    <form className="compose-page" onSubmit={(event) => submitEmail(event)}>
      <header className="compose-header">
        <button className="back-button" type="button" onClick={() => navigate(-1)}>
          <span aria-hidden="true">&larr;</span> Compose New Email
        </button>
        <div className="compose-actions">
          <button
            className="small-action"
            type="button"
            onClick={() => fileInputRef.current?.click()}
            aria-label="Add attachment"
          >
            <AttachmentIcon />
            {attachments.length > 0 && <span>{attachments.length}</span>}
          </button>
          <button className="send-button" type="submit" disabled={sending}>
            Send
          </button>
          <button
            className="send-later-button"
            type="button"
            disabled={sending}
            onClick={() => {
              setDraftScheduleValue(
                toDateTimeLocalValue(scheduledAt ?? tomorrowAt(10)),
              )
              setScheduleOpen(true)
            }}
          >
            {scheduledAt ? `Scheduled for ${scheduleLabel}` : 'Send Later'}
          </button>
        </div>

        {scheduleOpen && (
          <>
            <button
              className="schedule-backdrop"
              type="button"
              aria-label="Close schedule dialog"
              onClick={() => setScheduleOpen(false)}
            />
            <div className="schedule-popover" role="dialog" aria-modal="true">
            <h3>Schedule Email</h3>
            <label>
              Date and time
              <input
                type="datetime-local"
                value={draftScheduleValue}
                onChange={(event) => setDraftScheduleValue(event.target.value)}
              />
            </label>
            {fieldErrors.schedule && (
              <span className="field-error schedule-error">{fieldErrors.schedule}</span>
            )}
            <button
              type="button"
              onClick={() => setDraftScheduleValue(toDateTimeLocalValue(tomorrowAt(9)))}
            >
              Tomorrow
            </button>
            <button
              type="button"
              onClick={() => setDraftScheduleValue(toDateTimeLocalValue(tomorrowAt(10)))}
            >
              Tomorrow, 10:00 AM
            </button>
            <button
              type="button"
              onClick={() => setDraftScheduleValue(toDateTimeLocalValue(tomorrowAt(11)))}
            >
              Tomorrow, 11:00 AM
            </button>
            <button
              type="button"
              onClick={() => setDraftScheduleValue(toDateTimeLocalValue(tomorrowAt(15)))}
            >
              Tomorrow, 3:00 PM
            </button>
            <div className="popover-actions">
              <button type="button" onClick={() => setScheduleOpen(false)}>
                Cancel
              </button>
              <button
                className="done-button"
                type="button"
                onClick={() => {
                  const nextSchedule = parseDateTimeLocal(draftScheduleValue)
                  setScheduledAt(nextSchedule)
                  if (!nextSchedule || nextSchedule.getTime() <= Number(new Date())) {
                    setFieldErrors((current) => ({
                      ...current,
                      schedule: 'Choose a future date and time.',
                    }))
                    return
                  }
                  setFieldErrors((current) => ({ ...current, schedule: '' }))
                  setScheduleOpen(false)
                  void submitEmail(undefined, true, nextSchedule)
                }}
              >
                Done
              </button>
            </div>
          </div>
          </>
        )}
      </header>

      <div className="compose-fields">
        <label className="compose-line">
          <span>From</span>
          <div className="from-chip">{user?.email}</div>
        </label>

        <label className="compose-line recipient-line">
          <span>To</span>
          <div className="recipient-box">
            {recipients.map((email) => (
              <span
                className="recipient-chip"
                key={email}
              >
                <span className="recipient-chip-text">{email}</span>
                <button
                  className="recipient-remove"
                  type="button"
                  aria-label={`Remove ${email}`}
                  onClick={() => removeRecipient(email)}
                >
                  ×
                </button>
              </span>
            ))}
            <input
              value={recipientInput}
              placeholder={recipients.length ? '' : 'recipient@example.com'}
              onBlur={() => {
                if (recipientInput.trim()) addRecipient(recipientInput)
              }}
              onChange={(event) => setRecipientInput(event.target.value)}
              onKeyDown={handleRecipientKeyDown}
            />
          </div>
          <button
            className="upload-list"
            type="button"
            onClick={() => csvInputRef.current?.click()}
          >
            Upload List
          </button>
        </label>
        {(csvFeedback || fieldErrors.recipients) && (
          <div className="field-feedback-row recipient-feedback">
            {csvFeedback && <span className="detected-row">{csvFeedback}</span>}
            {fieldErrors.recipients && (
              <span className="field-error">{fieldErrors.recipients}</span>
            )}
          </div>
        )}

        <label className="compose-line">
          <span>Subject</span>
          <input
            value={subject}
            placeholder="Subject"
            onChange={(event) => {
              setSubject(event.target.value)
              setFieldErrors((current) => ({ ...current, subject: '' }))
            }}
          />
        </label>
        {fieldErrors.subject && (
          <div className="field-feedback-row">
            <span className="field-error">{fieldErrors.subject}</span>
          </div>
        )}

        <div className="limit-row">
          <label>
            Delay between 2 emails (sec)
            <input
              type="number"
              min="0"
              inputMode="numeric"
              value={delayBetweenEmails}
              onFocus={(event) => event.currentTarget.select()}
              onBlur={(event) =>
                setDelayBetweenEmails(normalizeNonNegativeNumber(event.target.value) || '0')
              }
              onChange={(event) => {
                handleNumberInput(event.target.value, setDelayBetweenEmails)
                setFieldErrors((current) => ({ ...current, delay: '' }))
              }}
            />
          </label>
          <label>
            Hourly Limit
            <input
              type="number"
              min="0"
              inputMode="numeric"
              value={hourlyLimit}
              onFocus={(event) => event.currentTarget.select()}
              onBlur={(event) =>
                setHourlyLimit(normalizeNonNegativeNumber(event.target.value) || '0')
              }
              onChange={(event) => {
                handleNumberInput(event.target.value, setHourlyLimit)
                setFieldErrors((current) => ({ ...current, hourlyLimit: '' }))
              }}
            />
          </label>
          <span className="limit-note">Backend Redis limit remains authoritative.</span>
        </div>
        {(fieldErrors.delay || fieldErrors.hourlyLimit) && (
          <div className="field-feedback-row">
            {fieldErrors.delay && <span className="field-error">{fieldErrors.delay}</span>}
            {fieldErrors.hourlyLimit && (
              <span className="field-error">{fieldErrors.hourlyLimit}</span>
            )}
          </div>
        )}
      </div>

      <section className="editor-shell">
        <div
          ref={editorRef}
          className="editor"
          contentEditable
          data-placeholder="Type Your Reply..."
          onInput={() => setBody(editorRef.current?.innerText.trim() || '')}
          onFocus={() => setFieldErrors((current) => ({ ...current, body: '' }))}
          suppressContentEditableWarning
        />
        <div className="editor-toolbar">
          <button type="button" title="Undo" onClick={() => runEditorCommand('undo')}>
            Undo
          </button>
          <button type="button" title="Redo" onClick={() => runEditorCommand('redo')}>
            Redo
          </button>
          <button type="button" title="Bold" onClick={() => runEditorCommand('bold')}>
            B
          </button>
          <button type="button" title="Italic" onClick={() => runEditorCommand('italic')}>
            I
          </button>
          <button type="button" title="Underline" onClick={() => runEditorCommand('underline')}>
            U
          </button>
        </div>
      </section>
      {fieldErrors.body && (
        <p className="field-error editor-error">{fieldErrors.body}</p>
      )}

      {attachments.length > 0 && (
        <div className="attachment-list">
          {attachments.map((file) => (
            <div className="attachment-pill" key={`${file.name}-${file.size}`}>
              <AttachmentIcon />
              <span>{file.name}</span>
              <button
                type="button"
                aria-label={`Remove ${file.name}`}
                onClick={() =>
                  setAttachments((current) => current.filter((item) => item !== file))
                }
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {error && <p className="error-text">{error}</p>}
      {message && <p className="success-text">{message}</p>}

      <input
        ref={fileInputRef}
        type="file"
        multiple
        hidden
        onChange={(event) =>
          setAttachments((current) => {
            const incoming = Array.from(event.target.files || [])
            const accepted = incoming.filter((file) => {
              if (file.size > MAX_ATTACHMENT_SIZE_BYTES) {
                setError(`${file.name} is larger than 5 MB.`)
                return false
              }
              return true
            })
            return [...current, ...accepted]
          })
        }
      />
      <input
        ref={csvInputRef}
        type="file"
        accept=".csv,text/csv,text/plain"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) handleCsvUpload(file)
        }}
      />
    </form>
  )
}
