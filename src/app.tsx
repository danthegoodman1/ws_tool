import { Box, Text, useInput, useStdin } from 'ink'
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'

import type {
  SessionEntry,
  SessionEventType,
  SessionSnapshot,
  SessionStore,
} from './state.js'

type FocusMode = 'nav' | 'chat'

type AppProps = {
  port: number
  store: SessionStore
}

export function App({ port, store }: AppProps) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const sessions = snapshot.sessions
  const rows = process.stdout.rows ?? 24
  const { isRawModeSupported } = useStdin()
  const [focusMode, setFocusMode] = useState<FocusMode>('nav')
  const [selectedId, setSelectedId] = useState<string | null>(sessions[0]?.id ?? null)

  const selectedSession = useMemo(
    () => sessions.find((session) => session.id === selectedId) ?? null,
    [selectedId, sessions],
  )

  useEffect(() => {
    if (sessions.length === 0) {
      setSelectedId(null)
      setFocusMode('nav')
      return
    }

    if (!selectedId || !sessions.some((session) => session.id === selectedId)) {
      setSelectedId(sessions[0].id)
    }
  }, [selectedId, sessions])

  useEffect(() => {
    if (focusMode === 'chat' && selectedSession) {
      store.markSeen(selectedSession.id)
    }
  }, [focusMode, selectedSession, store])

  const visibleEntryCount = Math.max(6, rows - 14)
  const visibleEntries = selectedSession?.entries.slice(-visibleEntryCount) ?? []

  return (
    <Box flexDirection="column" padding={1} height={rows}>
      {isRawModeSupported ? (
        <InteractiveInputController
          focusMode={focusMode}
          selectedId={selectedId}
          selectedSession={selectedSession}
          sessions={sessions}
          setFocusMode={setFocusMode}
          setSelectedId={setSelectedId}
          store={store}
        />
      ) : null}

      <Box marginBottom={1} justifyContent="space-between">
        <Text bold>Ink WebSocket Chat</Text>
        <Text dimColor>
          listening on ws://0.0.0.0:{port}
        </Text>
      </Box>

      <Box flexDirection="row" gap={1} flexGrow={1}>
        <Box
          width="25%"
          minWidth={24}
          borderStyle="round"
          borderColor={focusMode === 'nav' ? 'blue' : undefined}
          flexDirection="column"
          padding={1}
          flexGrow={1}
        >
          <PaneTitle title="Sessions" isActive={focusMode === 'nav'} />

          <Box flexDirection="column" marginTop={1} flexGrow={1}>
            {sessions.length === 0 ? (
              <>
                <Text dimColor>No sessions yet</Text>
                <Text dimColor>Connect a websocket client to begin</Text>
              </>
            ) : (
              sessions.map((session) => (
                <SessionListRow
                  key={session.id}
                  isSelected={session.id === selectedId}
                  session={session}
                />
              ))
            )}
          </Box>

          <Box marginTop={1} flexDirection="column">
            <Text dimColor>Up/Down move</Text>
            <Text dimColor>Enter focus chat</Text>
          </Box>
        </Box>

        <Box
          width="75%"
          borderStyle="round"
          borderColor={focusMode === 'chat' ? 'blue' : undefined}
          flexDirection="column"
          padding={1}
          flexGrow={1}
        >
          <PaneTitle title="Chat" isActive={focusMode === 'chat'} />

          {selectedSession ? (
            <>
              <Box marginTop={1} flexDirection="column">
                <Text wrap="truncate-end">
                  session: {selectedSession.id}
                </Text>
                <Text dimColor>
                  status: {selectedSession.status}
                  {selectedSession.lastConnectedAt !== selectedSession.connectedAt ? ' | resumed' : ''}
                </Text>
              </Box>

              <Box marginTop={1} flexDirection="column" flexGrow={1}>
                {visibleEntries.length === 0 ? (
                  <Text dimColor>No transcript yet</Text>
                ) : (
                  visibleEntries.map((entry, index) => (
                    <TranscriptRow
                      key={`${entry.kind}-${entry.timestamp}-${index}`}
                      entry={entry}
                    />
                  ))
                )}
              </Box>

              <Box marginTop={1} flexDirection="column">
                {selectedSession.status === 'connected' ? (
                  <DraftInput
                    draft={selectedSession.draft}
                    showCursor={focusMode === 'chat'}
                  />
                ) : (
                  <Text color="red">{'>>> DISCONNECTED <<<'}</Text>
                )}
                <Text dimColor>
                  {selectedSession.status === 'connected'
                    ? 'Type text | Enter send | Shift+Tab sessions'
                    : 'Shift+Tab sessions'}
                </Text>
              </Box>
            </>
          ) : (
            <Box marginTop={1} flexDirection="column">
              <Text>No session selected</Text>
              <Text dimColor>Optional resume id: ws://localhost:{port}/?id=my-client</Text>
              <Text dimColor>{'Payload: {"message":"hello"}'}</Text>
            </Box>
          )}
        </Box>
      </Box>

      {!isRawModeSupported ? (
        <Box marginTop={1}>
          <Text dimColor>Interactive key input is unavailable in this terminal.</Text>
        </Box>
      ) : null}
    </Box>
  )
}

