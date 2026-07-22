import { useState, useEffect } from 'react';
import { Key, MessageSquare, Activity, Save, CheckCircle } from 'lucide-react';
import { api } from '../lib/api.js';
import { useToast } from '../App.jsx';

const SECTIONS = [
  {
    title: 'Provedor de IA',
    icon: Activity,
    fields: [
      { key: 'ai_provider', label: 'Provedor principal', type: 'select', options: [['claude','Claude'],['openai','OpenAI'],['gemini','Gemini']] },
      { key: 'ai_fallback_order', label: 'Ordem de fallback', type: 'text', placeholder: 'openai,gemini,claude', helperText: 'Lista separada por vírgulas. Provedores sem chave são ignorados.' },
    ],
  },
  {
    title: 'Claude API',
    icon: Activity,
    fields: [
      { key: 'claude_api_key', label: 'API Key', type: 'password', placeholder: 'sk-ant-...' },
      { key: 'claude_model', label: 'Modelo', type: 'text', placeholder: 'claude-opus-4-7-20260324' },
    ],
  },
  {
    title: 'OpenAI API', icon: Activity,
    fields: [
      { key: 'openai_api_key', label: 'API Key', type: 'password', placeholder: 'sk-...' },
      { key: 'openai_model', label: 'Modelo', type: 'text', placeholder: 'gpt-5.6' },
    ],
  },
  {
    title: 'Gemini API', icon: Activity,
    fields: [
      { key: 'gemini_api_key', label: 'API Key', type: 'password', placeholder: 'Chave Google AI' },
      { key: 'gemini_model', label: 'Modelo', type: 'text', placeholder: 'gemini-3.5-flash' },
    ],
  },
  {
    title: 'Evolution API (WhatsApp)',
    icon: MessageSquare,
    fields: [
      { key: 'system_evolution_webhook_url', label: 'Webhook URL (Copie para a Evolution API)', type: 'text', readOnly: true },
      { key: 'evolution_api_url', label: 'URL Base', type: 'text', placeholder: 'http://localhost:8080' },
      { key: 'evolution_api_key', label: 'API Key', type: 'password', placeholder: 'Sua API key' },
      { key: 'evolution_instance', label: 'Nome da Instância', type: 'text', placeholder: 'noc-agent' },
      { key: 'admin_whatsapp', label: 'WhatsApp Admin', type: 'text', placeholder: '5511999999999' },
      { key: 'authorized_numbers', label: 'Números Autorizados', type: 'text', placeholder: '5511999999999,5511888888888' },
    ],
  },
  {
    title: 'Zabbix',
    icon: Activity,
    fields: [
      { key: 'system_webhook_url', label: 'Webhook URL do Sistema (Copie para o Zabbix)', type: 'text', readOnly: true },
      { key: 'zabbix_url', label: 'URL do Zabbix', type: 'text', placeholder: 'http://zabbix.example.com' },
      { key: 'zabbix_webhook_token', label: 'Token do Webhook (Opcional)', type: 'password', placeholder: 'Crie um token ou deixe em branco', helperText: 'Invente qualquer token/senha para adicionar segurança. Se deixar em branco, não exigiremos token.' },
    ],
  },
  {
    title: 'Segurança',
    icon: Key,
    fields: [
      { key: 'dashboard_password', label: 'Senha do Dashboard', type: 'password', placeholder: 'Nova senha' },
    ],
  },
];

