import { useEffect } from "react";

interface Props {
  src: string;
  onClose: () => void;
}

export function ImageLightbox({ src, onClose }: Props) {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div className="lightbox" onClick={onClose}>
      <div className="lightbox__backdrop" />
      <img
        className="lightbox__image"
        src={src}
        alt="Full size"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}
