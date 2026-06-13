import { useEffect, useRef } from "react";

interface Props {
  stream: MediaStream | null;
  empty: string;
}

export function Preview({ stream, empty }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = stream;
    if (stream) video.play().catch(() => {});
  }, [stream]);

  return (
    <div className="preview">
      <video ref={videoRef} muted playsInline style={{ display: stream ? "block" : "none" }} />
      {!stream && <div className="empty">{empty}</div>}
    </div>
  );
}
