import { createGeneratedSessionId, readClientProvidedId } from './session_id.js'

export const SOCKET_OPEN = 1

type Listener = () => void

export type SessionStatus = 'connected' | 'disconnected'
export type SessionEventType = 'connected' | 'reconnected' | 'disconnected'
export type MessageSender = 'remote' | 'you'

export type SessionEntry =
  | {
      kind: 'message'
      sender: MessageSender
      text: string
      timestamp: number
    }
  | {
      kind: 'event'
      event: SessionEventType
      timestamp: number
    }

export interface SessionSocket {
  readonly readyState: number
  send(data: string): void
  close(code?: number, data?: string): void
}

export interface SessionSnapshot {
  id: string
  connectedAt: number
  lastConnectedAt: number
  status: SessionStatus
  hasUnseenActivity: boolean
  draft: string
  entries: SessionEntry[]
}

export interface StoreSnapshot {
  sessions: SessionSnapshot[]
}

interface SessionInternal extends SessionSnapshot {
  socket: SessionSocket | null
}

export class SessionStore {
  private readonly listeners = new Set<Listener>()
  private readonly sessions = new Map<string, SessionInternal>()
  private snapshotCache: StoreSnapshot = { sessions: [] }
  private isSnapshotDirty = true

  subscribe = (listener: Listener) => {
    this.listeners.add(listener)

    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot = (): StoreSnapshot => {
    if (!this.isSnapshotDirty) {
      return this.snapshotCache
    }

    this.snapshotCache = {
      sessions: [...this.sessions.values()]
        .sort((leftSession, rightSession) => {
          if (leftSession.connectedAt !== rightSession.connectedAt) {
            return leftSession.connectedAt - rightSession.connectedAt
          }

          return leftSession.id.localeCompare(rightSession.id)
        })
        .map((session) => ({
          id: session.id,
          connectedAt: session.connectedAt,
          lastConnectedAt: session.lastConnectedAt,
          status: session.status,
          hasUnseenActivity: session.hasUnseenActivity,
          draft: session.draft,
          entries: session.entries.map((entry) => ({ ...entry })),
        })),
    }
    this.isSnapshotDirty = false

    return this.snapshotCache
  }

  connectClient = (socket: SessionSocket, requestUrl: string | undefined) => {
    const requestedId = readClientProvidedId(requestUrl)
    const sessionId = requestedId ?? createGeneratedSessionId()
    const now = Date.now()
    const existingSession = this.sessions.get(sessionId)

    if (existingSession) {
      this.closeReplacedSocket(existingSession, socket)
      existingSession.lastConnectedAt = now
      existingSession.status = 'connected'
      existingSession.socket = socket
      existingSession.hasUnseenActivity = true
      existingSession.entries.push({
        kind: 'event',
        event: 'reconnected',
        timestamp: now,
      })
      this.emit()

      return sessionId
    }

    this.sessions.set(sessionId, {
      id: sessionId,
      connectedAt: now,
      lastConnectedAt: now,
      status: 'connected',
      socket,
      hasUnseenActivity: true,
      draft: '',
      entries: [
        {
          kind: 'event',
          event: 'connected',
          timestamp: now,
        },
      ],
    })
    this.emit()

    return sessionId
  }

  receiveSocketPayload = (sessionId: string, socket: SessionSocket, payload: unknown) => {
    const session = this.sessions.get(sessionId)

    if (!session || session.socket !== socket) {
      return
    }

    const message = parseIncomingMessage(payload)

    if (message === null) {
      return
    }

    session.entries.push({
      kind: 'message',
      sender: 'remote',
      text: message,
      timestamp: Date.now(),
    })
    this.emit()
  }

  disconnectClient = (sessionId: string, socket: SessionSocket) => {
    const session = this.sessions.get(sessionId)

    if (!session || session.socket !== socket) {
      return
    }

    if (session.status === 'disconnected') {
      return
    }

    session.status = 'disconnected'
    session.socket = null
    session.entries.push({
      kind: 'event',
      event: 'disconnected',
      timestamp: Date.now(),
    })
    this.emit()
  }

  setDraft = (sessionId: string, draft: string) => {
    const session = this.sessions.get(sessionId)

    if (!session || session.draft === draft) {
      return
    }

    session.draft = draft
    this.emit()
  }

  markSeen = (sessionId: string) => {
    const session = this.sessions.get(sessionId)

    if (!session || !session.hasUnseenActivity) {
      return
    }

    session.hasUnseenActivity = false
    this.emit()
  }

  sendDraft = (sessionId: string) => {
    const session = this.sessions.get(sessionId)

    if (!session || !session.socket || session.status !== 'connected') {
      return false
    }

    if (session.socket.readyState !== SOCKET_OPEN) {
      this.disconnectClient(sessionId, session.socket)
      return false
    }

    if (!session.draft.trim()) {
      return false
    }

    try {
      session.socket.send(JSON.stringify({ message: session.draft }))
    } catch {
      return false
    }

    session.entries.push({
      kind: 'message',
      sender: 'you',
      text: session.draft,
      timestamp: Date.now(),
    })
    session.draft = ''
    this.emit()

    return true
  }

  closeAllConnections = () => {
    for (const session of this.sessions.values()) {
      if (session.socket && session.socket.readyState === SOCKET_OPEN) {
        try {
          session.socket.close(1001, 'Server shutting down')
        } catch {
          // Ignore shutdown close errors because the process is already exiting.
        }
      }
    }
  }

  private closeReplacedSocket(session: SessionInternal, incomingSocket: SessionSocket) {
    if (!session.socket || session.socket === incomingSocket) {
      return
    }

    if (session.socket.readyState !== SOCKET_OPEN) {
      return
    }

    try {
      session.socket.close(4000, 'Replaced by newer connection')
    } catch {
      // Ignore close errors when promoting a newer socket for the same logical session.
    }
  }

  private emit() {
    this.isSnapshotDirty = true

    for (const listener of this.listeners) {
      listener()
    }
  }
}

function parseIncomingMessage(payload: unknown) {
  const rawText = decodePayload(payload)

  if (rawText === null) {
    return null
  }

  try {
    const parsedPayload: unknown = JSON.parse(rawText)

    if (
      typeof parsedPayload === 'object' &&
      parsedPayload !== null &&
      'message' in parsedPayload &&
      typeof parsedPayload.message === 'string'
    ) {
      return parsedPayload.message
    }
  } catch {
    return null
  }

  return null
}

function decodePayload(payload: unknown) {
  if (typeof payload === 'string') {
    return payload
  }

  if (payload instanceof ArrayBuffer) {
    return Buffer.from(payload).toString('utf8')
  }

  if (payload instanceof Uint8Array) {
    return Buffer.from(payload).toString('utf8')
  }

  if (Array.isArray(payload)) {
    const bufferParts = payload.flatMap((part) => {
      if (part instanceof Uint8Array) {
        return [Buffer.from(part)]
      }

      if (part instanceof ArrayBuffer) {
        return [Buffer.from(part)]
      }

      return []
    })

    return Buffer.concat(bufferParts).toString('utf8')
  }

  return null
}
