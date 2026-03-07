interface Props {
  source: string;
}

export function TypingIndicator({ source }: Props) {
  return (
    <div className={`typing-indicator bubble bubble--${source}`}>
      <div className="typing-dot" />
      <div className="typing-dot" />
      <div className="typing-dot" />
    </div>
  );
}