export default function Settings() {
  const [values, setValues] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testingClaude, setTestingClaude] = useState(false);
  const [testingEvolution, setTestingEvolution] = useState(false);
  const [testingAI, setTestingAI] = useState('');
  const [geminiModels, setGeminiModels] = useState([]);
  const [loadingGeminiModels, setLoadingGeminiModels] = useState(false);
  const [manualGeminiModel, setManualGeminiModel] = useState(false);
  const toast = useToast();

  useEffect(() => {
    api.getSettings()
      .then(r => {
        const v = {};
        r.data.forEach(s => { v[s.key] = s.encrypted ? '••••••••' : s.value; });
        v['ai_provider'] ||= 'claude';
        v['openai_model'] ||= 'gpt-5.6-terra';
        v['gemini_model'] ||= 'gemini-3.5-flash';
        v['claude_model'] ||= 'claude-sonnet-5';
        v['system_webhook_url'] = window.location.origin + '/api/webhooks/zabbix';
        v['system_evolution_webhook_url'] = window.location.origin + '/api/webhooks/evolution';
        setValues(v);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async (sectionFields) => {
    setSaving(true);
    try {
      const settings = sectionFields
        .filter(f => !f.readOnly && values[f.key] !== undefined && values[f.key] !== '')
        .map(f => ({ key: f.key, value: values[f.key] }));
      if (settings.length === 0) { toast('Nenhum campo alterado', 'info'); setSaving(false); return; }
      await api.updateSettingsBulk(settings);
      toast('Configurações salvas com sucesso!', 'success');
    } catch (err) { toast(err.message, 'error'); }
    finally { setSaving(false); }
  };

  const handleTestClaude = async () => {
    setTestingClaude(true);
    try {
      const res = await api.testClaudeAPI(values['claude_api_key'] || '••••••••', values['claude_model']);
      if (res.success) {
        toast('✅ Conexão com Claude OK!', 'success');
      } else {
        toast(`❌ Erro: ${res.error}`, 'error');
      }
    } catch (err) {
      toast(`❌ Erro ao testar: ${err.message}`, 'error');
    } finally {
      setTestingClaude(false);
    }
  };

  const handleTestEvolution = async () => {
    setTestingEvolution(true);
    try {
      const payload = {
        apiUrl: values['evolution_api_url'],
        apiKey: values['evolution_api_key'] || '••••••••',
        instance: values['evolution_instance'],
        phone: values['admin_whatsapp']
      };
      
      if (!payload.apiUrl || !payload.instance || !payload.phone) {
        toast('❌ Preencha a URL, Instância e o WhatsApp Admin primeiro!', 'error');
        setTestingEvolution(false);
        return;
      }

      const res = await api.testEvolutionAPI(payload);
      if (res.success) {
        toast('✅ Mensagem enviada! Verifique o WhatsApp Admin.', 'success');
      } else {
        toast(`❌ Erro Evolution: ${res.error}`, 'error');
      }
    } catch (err) {
      toast(`❌ Erro ao testar: ${err.message}`, 'error');
    } finally {
      setTestingEvolution(false);
    }
  };

  const handleTestAI = async provider => {
    setTestingAI(provider);
    try {
      const res = await api.testAIProvider(provider, values[`${provider}_model`]);
      toast(res.success ? `✅ ${provider} conectado!` : `❌ ${res.error}`, res.success ? 'success' : 'error');
    } catch (err) { toast(`❌ ${err.message}`, 'error'); }
    finally { setTestingAI(''); }
  };

  const handleLoadGeminiModels = async () => {
    setLoadingGeminiModels(true);
    try {
      const res = await api.getGeminiModels(values['gemini_api_key']);
      setGeminiModels(res.data || []);
      if (res.data?.length && !res.data.some(model => model.id === values['gemini_model'])) {
        setValues(v => ({ ...v, gemini_model: res.data[0].id }));
      }
      setManualGeminiModel(false);
      toast(`${res.data?.length || 0} modelos compatíveis encontrados`, 'success');
    } catch (err) { toast(`❌ ${err.message}`, 'error'); }
    finally { setLoadingGeminiModels(false); }
  };

  if (loading) return <div className="loading-screen"><div className="spinner" /></div>;

  return (
    <div>
      <div className="page-header"><h2>Configurações</h2><p>Configure as APIs e credenciais do sistema</p></div>
      {SECTIONS.map(section => (
        <div key={section.title} className="settings-section">
          <div className="settings-section-title"><section.icon size={20} /> {section.title}</div>
          {section.fields.map(f => (
            <div className="form-group" key={f.key}>
              <label className="form-label">{f.label}</label>
              {f.key === 'gemini_model' && geminiModels.length > 0 && !manualGeminiModel ? <select className="form-select" value={values[f.key] || ''} onChange={e => {
                if (e.target.value === '__manual__') setManualGeminiModel(true);
                else setValues(v => ({ ...v, [f.key]: e.target.value }));
              }}>
                {geminiModels.map(model => <option key={model.id} value={model.id}>{model.name} — {model.id}</option>)}
                <option value="__manual__">Digitar modelo manualmente…</option>
              </select> : f.type === 'select' ? <select className="form-select" value={values[f.key] || 'claude'} onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))}>
                {f.options.map(([value,label]) => <option key={value} value={value}>{label}</option>)}
              </select> : <input className="form-input" type={f.type} placeholder={f.placeholder}
                value={values[f.key] || ''}
                readOnly={f.readOnly}
                onChange={e => !f.readOnly && setValues(v => ({ ...v, [f.key]: e.target.value }))}
                style={f.readOnly ? { backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-secondary)' } : {}}
              />}
              {f.helperText && <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>{f.helperText}</div>}
            </div>
          ))}
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="btn btn-primary" onClick={() => handleSave(section.fields)} disabled={saving}>
              {saving ? <><div className="spinner" /> Salvando...</> : <><Save size={16} /> Salvar {section.title}</>}
            </button>
            {section.title === 'Claude API' && (
              <button className="btn btn-secondary" onClick={handleTestClaude} disabled={testingClaude}>
                {testingClaude ? <><div className="spinner" /> Testando...</> : <><CheckCircle size={16} /> Testar Conexão</>}
              </button>
            )}
            {section.title === 'OpenAI API' && <button className="btn btn-secondary" onClick={() => handleTestAI('openai')} disabled={testingAI === 'openai'}><CheckCircle size={16} /> Testar OpenAI</button>}
            {section.title === 'Gemini API' && <button className="btn btn-secondary" onClick={() => handleTestAI('gemini')} disabled={testingAI === 'gemini'}><CheckCircle size={16} /> Testar Gemini</button>}
            {section.title === 'Gemini API' && <button className="btn btn-secondary" onClick={handleLoadGeminiModels} disabled={loadingGeminiModels}>
              {loadingGeminiModels ? <><div className="spinner" /> Consultando...</> : <><Activity size={16} /> Carregar modelos</>}
            </button>}
            {section.title === 'Evolution API (WhatsApp)' && (
              <button className="btn btn-secondary" onClick={handleTestEvolution} disabled={testingEvolution}>
                {testingEvolution ? <><div className="spinner" /> Testando...</> : <><MessageSquare size={16} /> Testar Envio</>}
              </button>
            )}
          </div>
          {section.title === 'Zabbix' && (
            <div style={{ marginTop: '20px', padding: '15px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '8px' }}>
              <h4 style={{ margin: '0 0 10px 0', color: 'var(--text-primary)' }}>Como configurar o Webhook no Zabbix</h4>
              <p style={{ fontSize: '14px', marginBottom: '10px', color: 'var(--text-secondary)' }}>
                1. No Zabbix, vá em <b>Administration</b> {'>'} <b>Media types</b> e crie um novo do tipo <b>Webhook</b>.<br/>
                2. Adicione os seguintes parâmetros:
              </p>
              <ul style={{ fontSize: '14px', marginBottom: '10px', paddingLeft: '20px', color: 'var(--text-secondary)' }}>
                <li><b>url:</b> {values['system_webhook_url'] || 'http://seu-ip/api/webhooks/zabbix'}</li>
                <li><b>token:</b> {values['zabbix_webhook_token'] ? '(Token configurado acima)' : '(Opcional - preencha acima se desejar mais segurança)'}</li>
                <li><b>host:</b> {'{HOST.HOST}'}</li>
                <li><b>hostname:</b> {'{HOST.NAME}'}</li>
                <li><b>hostId:</b> {'{HOST.ID}'}</li>
                <li><b>trigger:</b> {'{TRIGGER.NAME}'}</li>
                <li><b>severity:</b> {'{EVENT.SEVERITY}'}</li>
                <li><b>status:</b> {'{EVENT.STATUS}'}</li>
                <li><b>eventId:</b> {'{EVENT.ID}'}</li>
                <li><b>eventValue:</b> {'{EVENT.VALUE}'}</li>
                <li><b>eventTimestamp:</b> {'{EVENT.TIMESTAMP}'}</li>
                <li><b>recoveryEventId:</b> {'{EVENT.RECOVERY.ID}'}</li>
                <li><b>recoveryTimestamp:</b> {'{EVENT.RECOVERY.TIMESTAMP}'}</li>
                <li><b>itemName:</b> {'{ITEM.NAME}'}</li>
                <li><b>itemValue:</b> {'{ITEM.VALUE}'}</li>
              </ul>
              <p style={{ fontSize: '14px', marginBottom: '5px', color: 'var(--text-secondary)' }}>3. Cole o script abaixo no campo <b>Script</b>:</p>
              <pre style={{ backgroundColor: '#1e1e1e', color: '#d4d4d4', padding: '10px', borderRadius: '4px', fontSize: '12px', overflowX: 'auto' }}>
{`try {
    var params = JSON.parse(value);
    var req = new HttpRequest();
    
    req.addHeader('Content-Type: application/json');
    if (params.token) {
        req.addHeader('x-zabbix-token: ' + params.token);
    }
    
    var payload = {
        host: params.host,
        hostname: params.hostname,
        hostId: params.hostId,
        trigger: params.trigger,
        severity: params.severity,
        status: params.status,
        eventId: params.eventId,
        eventValue: params.eventValue,
        eventTimestamp: params.eventTimestamp,
        recoveryEventId: params.recoveryEventId,
        recoveryTimestamp: params.recoveryTimestamp,
        itemName: params.itemName,
        itemValue: params.itemValue
    };
    
    var resp = req.post(params.url, JSON.stringify(payload));
    
    if (req.getStatus() != 200) {
        throw 'Response code: ' + req.getStatus() + '\\n' + resp;
    }
    
    return 'OK';
} catch (error) {
    Zabbix.log(4, '[ NOC Webhook ] Falha: ' + error);
    throw 'Failed to send alert: ' + error;
}`}
              </pre>
              <h4 style={{ margin: '15px 0 10px 0', color: 'var(--text-primary)' }}>Configuração da Media no Usuário</h4>
              <p style={{ fontSize: '14px', marginBottom: '10px', color: 'var(--text-secondary)' }}>
                4. Vá em <b>Users</b>, edite o usuário que receberá os alertas, acesse a aba <b>Media</b> e adicione:
              </p>
              <ul style={{ fontSize: '14px', marginBottom: '0', paddingLeft: '20px', color: 'var(--text-secondary)' }}>
                <li><b>Type:</b> Escolha o nome do Webhook criado no passo 1.</li>
                <li><b>Send to:</b> Pode preencher com <i>noc-agent</i> (nosso sistema usará o WhatsApp Admin configurado acima, ignorando este campo).</li>
                <li><b>Use if severity:</b> Recomendamos marcar apenas de <b>Warning</b> a <b>Disaster</b> para evitar alertas desnecessários.</li>
              </ul>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
