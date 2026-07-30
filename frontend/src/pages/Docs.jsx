import { useState } from 'react';
import { MessageSquare, Activity, Cpu, Workflow } from 'lucide-react';

export default function Docs() {
  const [activeTab, setActiveTab] = useState('evolution');

  return (
    <div>
      <div className="page-header">
        <h2>Documentação</h2>
        <p>Guias de configuração e integração das APIs</p>
      </div>

      <div className="docs-tabs">
        <button 
          className={`tab-btn ${activeTab === 'evolution' ? 'active' : ''}`}
          onClick={() => setActiveTab('evolution')}
        >
          <MessageSquare size={16} />
          Evolution API (WhatsApp)
        </button>
        <button 
          className={`tab-btn ${activeTab === 'claude' ? 'active' : ''}`}
          onClick={() => setActiveTab('claude')}
        >
          <Activity size={16} />
          Claude API (Anthropic)
        </button>
        <button 
          className={`tab-btn ${activeTab === 'architecture' ? 'active' : ''}`}
          onClick={() => setActiveTab('architecture')}
        >
          <Cpu size={16} />
          Arquitetura dos Agentes
        </button>
        <button className={`tab-btn ${activeTab === 'runbooks' ? 'active' : ''}`} onClick={() => setActiveTab('runbooks')}>
          <Workflow size={16} />
          Runbooks
        </button>
      </div>

      <div className="card" style={{ marginTop: '20px', padding: '24px' }}>
        {activeTab === 'evolution' && (
          <div className="doc-content">
            <h3>📱 Configurando a Evolution API</h3>
            <p>A Evolution API é utilizada para enviar e receber mensagens do WhatsApp. O NOC Agent usa essa API para notificar os administradores e para permitir que você interaja com a IA diretamente pelo celular.</p>
            
            <h4>1. Pré-requisitos</h4>
            <ul>
              <li>Uma instância da <a href="https://github.com/EvolutionAPI/evolution-api" target="_blank" rel="noreferrer" style={{color: 'var(--primary)'}}>Evolution API v2</a> instalada e rodando (via Docker ou Node).</li>
              <li>Um número de WhatsApp conectado na instância.</li>
            </ul>

            <h4>2. Configurando no NOC Agent</h4>
            <ul>
              <li><strong>URL Base:</strong> O endereço onde sua Evolution API está rodando. Exemplo: <code>http://192.168.1.10:8080</code> ou <code>https://evolution.seusite.com</code></li>
              <li><strong>API Key:</strong> A Global API Key configurada na sua Evolution API.</li>
              <li><strong>Nome da Instância:</strong> O exato nome da instância que você criou no Evolution (ex: <code>noc-agent</code>).</li>
              <li><strong>WhatsApp Admin:</strong> Seu número pessoal com o código do país (DDI + DDD + Número). Ex: <code>5511999999999</code>. É para este número que os relatórios de erros do Zabbix serão enviados.</li>
              <li><strong>Números Autorizados:</strong> Uma lista separada por vírgulas de todos os telefones que podem "conversar" com a IA enviando mensagens. Qualquer número fora dessa lista será ignorado.</li>
            </ul>

            <h4>3. Configurando o Webhook no Evolution</h4>
            <p>Para que o NOC Agent receba suas respostas, você deve configurar o Webhook na Evolution API apontando para o seu servidor NOC.</p>
            <pre className="docs-code-block">
              <code>URL do Webhook: http://IP_DO_NOC:3000/api/webhooks/evolution</code>
              <br/>
              <code>Eventos marcados: messages.upsert</code>
            </pre>
          </div>
        )}

        {activeTab === 'claude' && (
          <div className="doc-content">
            <h3>🧠 Configurando a Claude API (Anthropic)</h3>
            <p>O cérebro do NOC Agent 35 é movido pelos modelos da família Claude 3 e Claude 3.5 da Anthropic. É aqui que os agentes especialistas em Linux e MikroTik "pensam".</p>

            <h4>1. Gerando a API Key</h4>
            <ul>
              <li>Crie uma conta em <a href="https://console.anthropic.com/" target="_blank" rel="noreferrer" style={{color: 'var(--primary)'}}>console.anthropic.com</a>.</li>
              <li>Vá em <strong>Settings &gt; API Keys</strong> e clique em "Create Key".</li>
              <li>Copie a chave gerada (sempre começa com <code>sk-ant-...</code>). Lembre-se que ela só aparece uma vez!</li>
            </ul>

            <h4>2. Entendendo os Modelos</h4>
            <p>A Anthropic atualiza os modelos frequentemente. No painel de configurações do NOC Agent, você deve usar o <strong>ID exato da API</strong>. Alguns dos modelos mais recomendados:</p>
            <ul className="docs-highlight-list">
              <li><strong>Claude 3.5 Sonnet:</strong> <code>claude-3-5-sonnet-20241022</code> (Rápido, inteligente, excelente para código e diagnóstico avançado. É o mais recomendado).</li>
              <li><strong>Claude 3 Haiku:</strong> <code>claude-3-haiku-20240307</code> (Mais barato e ultrarrápido, ótimo se você tiver centenas de alertas pequenos).</li>
              <li><strong>Claude 3 Opus:</strong> <code>claude-3-opus-20240229</code> (Maior raciocínio, porém mais lento e caro).</li>
            </ul>

            <h4>3. Custos e Segurança</h4>
            <p>Todas as conversas via Dashboard ou via WhatsApp consumirão tokens da sua conta Anthropic. A chave é salva localmente com criptografia AES-256 no banco de dados SQLite do NOC Agent, garantindo que mesmo se o banco vazar, sua chave estará protegida pela chave mestra (ENCRYPTION_KEY).</p>
          </div>
        )}

        {activeTab === 'architecture' && (
          <div className="doc-content">
            <h3>🤖 Arquitetura Multi-Agentes do NOC</h3>
            <p>O NOC Agent 35 não é apenas um "chatbot" simples. Ele é uma rede de <strong>Agentes Autônomos</strong> que se comunicam entre si e tomam decisões no servidor.</p>

            <h4>1. Native Tool Use vs MCP (Model Context Protocol)</h4>
            <p>
              Ao invés de usar um servidor externo via padrão MCP, o NOC Agent 35 utiliza o <strong>Native Tool Use (Function Calling)</strong> nativo do Claude dentro do Node.js. 
              Isso significa que as "ferramentas" dos agentes (como acessar via SSH, rodar ping, etc) são funções JavaScript embutidas no próprio backend (veja <code>src/tools/</code>).
              Isso garante muito mais velocidade e segurança, pois o agente tem acesso sincronizado ao banco de dados interno para descriptografar senhas na hora de conectar nos equipamentos.
            </p>

            <h4>2. A Rede de Agentes</h4>
            <ul className="docs-agent-list">
              <li>
                <strong>Support Agent (Orquestrador):</strong> Quando você manda mensagem no Dashboard, WhatsApp ou chega um alerta do Zabbix, ele é o primeiro a ler. 
                A função dele não é consertar a rede, e sim <strong>descobrir de qual equipamento estamos falando</strong> (usando a Tool <code>search_device</code>) e encaminhar a tarefa para o especialista correto na mesma hora.
              </li>
              <li>
                <strong>Mikrotik Agent (Especialista):</strong> Possui a Tool <code>ssh_mikrotik_exec</code>. Ele é liberado das burocracias ("sem formatos engessados") e conversa naturalmente. 
                Pode rodar comandos de diagnóstico diretamente ou realizar configurações pesadas sob aprovação.
              </li>
              <li>
                <strong>Linux Agent (Especialista):</strong> Possui a Tool <code>ssh_linux_exec</code>. Da mesma forma, analisa consumo (CPU, Disco) e gerencia serviços de servidores Linux livremente.
              </li>
              <li>
                <strong>Huawei VRP Agent (Especialista):</strong> Voltado a NetEngine e outros equipamentos VRP. Usa SSH interativo, consultas <code>display</code> e política própria de aprovação, rollback e bloqueio destrutivo.
              </li>
            </ul>

            <h4>3. Workflows (Configurações em Lote)</h4>
            <p>
              Como os agentes são totalmente autônomos, você não precisa ficar rodando scripts rígidos. Você pode instruir <strong>Workflows naturais</strong> no chat. 
              Por exemplo: <em>"Acesse o roteador X, confira se a ether3 está livre. Se estiver, crie uma VLAN 10 nela, configure o IP 10.0.0.1/24 e suba um PPPoE Server."</em>
            </p>
            <p>
              O modelo vai pensar sozinho: usar o SSH para dar um print na interface, processar o texto, escrever todos os comandos do PPPoE e pedir sua aprovação (SIM/NÃO) para executar o bloco inteiro.
            </p>
          </div>
        )}
        {activeTab === 'runbooks' && (
          <div className="doc-content">
            <h3>⚙️ Catálogo de Runbooks</h3>
            <p>Runbooks são automações operacionais reutilizáveis, versionadas e auditadas. Eles podem combinar comandos, validações e rollback para um tipo específico de equipamento.</p>
            <h4>Fluxo seguro</h4>
            <ol>
              <li>O administrador cria o runbook como rascunho, define variáveis e etapas.</li>
              <li>O administrador publica uma versão revisada.</li>
              <li>Versões com alterações exigem aprovação de um segundo administrador; o solicitante não pode aprovar a própria versão.</li>
              <li>Administrador ou operador seleciona o equipamento e executa a simulação.</li>
              <li>A prévia mostra todos os comandos renderizados e identifica consulta ou alteração.</li>
              <li>Somente o administrador pode confirmar a execução real. A simulação idêntica vale por 30 minutos.</li>
              <li>Cada resultado fica registrado no histórico; quando definido, o rollback pode ser executado pelo administrador.</li>
            </ol>
            <h4>Variáveis</h4>
            <p>Use chaves como <code>interface</code>, <code>vlan_id</code> ou <code>ip_rede</code> e referencie-as no comando com <code>{'{{interface}}'}</code>. Uma expressão regular opcional pode limitar o formato aceito. Não use senhas ou tokens como variáveis.</p>
            <h4>Permissões</h4>
            <ul><li><strong>Operador:</strong> consulta catálogo e executa simulações.</li><li><strong>Administrador:</strong> cria, edita, publica, arquiva, executa e aciona rollback.</li></ul>
          </div>
        )}
      </div>
    </div>
  );
}
