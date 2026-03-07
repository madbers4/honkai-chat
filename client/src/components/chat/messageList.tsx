import { useCallback, useEffect, useRef, useState } from "react";
import { MessageBubble } from "./messageBubble";
import { ActionMessage } from "./actionMessage";
import { TypingIndicator } from "./typingIndicator";
import { ImageLightbox } from "./imageLightbox";
import type { DisplayMessage, CharacterDef } from "../../types";

interface Props {
  messages: DisplayMessage[];
  typingCharacters: Set<string>;
  characters: Map<string, CharacterDef>;
  currentCharacterId: string;
}

export function MessageList({
  messages,
  typingCharacters,
  characters,
  currentCharacterId,
}: Props) {
  const listRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, typingCharacters.size]);

  const handleImageClick = useCallback((src: string) => {
    setLightboxSrc(src);
  }, []);

  return (
    <div className="message-list" ref={listRef}>
      {messages.map((msg) => {
        if (msg.type === "action") {
          return <ActionMessage key={msg.id} text={msg.value} />;
        }
        return (
          <MessageBubble
            key={msg.id}
            message={msg}
            onImageClick={handleImageClick}
          />
        );
      })}
      {Array.from(typingCharacters).map((charId) => {
        const char = characters.get(charId);
        if (!char) return null;
        const source = charId === currentCharacterId ? "outgoing" : "incoming";
        return (
          <div
            key={`typing-${charId}`}
            className={`message-row message-row--${source} message-enter`}
          >
            <img className="avatar" src={char.avatarUrl} alt={char.name} />
            <div className="message-content">
              <div className="username">{char.name}</div>
              <TypingIndicator source={source} />
            </div>
          </div>
        );
      })}
      <div ref={bottomRef} />
      {lightboxSrc && (
        <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
      )}
    </div>
  );
}