function InteractiveInputController({
  focusMode,
  selectedId,
  selectedSession,
  sessions,
  setFocusMode,
  setSelectedId,
  store,
}: {
  focusMode: FocusMode
  selectedId: string | null
  selectedSession: SessionSnapshot | null
  sessions: SessionSnapshot[]
  setFocusMode: (mode: FocusMode) => void
  setSelectedId: (id: string) => void
  store: SessionStore
}) {
  useInput((input, key) => {
    if (focusMode === 'nav') {
      if (key.upArrow) {
        moveSelection(sessions, selectedId, setSelectedId, -1)
        return
      }

      if (key.downArrow) {
        moveSelection(sessions, selectedId, setSelectedId, 1)
        return
      }

      if (key.return && selectedSession) {
        setFocusMode('chat')
        store.markSeen(selectedSession.id)
      }

      return
    }

    if (key.shift && key.tab) {
      setFocusMode('nav')
      return
    }

    if (!selectedSession || selectedSession.status === 'disconnected') {
      return
    }

    if (key.return) {
      store.sendDraft(selectedSession.id)
      return
    }

    if (key.backspace || key.delete) {
      store.setDraft(selectedSession.id, removeLastCharacter(selectedSession.draft))
      return
    }

    const nextDraftChunk = sanitizeDraftInput(input)

    if (nextDraftChunk.length > 0) {
      store.setDraft(selectedSession.id, selectedSession.draft + nextDraftChunk)
    }
  })

  return null
}

function PaneTitle({ isActive, title }: { isActive: boolean; title: string }) {
  return (
    <Text bold color={isActive ? 'cyan' : undefined}>
      {title}
      {isActive ? ' [active]' : ''}
    </Text>
  )
}

function SessionListRow({
  isSelected,
  session,
}: {
  isSelected: boolean
  session: SessionSnapshot
}) {
  return (
    <Box justifyContent="space-between">
      <Box flexGrow={1} marginRight={1}>
        <Text
          inverse={isSelected}
          dimColor={session.status === 'disconnected'}
          wrap="truncate-end"
        >
          {session.id}
        </Text>
      </Box>
      {session.hasUnseenActivity ? <Text color="blue">●</Text> : <Text dimColor> </Text>}
    </Box>
  )
}

function TranscriptRow({ entry }: { entry: SessionEntry }) {
  return (
    <Box>
      <Box width={9} marginRight={1}>
        <Text dimColor>{formatTimestamp(entry.timestamp)}</Text>
      </Box>
      {entry.kind === 'message' ? (
        <Box flexGrow={1}>
          <Text color={entry.sender === 'remote' ? 'cyan' : 'green'}>
            {entry.sender === 'remote' ? 'remote>' : 'you>'}
          </Text>
          <Text> </Text>
          <Text wrap="truncate-end">{entry.text}</Text>
        </Box>
      ) : (
        <Box flexGrow={1}>
          <Text color={eventColor(entry.event)} wrap="truncate-end">
            {formatEventLabel(entry.event)}
          </Text>
        </Box>
      )}
    </Box>
  )
}

function DraftInput({
  draft,
  showCursor,
}: {
  draft: string
  showCursor: boolean
}) {
  return (
    <Box>
      <Box flexGrow={1}>
        <Text wrap="truncate-end">
          <Text color="green">you&gt; </Text>
          <Text>{draft}</Text>
          {showCursor ? <Text inverse> </Text> : null}
        </Text>
      </Box>
    </Box>
  )
}

function moveSelection(
  sessions: SessionSnapshot[],
  selectedId: string | null,
  setSelectedId: (id: string) => void,
  delta: -1 | 1,
) {
  if (sessions.length === 0) {
    return
  }

  const selectedIndex = Math.max(
    0,
    sessions.findIndex((session) => session.id === selectedId),
  )
  const nextIndex = Math.min(
    sessions.length - 1,
    Math.max(0, selectedIndex + delta),
  )

  setSelectedId(sessions[nextIndex].id)
}

function formatTimestamp(timestamp: number) {
  const date = new Date(timestamp)

  return [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map((value) => value.toString().padStart(2, '0'))
    .join(':')
}

function formatEventLabel(event: SessionEventType) {
  if (event === 'connected') {
    return 'event> connected'
  }

  if (event === 'reconnected') {
    return 'event> reconnected'
  }

  return 'event> disconnected'
}

function eventColor(event: SessionEventType) {
  if (event === 'connected') {
    return 'green'
  }

  if (event === 'reconnected') {
    return 'yellow'
  }

  return 'red'
}

function sanitizeDraftInput(input: string) {
  return input
    .replace(/[\r\n]+/g, ' ')
    .replace(/\t+/g, ' ')
    .replace(/[\u0000-\u001f\u007f]+/g, '')
}

function removeLastCharacter(value: string) {
  if (value.length === 0) {
    return value
  }

  return value.slice(0, -1)
}
