import { useState } from 'react';
import { MessageSquare, Activity, CalendarClock, Cpu, Workflow } from 'lucide-react';

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
        <button className={`tab-btn ${activeTab === 'lifecycle' ? 'active' : ''}`} onClick={() => setActiveTab('lifecycle')}><CalendarClock size={16}/>Ciclo de Vida</button>
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
              <li>Em Tasks de incidente, o sistema sugere modelos compatíveis; operadores simulam e administradores confirmam, sem execução automática.</li>
              <li>Administradores podem criar agendas diárias ou semanais; execução recorrente automática é limitada a Runbooks de baixo risco.</li>
              <li>A execução em lote aceita equipamentos ou grupos, usa três conexões simultâneas e interrompe novas ondas ao atingir 20% de falhas.</li>
            </ol>
            <h4>Variáveis</h4>
            <p>Variáveis permitem reutilizar o mesmo Runbook com interfaces, endereços, VLANs ou serviços diferentes. Cadastre a variável e use sua chave entre duas chaves no comando.</p>
            <div className="docs-variable-grid">
              <div><strong>Chave</strong><code>interface</code><span>Nome interno, em minúsculas, sem espaços. Aceita letras, números e <code>_</code>.</span></div>
              <div><strong>Rótulo</strong><code>Interface</code><span>Nome apresentado ao usuário durante a simulação.</span></div>
              <div><strong>Valor padrão</strong><code>ether1</code><span>Valor inicial sugerido. Pode ser alterado antes de simular.</span></div>
              <div><strong>Obrigatória</strong><code>Sim</code><span>Impede a simulação quando o valor estiver vazio.</span></div>
              <div><strong>Expressão regular</strong><code>^[A-Za-z0-9_.-]+$</code><span>Limita os caracteres aceitos antes de qualquer conexão.</span></div>
            </div>
            <h4>Como usar no comando</h4>
            <pre className="docs-code-block"><code>{'/interface print detail where name={{interface}}'}</code></pre>
            <p>Se o usuário informar <code>vlan400</code>, a simulação exibirá <code>/interface print detail where name=vlan400</code>. A substituição também funciona nos comandos de validação e rollback.</p>
            <h4>Exemplos por fabricante</h4>
            <div className="docs-command-examples">
              <section><strong>MikroTik</strong><code>interface = ether1</code><pre>{'/interface monitor-traffic {{interface}} once'}</pre></section>
              <section><strong>Huawei VRP</strong><code>interface = GigabitEthernet0/0/1</code><pre>{'display interface {{interface}}'}</pre></section>
              <section><strong>Cisco IOS</strong><code>interface = GigabitEthernet0/1</code><pre>{'show interfaces {{interface}}'}</pre></section>
              <section><strong>Linux</strong><code>service = nginx</code><pre>{'systemctl status {{service}}'}</pre></section>
            </div>
            <h4>Expressões regulares recomendadas</h4>
            <ul>
              <li><strong>Interface:</strong> <code>^[A-Za-z0-9/_.-]+$</code></li>
              <li><strong>VLAN ID:</strong> <code>^(?:[1-9]|[1-9][0-9]&#123;1,2&#125;|[1-3][0-9]&#123;3&#125;|40[0-8][0-9]|409[0-4])$</code></li>
              <li><strong>IPv4 simples:</strong> <code>^(?:\d&#123;1,3&#125;\.)&#123;3&#125;\d&#123;1,3&#125;$</code></li>
              <li><strong>Serviço systemd:</strong> <code>^[A-Za-z0-9@_.-]+$</code></li>
            </ul>
            <h4>Uso nos diferentes fluxos</h4>
            <ul>
              <li><strong>Execução individual:</strong> informe os valores antes de clicar em Simular.</li>
              <li><strong>Task de incidente:</strong> os campos aparecem junto ao Runbook sugerido.</li>
              <li><strong>Execução em lote:</strong> o mesmo conjunto de valores é aplicado a todos os equipamentos selecionados.</li>
              <li><strong>Agendamento:</strong> os valores ficam fixados e criptografados para as próximas execuções.</li>
            </ul>
            <div className="docs-warning"><strong>Segurança</strong><p>Não use variáveis para senhas, tokens, chaves privadas ou outros segredos. Os valores aparecem na prévia e no histórico para usuários autorizados. Sempre simule e confira o comando final antes de executar.</p></div>
            <h4>Permissões</h4>
            <ul><li><strong>Operador:</strong> consulta catálogo e executa simulações.</li><li><strong>Administrador:</strong> cria, edita, publica, arquiva, executa e aciona rollback.</li></ul>
            <h4>Recursos profissionais</h4>
            <ul><li><strong>Comparação:</strong> versões salvas podem ser conferidas lado a lado antes da aprovação.</li><li><strong>Notificações:</strong> aprovações, falhas, lotes e agendamentos usam Telegram e WhatsApp configurados.</li><li><strong>Indicadores:</strong> taxa de sucesso, tempo médio, uso por Runbook e fabricante nos últimos 30 dias.</li><li><strong>Editor inteligente:</strong> sugestões de comandos por fabricante e inserção rápida de variáveis.</li></ul>
          </div>
        )}
        {activeTab === 'lifecycle' && <div className="doc-content"><h3>📅 Ciclo de Vida e Fim de Suporte</h3><p>O módulo combina inventário do CMDB, garantia, contratos, licenças, versão instalada, vulnerabilidades e informações oficiais de EOL/EOS.</p><h4>Fluxo operacional</h4><ol><li>Vincule o equipamento a um ativo do CMDB e execute a coleta de inventário.</li><li>Abra <strong>Ciclo de Vida</strong> e identifique ativos sem correspondência no catálogo.</li><li>Use <strong>Preparar referência oficial</strong>, abra o portal do fabricante e confirme modelo, versão, estado e datas.</li><li>Informe somente datas publicadas; quando o fabricante apenas indicar <em>Discontinued</em>, registre o estado sem inventar uma data.</li><li>Use <strong>Verificar agora</strong> para recalcular alertas e risco.</li></ol><h4>Alertas e automação</h4><ul><li>Fim de suporte, garantia ou licença: avisos em 90, 30 e 7 dias e após o vencimento.</li><li>Produto descontinuado: alerta alto, elevado a crítico quando o ativo for crítico.</li><li>Fonte oficial sem revisão: aviso após 90 dias, configurável por <code>LIFECYCLE_CATALOG_REVIEW_DAYS</code>.</li><li>Condições críticas podem criar uma Task automaticamente; a chave do ativo impede duplicidade.</li><li>Nenhuma atualização ou substituição é executada automaticamente.</li></ul><h4>Relatórios e auditoria</h4><p>Os botões PDF e CSV respeitam os filtros da página e incluem riscos, fontes, alertas, Tasks e recomendações. Cadastro, revisão, exportação e mudanças ficam registrados na Auditoria.</p><h4>Checklist de encerramento</h4><ul className="docs-highlight-list"><li>Inventário recente e ativo vinculado ao CMDB.</li><li>Fabricante, modelo e versão identificados.</li><li>Fonte HTTPS oficial vinculada e revisada.</li><li>Estado e datas confirmados sem estimativas.</li><li>Telegram testado e deduplicação validada.</li><li>PDF e CSV exportados com sucesso.</li><li>Ativos de alto risco com Task ou RFC de tratamento.</li></ul><div className="docs-warning"><strong>Governança</strong><p>O catálogo é uma evidência operacional. Sempre preserve a URL oficial e revise a referência antes de atualizar o estado ou uma data.</p></div></div>}
      </div>
    </div>
  );
}
