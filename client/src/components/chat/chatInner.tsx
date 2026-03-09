import { useChat } from "../../hooks/useChat";
import { ChatHeader } from "./chatHeader";
import { MessageList } from "./messageList";
import { BottomActions } from "./bottomActions";
import type { Role } from "../../types";

interface Props {
  role: Role;
}

export function ChatInner({ role }: Props) {
  const chat = useChat(role);

  // Auth gate — no valid token/key in URL
  if (!chat.authenticated) {
    return (
      <div className="welcome-screen">
        <div className="welcome-screen__card">
          <div className="welcome-screen__title">Доступ запрещён</div>
          <div className="welcome-screen__subtitle">
            Отсканируйте QR-код для входа.
          </div>
        </div>
      </div>
    );
  }

  // Guest sees welcome screen while scenario hasn't started (no messages, no typing)
  const showWelcome =
    role === "guest" &&
    chat.state.messages.length === 0 &&
    chat.state.typingCharacters.size === 0;

  if (showWelcome) {
    return (
      <div className="welcome-screen">
        <div className="welcome-screen__card">
          <div className="welcome-screen__title">Где исполняются мечты</div>
          <div className="welcome-screen__subtitle">
            Групповой чат съемочной группы.
          </div>
          <button
            className="welcome-screen__enter"
            disabled={!chat.state.isConnected}
            onClick={() => chat.startScenario()}
          >
            {chat.state.isConnected ? "Войти в чат" : "Подключение..."}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-page">
      <ChatHeader
        role={role}
        characters={chat.state.characters}
        currentCharacterId={chat.state.currentCharacterId}
        onSwitchCharacter={chat.switchCharacter}
        onReset={chat.resetChat}
        onStartScenario={chat.startScenario}
        canStartScenario={chat.state.messages.length === 0}
        isConnected={chat.state.isConnected}
        scenarioVariant={chat.state.scenarioVariant}
        onSwitchVariant={chat.switchVariant}
        noScenario={chat.state.noScenario}
        onToggleNoScenario={chat.toggleNoScenario}
      />
      <MessageList
        messages={chat.displayMessages}
        typingCharacters={chat.state.typingCharacters}
        characters={chat.state.characters}
        currentCharacterId={chat.state.currentCharacterId}
      />
      <BottomActions
        role={role}
        activeChoices={chat.state.activeChoices}
        pendingAdvance={chat.state.pendingAdvance}
        guestMode={chat.state.guestMode}
        currentCharacterId={chat.state.currentCharacterId}
        characters={chat.state.characters}
        onSelectChoice={chat.selectChoice}
        onSendFreeMessage={chat.sendFreeMessage}
        onAdvanceScenario={chat.advanceScenario}
        noScenario={chat.state.noScenario}
      />
    </div>
  );
}
