export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:5000'

export type User = {
  id: string
  name: string
  email: string
  avatarUrl: string | null
}

export type EmailSummary = {
  id: string
  recipient: string
  subject: string
  body?: string
  scheduledAt?: string
  sentAt?: string | null
  status: string
  createdAt?: string
  messageId?: string | null
  previewUrl?: string | null
  hourlyLimit?: number | null
  attachments?: EmailAttachment[]
}

export type EmailDetail = EmailSummary & {
  body: string
  attempts: number
  failedAt: string | null
  jobId: string | null
  lastError: string | null
  updatedAt: string
}

export type EmailAttachment = {
  id: string
  filename: string
  mimeType: string
  size: number
  url: string
  createdAt: string
}

export type AttachmentPayload = {
  filename: string
  mimeType: string
  data: string
}

type ApiOptions = RequestInit & {
  json?: unknown
}

export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export async function apiRequest<T>(
  path: string,
  options: ApiOptions = {},
): Promise<T> {
  const headers = new Headers(options.headers)

  if (options.json !== undefined) {
    headers.set('Content-Type', 'application/json')
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
    credentials: 'include',
    body:
      options.json !== undefined ? JSON.stringify(options.json) : options.body,
  })

  if (!response.ok) {
    let message = 'Request failed.'

    try {
      const payload = (await response.json()) as { message?: string }
      message = payload.message || message
    } catch {
      message = response.statusText || message
    }

    throw new ApiError(response.status, message)
  }

  if (response.status === 204) {
    return undefined as T
  }

  return response.json() as Promise<T>
}

export function startGoogleLogin() {
  window.location.href = `${API_BASE_URL}/api/auth/google`
}

export async function getCurrentUser() {
  return apiRequest<{ user: User }>('/api/auth/me')
}

export async function logoutUser() {
  return apiRequest<void>('/api/auth/logout', { method: 'POST' })
}

export async function getScheduledEmails() {
  return apiRequest<{ emails: EmailSummary[] }>('/api/emails/scheduled')
}

export async function getSentEmails() {
  return apiRequest<{ emails: EmailSummary[] }>('/api/emails/sent')
}

export async function getEmailById(id: string) {
  return apiRequest<{ email: EmailDetail }>(`/api/emails/${id}`)
}

export async function createScheduledEmail(input: {
  recipient: string
  subject: string
  body: string
  scheduledAt: string
  hourlyLimit?: number | null
  batchId?: string
  attachments?: AttachmentPayload[]
}) {
  return apiRequest<{ email: EmailDetail }>('/api/emails', {
    method: 'POST',
    json: input,
  })
}
