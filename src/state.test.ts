import assert from 'node:assert/strict'
import test from 'node:test'

import { SessionStore, SOCKET_OPEN, type SessionSocket } from './state.js'

test('keeps first-seen ordering when a session reconnects', () => {
  const store = new SessionStore()
  const alphaSocket = new FakeSocket()
  const betaSocket = new FakeSocket()

  store.connectClient(alphaSocket, '/?id=alpha')
  store.connectClient(betaSocket, '/?id=beta')
  store.disconnectClient('alpha', alphaSocket)
  store.connectClient(new FakeSocket(), '/?id=alpha')

  assert.deepEqual(
    store.getSnapshot().sessions.map((session) => session.id),
    ['alpha', 'beta'],
  )
})

test('restores an existing session by id without losing draft or transcript', () => {
  const store = new SessionStore()
  const firstSocket = new FakeSocket()

  store.connectClient(firstSocket, '/?id=resume-me')
  store.setDraft('resume-me', 'saved draft')
  store.receiveSocketPayload('resume-me', firstSocket, JSON.stringify({ message: 'hello' }))
  store.disconnectClient('resume-me', firstSocket)

  const replacementSocket = new FakeSocket()
  store.connectClient(replacementSocket, '/?id=resume-me')

  const session = getSession(store, 'resume-me')
  const lastEntry = session.entries.at(-1)

  assert.equal(session.draft, 'saved draft')
  assert.equal(session.entries.some((entry) => entry.kind === 'message' && entry.text === 'hello'), true)
  assert.equal(lastEntry?.kind, 'event')
  assert.equal(lastEntry?.kind === 'event' ? lastEntry.event : null, 'reconnected')
})

test('marks unseen activity on connect and clears it on focus', () => {
  const store = new SessionStore()

  store.connectClient(new FakeSocket(), '/?id=alpha')
  assert.equal(getSession(store, 'alpha').hasUnseenActivity, true)

  store.markSeen('alpha')
  assert.equal(getSession(store, 'alpha').hasUnseenActivity, false)
})

test('appends timestamped chat entries when sending and receiving', () => {
  const store = new SessionStore()
  const socket = new FakeSocket()

  store.connectClient(socket, '/?id=chat')
  store.setDraft('chat', 'ping')

  assert.equal(store.sendDraft('chat'), true)
  store.receiveSocketPayload('chat', socket, JSON.stringify({ message: 'pong' }))

  const session = getSession(store, 'chat')
  const youMessage = session.entries.find(
    (entry) => entry.kind === 'message' && entry.sender === 'you',
  )
  const remoteMessage = session.entries.find(
    (entry) => entry.kind === 'message' && entry.sender === 'remote',
  )

  assert.equal(socket.sent[0], JSON.stringify({ message: 'ping' }))
  assert.equal(typeof youMessage?.timestamp, 'number')
  assert.equal(typeof remoteMessage?.timestamp, 'number')
})

test('records disconnect events and prevents sending while disconnected', () => {
  const store = new SessionStore()
  const socket = new FakeSocket()

  store.connectClient(socket, '/?id=offline')
  store.setDraft('offline', 'will not send')
  store.disconnectClient('offline', socket)
  const lastEntry = getSession(store, 'offline').entries.at(-1)

  assert.equal(store.sendDraft('offline'), false)
  assert.equal(lastEntry?.kind, 'event')
  assert.equal(lastEntry?.kind === 'event' ? lastEntry.event : null, 'disconnected')
})

function getSession(store: SessionStore, id: string) {
  const session = store.getSnapshot().sessions.find((entry) => entry.id === id)

  if (!session) {
    throw new Error(`Missing session: ${id}`)
  }

  return session
}

class FakeSocket implements SessionSocket {
  readyState = SOCKET_OPEN
  readonly sent: string[] = []

  send(data: string) {
    this.sent.push(data)
  }

  close() {
    this.readyState = 3
  }
}
