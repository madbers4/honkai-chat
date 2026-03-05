import { useState, useRef } from "react";
import { StickerPicker } from "../stickers/stickerPicker";

interface Props {
  onSend: (type: "text" | "img" | "sticker", value: string) => void;
  stickers: string[];
}

export function FreeInput({ onSend, stickers }: Props) {
  const [text, setText] = useState("");
  const [showStickers, setShowStickers] = useState(false);
  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  const handleSendText = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend("text", trimmed);
    setText("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendText();
    }
  };

  const handleImageUpload = (
    e: React.ChangeEvent<HTMLInputElement>,
    ref: React.RefObject<HTMLInputElement | null>,
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result as string;
      onSend("img", base64);
    };
    reader.readAsDataURL(file);
    if (ref.current) ref.current.value = "";
  };

  const handleStickerSelect = (stickerUrl: string) => {
    onSend("sticker", stickerUrl);
    setShowStickers(false);
  };

  return (
    <div className="free-input-wrapper">
      {showStickers && (
        <StickerPicker
          stickers={stickers}
          onSelect={handleStickerSelect}
          onClose={() => setShowStickers(false)}
        />
      )}
      <div className="free-input">
        <input
          className="free-input__field"
          type="text"
          placeholder="Написать сообщение..."
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        {stickers.length > 0 && (
          <button
            className="free-input__btn"
            onClick={() => setShowStickers(!showStickers)}
            title="Стикеры"
          >
            😊
          </button>
        )}
        <button
          className="free-input__btn"
          onClick={() => cameraRef.current?.click()}
          title="Сделать фото"
        >
          📷
        </button>
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          style={{ display: "none" }}
          onChange={(e) => handleImageUpload(e, cameraRef)}
        />
        <button
          className="free-input__btn"
          onClick={() => galleryRef.current?.click()}
          title="Выбрать фото"
        >
          🖼️
        </button>
        <input
          ref={galleryRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={(e) => handleImageUpload(e, galleryRef)}
        />
        <button
          className="free-input__btn free-input__btn--send"
          onClick={handleSendText}
          disabled={!text.trim()}
          title="Отправить"
        >
          ➤
        </button>
      </div>
    </div>
  );
}
