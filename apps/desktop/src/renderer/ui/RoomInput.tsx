import { useState } from "react";

interface Props {
  busy: boolean;
  onCreate: (code: string) => void;
}

export function RoomInput({ busy, onCreate }: Props) {
  const [code, setCode] = useState("");
  const valid = code.trim().length >= 3;

  return (
    <div className="start">
      <h2>Watch Party</h2>
      <p>Escolha um código pra sua sala e passe pros viewers. Eles vão usar a extensão Chrome pra entrar.</p>
      <div className="form">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
          placeholder="WATCHPARTY"
          maxLength={12}
        />
        <button className="primary" disabled={busy || !valid} onClick={() => onCreate(code.trim())}>
          {busy ? "Criando..." : "Criar sala"}
        </button>
      </div>
    </div>
  );
}
