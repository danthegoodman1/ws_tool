import process from 'node:process'

import { render } from 'ink'
import { createElement } from 'react'
import { WebSocketServer } from 'ws'

import { App } from './app.js'
import { SessionStore } from './state.js'

const port = parsePort(process.argv.slice(2))
const store = new SessionStore()
const websocketServer = new WebSocketServer({ port })
const app = render(createElement(App, { port, store }))

let hasShutdownStarted = false

websocketServer.on('connection', (socket, request) => {
  const sessionId = store.connectClient(socket, request.url)

  socket.on('message', (payload) => {
    store.receiveSocketPayload(sessionId, socket, payload)
  })

  socket.on('close', () => {
    store.disconnectClient(sessionId, socket)
  })

  socket.on('error', () => {
    // The close event handles the UI transition to disconnected.
  })
})

websocketServer.on('error', (error) => {
  process.exitCode = 1
  console.error(`WebSocket server error: ${error.message}`)
  requestShutdown()
})

process.once('SIGINT', requestShutdown)
process.once('SIGTERM', requestShutdown)

await app.waitUntilExit()
shutdown()

function requestShutdown() {
  if (hasShutdownStarted) {
    return
  }

  hasShutdownStarted = true
  app.unmount()
}

function shutdown() {
  store.closeAllConnections()
  websocketServer.close()
}

function parsePort(arguments_: string[]) {
  const explicitPort = readPortFlag(arguments_)

  if (explicitPort === null) {
    return 8888
  }

  const parsedPort = Number.parseInt(explicitPort, 10)

  if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
    throw new Error(`Invalid port: ${explicitPort}`)
  }

  return parsedPort
}

function readPortFlag(arguments_: string[]) {
  for (const [index, argument] of arguments_.entries()) {
    if (argument === '--port') {
      return arguments_[index + 1] ?? null
    }

    if (argument.startsWith('--port=')) {
      return argument.slice('--port='.length)
    }
  }

  return null
}
