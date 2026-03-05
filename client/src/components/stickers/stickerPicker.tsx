interface Props {
  stickers: string[];
  onSelect: (url: string) => void;
  onClose: () => void;
}

export function StickerPicker({ stickers, onSelect, onClose }: Props) {
  if (stickers.length === 0) return null;

  return (
    <>
      <div className="sticker-picker-overlay" onClick={onClose} />
      <div className="sticker-picker fade-enter">
        <div className="sticker-picker__grid">
          {stickers.map((url, i) => (
            <button
              key={i}
              className="sticker-picker__item"
              onClick={() => onSelect(url)}
            >
              <img src={url} alt={`Sticker ${i + 1}`} />
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
