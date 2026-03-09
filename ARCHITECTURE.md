# Honkai Chat — Architecture

## Overview

Interactive scenario-driven group chat for Honkai: Star Rail roleplay. A monorepo with three packages: `shared`, `server`, `client`. Communication is over WebSocket.

## Package Structure

```
honkai-chat/
├── shared/          — types, constants, protocol (shared between server & client)
│   └── src/
│       ├── constants.ts   — CharacterId, Role, ActorMode, GuestMode, timing
│       ├── models.ts      — ChatMessage, ScenarioStep variants, Scenario, CharacterDef
│       ├── protocol.ts    — ServerMessage / ClientMessage union types
│       └── index.ts       — re-exports all
├── server/          — Node.js WebSocket server
│   └── src/
│       ├── wsHandler.ts       — connection handling, message routing
│       ├── scenarioEngine.ts  — ScenarioEngine class (singleton), step processing
│       ├── state.ts           — ServerState singleton (sessions, messages, pending*)
│       ├── broadcast.ts       — broadcastAll / broadcastToRole / broadcastToCharacterId
│       ├── characters.ts      — character registry, transforms
│       └── scenario/penaconia.json — scenario data
└── client/          — React + Vite SPA
    └── src/
        ├── hooks/
        │   ├── useChat.ts        — main hook, returns actions + state
        │   ├── useWebSocket.ts   — WS connection + ServerMessage → dispatch
        │   └── useSession.ts     — session persistence (localStorage)
        ├── context/
        │   └── chatContext.tsx    — ChatState reducer (React Context)
        ├── types/
        │   └── index.ts          — re-export shared + ChatState, ChatAction
        ├── lib/
        │   ├── messageFactory.ts — ClientMessage constructors
        │   └── wsClient.ts       — WsClient class (reconnect logic)
        ├── components/
        │   ├── chat/
        │   │   ├── chatInner.tsx     — main chat view (header + messages + bottom)
        │   │   ├── bottomActions.tsx — choices, advance button, free input, action dialog
        │   │   ├── messageList.tsx   — scrollable message list
        │   │   ├── choicePanel.tsx   — choice buttons
        │   │   ├── freeInput.tsx     — text input + sticker button
        │   │   ├── actionMessage.tsx — system action display
        │   │   └── chatHeader.tsx    — character switcher, admin controls
        │   ├── shared/
        │   │   └── modeToggle.tsx    — (unused, kept for reference)
        │   └── stickers/
        │       └── stickerPicker.tsx
        └── styles/
            └── chat.css          — all styles
```

## Roles & Modes

| Concept | Values | Description |
|---------|--------|-------------|
| **Role** | `guest`, `actor` | Guest = player, Actor = game master |
| **ActorMode** | `scenario`, `free`, `root` | Actor's current mode. `root` = admin view |
| **GuestMode** | `scenario`, `free` | Global mode (server-side), affects all clients |
| **CharacterId** | `clerk`, `sunday`, `firefly`, `himeko`, `river`, `sparkle`, `robin` | + `root` (virtual, admin-only) |

## Scenario Engine Flow

The scenario is a linear array of `ScenarioStep[]` in `penaconia.json`.

### Step Types

