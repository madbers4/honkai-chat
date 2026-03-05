import type { DisplayMessage } from "../../types";

interface Props {
  message: DisplayMessage;
  onImageClick?: (src: string) => void;
}

export function MessageBubble({ message, onImageClick }: Props) {
  const { source, characterName, avatarUrl, type, value } = message;

  const rowClass = `message-row message-row--${source} message-enter`;

  const renderContent = () => {
    switch (type) {
      case "text":
        return (
          <div className={`bubble bubble--${source} bubble--text`}>{value}</div>
        );
      case "img":
        return (
          <div
            className={`bubble bubble--${source} bubble--img`}
            onClick={() => onImageClick?.(value)}
            style={{ cursor: "pointer" }}
          >
            <img src={value} alt="Image" />
          </div>
        );
      case "sticker":
        return (
          <div className="bubble bubble--sticker">
            <img src={value} alt="Sticker" />
          </div>
        );
      default:
        return (
          <div className={`bubble bubble--${source} bubble--text`}>{value}</div>
        );
    }
  };

  return (
    <div className={rowClass}>
      <img className="avatar" src={avatarUrl} alt={characterName} />
      <div className="message-content">
        <div className="username">{characterName}</div>
        {renderContent()}
      </div>
    </div>
  );
}
