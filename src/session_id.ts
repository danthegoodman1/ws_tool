import { hri } from 'human-readable-ids'

const REQUEST_BASE_URL = 'ws://localhost'

export function createGeneratedSessionId() {
  return hri.random()
}

export function readClientProvidedId(requestUrl: string | undefined) {
  if (!requestUrl) {
    return null
  }

  const parsedUrl = new URL(requestUrl, REQUEST_BASE_URL)
  const rawId = parsedUrl.searchParams.get('id') ?? parsedUrl.searchParams.get('id?')

  return normalizeSessionId(rawId)
}

function normalizeSessionId(value: string | null) {
  if (value === null) {
    return null
  }

  // Strip control characters so a client-provided id can't break the single-line TUI layout.
  const normalizedValue = value
    .trim()
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[\u0000-\u001f\u007f]+/g, '')
    .trim()

  return normalizedValue.length > 0 ? normalizedValue : null
}
