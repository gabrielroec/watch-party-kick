// UI minima do popup da extensao.
// Input pra codigo + botao entrar. Sem framework (evita bundle gordo).

const root = document.getElementById("root")!;
root.innerHTML = `
  <h1>Watch Party Kick</h1>
  <label for="code">Codigo da sala</label>
  <input id="code" maxlength="8" placeholder="ABC123" autocomplete="off" />
  <button id="join">Entrar na sala</button>
  <button id="leave" class="ghost">Sair da watch party</button>
  <div id="status" class="status"></div>
`;

const input = document.getElementById("code") as HTMLInputElement;
const joinBtn = document.getElementById("join") as HTMLButtonElement;
const leaveBtn = document.getElementById("leave") as HTMLButtonElement;
const statusEl = document.getElementById("status") as HTMLDivElement;

// Preenche ultimo codigo usado.
chrome.runtime.sendMessage({ kind: "get-last-room" }, (r) => {
  if (r?.ok && typeof r.data === "string") input.value = r.data;
});

input.addEventListener("input", () => {
  input.value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
});

joinBtn.addEventListener("click", () => {
  const code = input.value.trim();
  if (code.length < 4) {
    statusEl.className = "status error";
    statusEl.textContent = "codigo muito curto";
    return;
  }
  joinBtn.disabled = true;
  statusEl.className = "status";
  statusEl.textContent = "conectando...";
  chrome.runtime.sendMessage({ kind: "join-room", code }, (r) => {
    joinBtn.disabled = false;
    if (r?.ok) {
      statusEl.className = "status ok";
      statusEl.textContent = "conectado! Abra a aba onde quer assistir.";
      setTimeout(() => window.close(), 700);
    } else {
      statusEl.className = "status error";
      statusEl.textContent = r?.error ?? "falhou";
    }
  });
});

leaveBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ kind: "leave-room" }, () => {
    statusEl.className = "status ok";
    statusEl.textContent = "saiu da watch party";
  });
});