| Type | Behavior |
|------|----------|
| `message` | Auto-executed. Shows typing indicator → broadcasts message. Auto-advances to next. |
| `action` | **Pauses.** Server stores `pendingAdvance` with target `characterId` (next message step's author) and `actionText`. Actor confirms via dialog → executes action → auto-continues. |
| `choice` | **Pauses.** Server stores `pendingChoice`. Sent to target role/character. On selection, executes option's actions → continues. |
| `transformCharacter` | Auto-executed. Transforms character (id, name, avatar). |
| `switchGuestMode` | Auto-executed. Switches global `guestMode` (enables/disables free chat). |
| `branch` | Auto-executed. Routes to a branch based on `lastChoiceOptionId`. |

### Pause Points

The engine stops and waits for client input at:
1. **`choice` steps** → client sends `choiceSelect`
2. **`action` steps** → client sends `advanceScenario` (after dialog confirmation)

All other steps auto-chain: after processing, `stepIndex++` and `processNextStep()` recurse.

## WebSocket Protocol

### Server → Client

| Message | Purpose |
|---------|---------|
| `init` | Full state sync (messages, characters, choices, pendingAdvance, guestMode) |
| `newMessage` | New chat message |
| `typing` | Character typing indicator on/off |
| `choices` | Show choice buttons to targeted client |
| `choicesDismissed` | Hide choices (after selection) |
| `pendingAdvance` | Show "continue scenario" button to targeted actor |
| `pendingAdvanceDismissed` | Hide advance button (after confirmation) |
| `characterTransform` | Character id/name/avatar changed |
| `guestModeSwitch` | Global mode changed (scenario ↔ free) |
| `sessionUpdate` | Connected sessions list changed |
| `reset` | Full state reset with fresh init |
| `error` | Error with code + message |

### Client → Server

| Message | Purpose |
|---------|---------|
| `choiceSelect` | Player/actor selected a choice option |
| `freeMessage` | Free-mode text/img/sticker message |
| `advanceScenario` | Actor confirms action step (or general advance) |
| `adminStartScenario` | Start scenario from step 0 |
| `adminReset` | Reset all state |
| `switchCharacter` | Actor switches character |
| `switchActorMode` | Actor switches mode |
| `requestSync` | Request fresh init message |

## Client State (ChatState)

```typescript
interface ChatState {
  role: Role;
  sessionId: string | null;
  isConnected: boolean;
  currentCharacterId: string;
  characters: Map<string, CharacterDef>;
  messages: ChatMessage[];
  typingCharacters: Set<string>;
  activeChoices: ActiveChoice | null;
  pendingAdvance: PendingAdvance | null;
  guestMode: GuestMode;
  actorMode: ActorMode;
  sessions: SessionInfo[];
}
```

Managed by `chatReducer` in `chatContext.tsx`. WebSocket messages dispatch actions to this reducer.

## QR Auth & Security

Access to the app is restricted via URL-based tokens. Nobody can join without a valid QR code / link.

All three secrets are **hardcoded constants** in `shared/src/constants.ts`:

```typescript
export const guestToken = 'hsr-guest-2026';
export const actorKey = 'hsr-actor-penaconia';
export const testGuestKey = 'hsr-test-guest';
```

### Auth Types

| Type | Route | URL Param | Param Behavior | Survives Reset |
|------|-------|-----------|----------------|----------------|
| **Guest** | `/guest?token=<guestToken>` | `token` | Read → passed to WS → **removed** from URL and history (`history.replaceState`) | ❌ No — must re-scan QR |
| **Actor** | `/actor?key=<actorKey>` | `key` | Read → passed to WS → **kept** in URL | ✅ Yes |
| **Test Guest** | `/guest?key=<testGuestKey>` | `key` | Read → passed to WS → **kept** in URL | ✅ Yes |

### Hardcoded QR Links

```
Guest:      https://{host}/guest?token={guestToken}
Test Guest: https://{host}/guest?key={testGuestKey}
Actor:      https://{host}/actor?key={actorKey}
```

All three URLs are static — the QR codes never change.

### Why Guests Can't Reconnect After Reset

The `guestToken` value never changes, but the **guest's ability to reconnect** is still blocked by two mechanisms working together:

1. **`token` is stripped from URL** — after the client reads it, `history.replaceState` removes it. The user's address bar shows bare `/guest`. Refreshing the page = no `token` param = access denied.
2. **Session is deleted on reset** — the server deletes all `authType: 'guest'` sessions on `adminReset` / `switchVariant`. Even if the client had a stored `sessionId` in localStorage, that ID no longer exists on the server.

So to get back in, the guest must **re-scan the QR** (which puts `?token=...` back in the URL).

### Client-Side Auth Flow

```
1. Page loads at /guest?token=abc123  (or /actor?key=xyz, /guest?key=test456)
2. useAuth() hook:
   a. Reads `token` or `key` from URLSearchParams
   b. If `token` → stores in memory, calls history.replaceState to strip it from URL
   c. If `key` → stores in memory, URL stays as-is
   d. If neither param present AND no valid sessionId in localStorage
      → show "Access denied" screen, do NOT connect WS
3. useWebSocket() appends the auth param to WS URL:
   ws://host/ws?role=guest&characterId=clerk&sessionId=...&token=abc123
   ws://host/ws?role=actor&characterId=root&sessionId=...&key=xyz
   ws://host/ws?role=guest&characterId=clerk&sessionId=...&key=test456
4. On successful init from server → user is in the chat
5. On auth error from server → show "Access denied", disconnect
```

### Server-Side Auth Flow

```
1. wss.on('connection') in index.ts:
   - Extracts `token` and `key` from URL search params
   - Passes them to handleConnection(ws, { role, characterId, sessionId, token, key })

2. handleConnection() in wsHandler.ts:
   a. Reconnect path (valid sessionId exists in state.sessions):
      - Skip auth — session already validated. Re-associate WS.
   b. New session path:
      - role=actor  → require key === actorKey
      - role=guest + key present → require key === testGuestKey → mark session as testGuest
      - role=guest + token present → require token === guestToken
      - No valid auth → send error { code: 'AUTH_FAILED' }, close WS
   c. Store authType on SessionData: 'guest' | 'testGuest' | 'actor'
```

### Reset / Variant-Switch Behavior

On `adminReset` or `switchVariant`:

1. Send `reset` / `variantChanged` to all connections
2. Close and delete **all `role: 'guest'`** sessions (both regular and test guests)
3. `actor` sessions remain on server
4. Client-side for **regular guests**: `localStorage` cleared + `window.location.reload()` → no `token` in URL → "Access denied" screen → must re-scan QR
5. Client-side for **test guests**: page reloads → `key` is still in URL → auto-creates a new session → back in

### Concurrency

- **N guests** can scan the same QR and all join the same scenario — the `guestToken` is not single-use, it's valid for any number of connections.
- Each scan creates an independent `SessionData` with a unique `sessionId`.
- All guests share the same `characterId: 'clerk'` and see the same scenario state.

### Summary: Who Stays After Reset

| Type | Session Deleted | Can Reconnect | How |
|------|----------------|---------------|-----|
| Regular Guest | ✅ Yes | ❌ No | Must re-scan QR (`token` was stripped from URL) |
| Test Guest | ✅ Yes | ✅ Yes | `key` stays in URL → new session auto-created on reconnect |
| Actor | ❌ No | ✅ Yes | `key` stays in URL, session preserved |

## Key Design Decisions

- **Singleton engine** — `ScenarioEngine` is a singleton (`scenarioEngine` export). All state mutations go through `state.ts` singleton.
- **Broadcast targeting** — `broadcastToCharacterId()` sends to sessions with matching `characterId` **plus** root actors.
- **Action steps pause** — Unlike messages that auto-chain, action steps require explicit actor confirmation via a dialog showing the action text.
- **`pendingAdvance` vs `pendingChoice`** — Both are pause mechanisms. `pendingChoice` shows choice buttons; `pendingAdvance` shows a "continue" button with confirmation dialog.
- **advanceScenario** — Any actor can send it (not restricted to root). Routes to `handleAdvance()` if `pendingAdvance` exists, otherwise `processNextStep()`.
