export const metadata = {
  title: "Política de Privacidade — Watch Party Kick",
};

export default function PrivacyPage() {
  return (
    <main style={{ maxWidth: 800, margin: "40px auto", padding: 24, fontFamily: "system-ui, sans-serif", lineHeight: 1.6 }}>
      <h1 style={{ fontSize: 28, marginBottom: 8 }}>Política de Privacidade</h1>
      <p style={{ opacity: 0.7, marginBottom: 32 }}>Watch Party Kick — Última atualização: junho de 2026</p>

      <h2 style={{ fontSize: 20, marginTop: 24, marginBottom: 8 }}>1. Resumo</h2>
      <p>
        A extensão Watch Party Kick e o painel associado permitem que streamers da Kick compartilhem a tela com viewers via overlay sobre o player oficial. Esta política descreve quais dados coletamos, como são usados e armazenados.
      </p>

      <h2 style={{ fontSize: 20, marginTop: 24, marginBottom: 8 }}>2. Dados coletados</h2>
      <p>
        <strong>Não coletamos dados pessoais.</strong> A extensão armazena localmente apenas o último código de sala digitado pelo usuário, usando a API <code>chrome.storage.local</code>. Esse dado não é enviado a nenhum servidor externo e fica restrito ao próprio navegador.
      </p>
      <p>
        Quando o usuário entra em uma sala, o servidor recebe apenas: (a) o código da sala; (b) um identificador anônimo gerado aleatoriamente para a sessão; (c) seu endereço IP, padrão de qualquer conexão HTTP. Nenhuma dessas informações é associada a sua identidade.
      </p>

      <h2 style={{ fontSize: 20, marginTop: 24, marginBottom: 8 }}>3. Vídeo e áudio</h2>
      <p>
        A captura de tela, webcam e microfone do streamer é transmitida via WebRTC pela infraestrutura LiveKit (auto-hospedada em São Paulo). Esses fluxos passam pelo servidor de forma efêmera apenas para roteamento e não são gravados, armazenados nem analisados.
      </p>

      <h2 style={{ fontSize: 20, marginTop: 24, marginBottom: 8 }}>4. Cookies e rastreamento</h2>
      <p>
        Não usamos cookies, pixels de rastreamento, analytics nem ferramentas de publicidade. A extensão não monitora histórico de navegação nem atividade do usuário fora do player da Kick.
      </p>

      <h2 style={{ fontSize: 20, marginTop: 24, marginBottom: 8 }}>5. Compartilhamento com terceiros</h2>
      <p>
        Não vendemos, alugamos nem transferimos dados a terceiros. Nenhum dado é compartilhado com serviços de analytics ou redes de publicidade.
      </p>

      <h2 style={{ fontSize: 20, marginTop: 24, marginBottom: 8 }}>6. Permissões da extensão</h2>
      <ul style={{ paddingLeft: 24 }}>
        <li><strong>storage</strong>: armazenar localmente o último código de sala usado.</li>
        <li><strong>activeTab</strong>: identificar a aba ativa da Kick para injetar o overlay.</li>
        <li><strong>scripting</strong>: injetar o overlay sobre o player.</li>
        <li><strong>host (kick.com)</strong>: necessário para operar exclusivamente no site da Kick.</li>
        <li><strong>host (watchpartykick.duckdns.org)</strong>: comunicação com o servidor de salas e stream.</li>
      </ul>

      <h2 style={{ fontSize: 20, marginTop: 24, marginBottom: 8 }}>7. Retenção</h2>
      <p>
        As salas vivem apenas em memória do servidor e são limpas automaticamente após o término. Códigos de sala armazenados localmente podem ser apagados a qualquer momento limpando os dados da extensão em <code>chrome://extensions</code>.
      </p>

      <h2 style={{ fontSize: 20, marginTop: 24, marginBottom: 8 }}>8. Contato</h2>
      <p>
        Dúvidas sobre esta política podem ser enviadas para o repositório do projeto em{" "}
        <a href="https://github.com/gabrielroec/watch-party-kick" style={{ color: "#2dd879" }}>github.com/gabrielroec/watch-party-kick</a>.
      </p>

      <h2 style={{ fontSize: 20, marginTop: 24, marginBottom: 8 }}>9. Alterações</h2>
      <p>
        Esta política pode ser atualizada. A data no topo desta página indica a última revisão. Mudanças significativas serão comunicadas via descrição da extensão na Chrome Web Store.
      </p>
    </main>
  );
}
