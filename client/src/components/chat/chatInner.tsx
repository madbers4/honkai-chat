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

  return (
    <div className="chat-page">
      <ChatHeader
        role={role}
        characters={chat.state.characters}
        currentCharacterId={chat.state.currentCharacterId}
        onSwitchCharacter={chat.switchCharacter}
        onReset={chat.resetChat}
        isConnected={chat.state.isConnected}
      />
      <MessageList
        messages={chat.displayMessages}
        typingCharacters={chat.state.typingCharacters}
        characters={chat.state.characters}
      />
      <BottomActions
        role={role}
        activeChoices={chat.state.activeChoices}
        guestMode={chat.state.guestMode}
        actorMode={chat.state.actorMode}
        currentCharacterId={chat.state.currentCharacterId}
        characters={chat.state.characters}
        onSelectChoice={chat.selectChoice}
        onSendFreeMessage={chat.sendFreeMessage}
        onSwitchActorMode={chat.switchActorMode}
        onAdvanceScenario={chat.advanceScenario}
      />
    </div>
  );
}
