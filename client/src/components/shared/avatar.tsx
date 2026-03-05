interface Props {
  src: string;
  alt: string;
  size?: number;
}

export function Avatar({ src, alt, size }: Props) {
  const style = size ? { width: size, height: size } : undefined;
  return <img className="avatar" src={src} alt={alt} style={style} />;
}
