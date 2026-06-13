interface Props {
  code: string;
  viewers: number;
}

export function RoomInfo({ code, viewers }: Props) {
  return (
    <div className="card">
      <div className="label">Código da sala</div>
      <div className="row">
        <code className="room-code">{code}</code>
        <button onClick={() => navigator.clipboard.writeText(code)}>Copiar</button>
      </div>
      <div className="meta">
        Viewers conectados: <strong>{viewers}</strong>
      </div>
    </div>
  );
}
