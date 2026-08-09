import { useState, useEffect } from 'react';
import { Key, MessageSquare, Activity, Save, CheckCircle, Palette, Image, Shield } from 'lucide-react';
import { api } from '../lib/api.js';
import { useToast } from '../contexts/ToastContext.jsx';

const SECTIONS = [
  {
    title: 'Provedor de IA',
    icon: Activity,
    fields: [
      { key: 'ai_provider', label: 'Provedor principal', type: 'select', options: [['claude','Claude'],['openai','OpenAI'],['gemini','Gemini']] },
      { key: 'ai_incident_mode', label: 'Automação de incidentes', type: 'select', defaultValue: 'hybrid', options: [['hybrid','Híbrido — automático apenas High/Disaster'],['manual','Manual — IA somente pelo botão'],['automatic','Automático — IA em todos os alertas']], helperText: 'No modo híbrido, Warning e Average criam a Task sem consumir IA.' },
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
    title: 'SLA de Incidentes', icon: Activity,
    fields: [
      { key: 'sla_warning_percent', label: 'Avisar ao atingir (%)', type: 'number', placeholder: '80', helperText: 'Percentual do prazo de resolução para gerar aviso preventivo.' },
      { key: 'sla_critical_ack_minutes', label: 'Crítica — reconhecer (min)', type: 'number', placeholder: '5' },
      { key: 'sla_critical_resolve_minutes', label: 'Crítica — resolver (min)', type: 'number', placeholder: '30' },
      { key: 'sla_high_ack_minutes', label: 'Alta — reconhecer (min)', type: 'number', placeholder: '15' },
      { key: 'sla_high_resolve_minutes', label: 'Alta — resolver (min)', type: 'number', placeholder: '120' },
      { key: 'sla_medium_ack_minutes', label: 'Média — reconhecer (min)', type: 'number', placeholder: '60' },
      { key: 'sla_medium_resolve_minutes', label: 'Média — resolver (min)', type: 'number', placeholder: '480' },
      { key: 'sla_low_ack_minutes', label: 'Baixa — reconhecer (min)', type: 'number', placeholder: '240' },
      { key: 'sla_low_resolve_minutes', label: 'Baixa — resolver (min)', type: 'number', placeholder: '1440' },
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
    title: 'Notificações e Escalonamento',
    icon: MessageSquare,
    fields: [
      { key: 'notifications_enabled', label: 'Notificações habilitadas', type: 'select', defaultValue: 'false', options: [['true','Sim'],['false','Não']] },
      { key: 'telegram_bot_token', label: 'Token do bot Telegram', type: 'password', placeholder: '123456:ABC...' },
      { key: 'telegram_chat_ids', label: 'Chat IDs do Telegram', type: 'text', placeholder: '-1001234567890,123456789', helperText: 'Separe vários grupos ou usuários por vírgula.' },
      { key: 'notification_base_url', label: 'URL pública do NOC Agent', type: 'text', placeholder: 'http://192.168.250.65', helperText: 'Usada para incluir o link da Task nas mensagens.' },
      { key: 'notify_high_channels', label: 'Canais para prioridade alta', type: 'text', placeholder: 'telegram', helperText: 'Valores aceitos: telegram,whatsapp' },
      { key: 'notify_critical_channels', label: 'Canais para prioridade crítica', type: 'text', placeholder: 'telegram,whatsapp' },
      { key: 'notify_sla_channels', label: 'Canais para violações de SLA', type: 'text', placeholder: 'telegram,whatsapp' },
      { key: 'notify_resolved', label: 'Notificar resolução', type: 'select', defaultValue: 'true', options: [['true','Sim'],['false','Não']] },
      { key: 'critical_escalation_enabled', label: 'Escalonamento crítico automático', type: 'select', defaultValue: 'false', options: [['true','Habilitado'],['false','Desabilitado']], helperText: 'Avança apenas enquanto o incidente crítico estiver sem reconhecimento.' },
      { key: 'critical_escalation_level1_minutes', label: 'Nível 1 após (min)', type: 'number', placeholder: '5' },
      { key: 'critical_escalation_level1_channels', label: 'Nível 1 — canais', type: 'text', placeholder: 'telegram', helperText: 'Valores aceitos: telegram,whatsapp.' },
      { key: 'critical_escalation_level1_recipients', label: 'Nível 1 — Chat IDs Telegram', type: 'text', placeholder: '-1001234567890', helperText: 'Vazio utiliza os destinatários globais.' },
      { key: 'critical_escalation_level2_minutes', label: 'Nível 2 após (min)', type: 'number', placeholder: '15' },
      { key: 'critical_escalation_level2_channels', label: 'Nível 2 — canais', type: 'text', placeholder: 'telegram,whatsapp' },
      { key: 'critical_escalation_level2_recipients', label: 'Nível 2 — Chat IDs Telegram', type: 'text', placeholder: '-1001234567890,123456789' },
      { key: 'critical_escalation_level3_minutes', label: 'Nível 3 após (min)', type: 'number', placeholder: '30' },
      { key: 'critical_escalation_level3_channels', label: 'Nível 3 — canais', type: 'text', placeholder: 'telegram,whatsapp' },
      { key: 'critical_escalation_level3_recipients', label: 'Nível 3 — Chat IDs Telegram', type: 'text', placeholder: '-1001234567890,123456789' },
    ],
  },
  {
    title: 'Zabbix',
    icon: Activity,
    fields: [
      { key: 'system_webhook_url', label: 'Webhook URL do Sistema (Copie para o Zabbix)', type: 'text', readOnly: true },
      { key: 'zabbix_url', label: 'URL do Zabbix', type: 'text', placeholder: 'http://zabbix.example.com' },
      { key: 'zabbix_api_token', label: 'Token da API do Zabbix', type: 'password', placeholder: 'Token somente leitura', helperText: 'Usado pela página Capacidade para consultar hosts e itens. Recomendado: usuário com permissão somente leitura.' },
      { key: 'zabbix_webhook_token', label: 'Token do Webhook (Opcional)', type: 'password', placeholder: 'Crie um token ou deixe em branco', helperText: 'Invente qualquer token/senha para adicionar segurança. Se deixar em branco, não exigiremos token.' },
    ],
  },
  {
    title: 'NetBox e Ansible',
    icon: Activity,
    fields: [
      { key: 'netbox_url', label: 'URL do NetBox', type: 'text', placeholder: 'https://netbox.exemplo.com', helperText: 'A API do NetBox deve estar disponível por HTTPS.' },
      { key: 'netbox_api_token', label: 'Token da API do NetBox', type: 'password', placeholder: 'Token do NetBox', helperText: 'Armazenado criptografado. A integração começa em modo somente leitura/teste.' },
    ],
  },
  {
    title: 'Gestão de Vulnerabilidades', icon: Shield,
    fields: [
      { key:'vulnerability_scan_enabled',label:'Análise automática',type:'select',defaultValue:'false',options:[['true','Habilitada'],['false','Desabilitada']] },
      { key:'vulnerability_scan_interval_hours',label:'Intervalo entre análises (horas)',type:'number',placeholder:'168',helperText:'168 horas corresponde a uma análise semanal.' },
      { key:'nvd_api_key',label:'API Key do NVD (opcional)',type:'password',placeholder:'Chave do NVD',helperText:'Aumenta o limite oficial de consultas. Sem chave, o sistema processa um equipamento por vez.' },
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
  const [testingTelegram, setTestingTelegram] = useState(false);
  const [testingAI, setTestingAI] = useState('');
  const [geminiModels, setGeminiModels] = useState([]);
  const [loadingGeminiModels, setLoadingGeminiModels] = useState(false);
  const [manualGeminiModel, setManualGeminiModel] = useState(false);
  const [openaiModels, setOpenaiModels] = useState([]);
  const [loadingOpenaiModels, setLoadingOpenaiModels] = useState(false);
  const [manualOpenaiModel, setManualOpenaiModel] = useState(false);
  const [claudeModels, setClaudeModels] = useState([]);
  const [loadingClaudeModels, setLoadingClaudeModels] = useState(false);
  const [manualClaudeModel, setManualClaudeModel] = useState(false);
  const [branding, setBranding] = useState({ name:'NOC Agent 35',subtitle:'AI Monitoring',loginSubtitle:'Sistema de Monitoramento NOC com IA',primaryColor:'#00d4ff',logo:null,favicon:null });
  const toast = useToast();

  useEffect(() => {
    api.getBranding().then(r=>setBranding(r.data)).catch(()=>{});
    api.getSettings()
      .then(r => {
        const v = {};
        r.data.forEach(s => { v[s.key] = s.encrypted ? '••••••••' : s.value; });
        v['ai_provider'] ||= 'claude';
        v['ai_incident_mode'] ||= 'hybrid';
        v['openai_model'] ||= 'gpt-5.6-sol';
        v['gemini_model'] ||= 'gemini-3.5-flash';
        v['claude_model'] ||= 'claude-sonnet-5';
        v['sla_warning_percent'] ||= '80';
        v['sla_critical_ack_minutes'] ||= '5'; v['sla_critical_resolve_minutes'] ||= '30';
        v['sla_high_ack_minutes'] ||= '15'; v['sla_high_resolve_minutes'] ||= '120';
        v['sla_medium_ack_minutes'] ||= '60'; v['sla_medium_resolve_minutes'] ||= '480';
        v['sla_low_ack_minutes'] ||= '240'; v['sla_low_resolve_minutes'] ||= '1440';
        v['notifications_enabled'] ||= 'false'; v['notify_high_channels'] ||= 'telegram';
        v['notify_critical_channels'] ||= 'telegram,whatsapp'; v['notify_sla_channels'] ||= 'telegram,whatsapp'; v['notify_resolved'] ||= 'true';
        v['critical_escalation_enabled'] ||= 'false';
        v['critical_escalation_level1_minutes'] ||= '5'; v['critical_escalation_level1_channels'] ||= 'telegram';
        v['critical_escalation_level2_minutes'] ||= '15'; v['critical_escalation_level2_channels'] ||= 'telegram,whatsapp';
        v['critical_escalation_level3_minutes'] ||= '30'; v['critical_escalation_level3_channels'] ||= 'telegram,whatsapp';
        v['system_webhook_url'] = window.location.origin + '/api/webhooks/zabbix';
        v['system_evolution_webhook_url'] = window.location.origin + '/api/webhooks/evolution';
        setValues(v);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const readBrandImage = (field, file) => {
    if (!file) return;
    const limit = field === 'favicon' ? 256 * 1024 : 1536 * 1024;
    if (!['image/png','image/jpeg','image/webp'].includes(file.type)) return toast('Use PNG, JPG ou WebP.','error');
    if (file.size > limit) return toast(`Arquivo maior que ${Math.round(limit/1024)} KB.`,'error');
    const reader = new FileReader(); reader.onload=()=>setBranding(v=>({...v,[field]:reader.result})); reader.readAsDataURL(file);
  };

  const saveBranding = async () => {
    setSaving(true);
    try {
      const result = await api.updateBranding(branding);
      setBranding(result.data);
      window.dispatchEvent(new CustomEvent('noc:branding-updated',{detail:result.data}));
      toast('Identidade visual atualizada.','success');
    } catch (error) { toast(error.message,'error'); } finally { setSaving(false); }
  };

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

  const handleTestTelegram = async () => {
    setTestingTelegram(true);
    try {
      const firstChat = String(values['telegram_chat_ids'] || '').split(',')[0].trim();
      if (!firstChat) throw new Error('Informe pelo menos um Chat ID');
      await api.testTelegram(values['telegram_bot_token'] || '••••••••', firstChat);
      toast('✅ Mensagem de teste enviada ao Telegram!', 'success');
    } catch (err) { toast(`❌ Telegram: ${err.message}`, 'error'); }
    finally { setTestingTelegram(false); }
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

  const handleLoadOpenAIModels = async () => {
    setLoadingOpenaiModels(true);
    try {
      const res = await api.getOpenAIModels(values['openai_api_key']);
      setOpenaiModels(res.data || []);
      if (res.data?.length && !res.data.some(model => model.id === values['openai_model'])) setValues(v => ({ ...v, openai_model: res.data[0].id }));
      setManualOpenaiModel(false);
      toast(`${res.data?.length || 0} modelos de texto encontrados`, 'success');
    } catch (error) { toast(`❌ ${error.message}`, 'error'); }
    finally { setLoadingOpenaiModels(false); }
  };

  const handleLoadClaudeModels = async () => {
    setLoadingClaudeModels(true);
    try {
      const res = await api.getClaudeModels(values['claude_api_key']);
      setClaudeModels(res.data || []);
      if (res.data?.length && !res.data.some(model => model.id === values['claude_model'])) {
        setValues(v => ({ ...v, claude_model: res.data[0].id }));
      }
      setManualClaudeModel(false);
      toast(`${res.data?.length || 0} modelos Claude encontrados`, 'success');
    } catch (error) { toast(`❌ ${error.message}`, 'error'); }
    finally { setLoadingClaudeModels(false); }
  };

  if (loading) return <div className="loading-screen"><div className="spinner" /></div>;

  return (
    <div>
      <div className="page-header"><h2>Configurações</h2><p>Configure as APIs e credenciais do sistema</p></div>
      <div className="settings-section">
        <div className="settings-section-title"><Palette size={20}/> Identidade visual</div>
        <div className="form-row"><div className="form-group"><label className="form-label">Nome do sistema</label><input className="form-input" maxLength="60" value={branding.name} onChange={e=>setBranding(v=>({...v,name:e.target.value}))}/></div><div className="form-group"><label className="form-label">Subtítulo do menu</label><input className="form-input" maxLength="80" value={branding.subtitle} onChange={e=>setBranding(v=>({...v,subtitle:e.target.value}))}/></div></div>
        <div className="form-row"><div className="form-group"><label className="form-label">Texto da tela de login</label><input className="form-input" maxLength="120" value={branding.loginSubtitle} onChange={e=>setBranding(v=>({...v,loginSubtitle:e.target.value}))}/></div><div className="form-group"><label className="form-label">Cor principal</label><div style={{display:'flex',gap:8}}><input type="color" value={branding.primaryColor} onChange={e=>setBranding(v=>({...v,primaryColor:e.target.value}))} style={{width:52,height:42,border:0,background:'transparent'}}/><input className="form-input" value={branding.primaryColor} onChange={e=>setBranding(v=>({...v,primaryColor:e.target.value}))}/></div></div></div>
        <div className="form-row"><div className="form-group"><label className="form-label">Logo — PNG/JPG/WebP, até 1,5 MB</label><input className="form-input" type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>readBrandImage('logo',e.target.files[0])}/>{branding.logo&&<div style={{display:'flex',alignItems:'center',gap:10,marginTop:8}}><img src={branding.logo} alt="Prévia" style={{width:64,height:64,objectFit:'contain',background:'var(--bg-secondary)',borderRadius:8,padding:4}}/><button className="btn btn-ghost btn-sm" onClick={()=>setBranding(v=>({...v,logo:null}))}>Remover</button></div>}</div><div className="form-group"><label className="form-label">Favicon — até 256 KB</label><input className="form-input" type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>readBrandImage('favicon',e.target.files[0])}/>{branding.favicon&&<div style={{display:'flex',alignItems:'center',gap:10,marginTop:8}}><img src={branding.favicon} alt="Favicon" style={{width:40,height:40,objectFit:'contain'}}/><button className="btn btn-ghost btn-sm" onClick={()=>setBranding(v=>({...v,favicon:null}))}>Remover</button></div>}</div></div>
        <button className="btn btn-primary" onClick={saveBranding} disabled={saving}>{saving?<><div className="spinner"/> Salvando...</>:<><Image size={16}/> Salvar identidade visual</>}</button>
      </div>
      {SECTIONS.map(section => (
        <div key={section.title} className="settings-section">
          <div className="settings-section-title"><section.icon size={20} /> {section.title}</div>
          {section.fields.map(f => (
            <div className="form-group" key={f.key}>
              <label className="form-label">{f.label}</label>
              {f.key === 'claude_model' && claudeModels.length > 0 && !manualClaudeModel ? <select className="form-select" value={values[f.key] || ''} onChange={e => {
                if (e.target.value === '__manual__') setManualClaudeModel(true);
                else setValues(v => ({ ...v, [f.key]: e.target.value }));
              }}>
                {claudeModels.map(model => <option key={model.id} value={model.id}>{model.name} — {model.id}</option>)}
                <option value="__manual__">Digitar modelo manualmente…</option>
              </select> : f.key === 'openai_model' && openaiModels.length > 0 && !manualOpenaiModel ? <select className="form-select" value={values[f.key] || ''} onChange={e => {
                if (e.target.value === '__manual__') setManualOpenaiModel(true);
                else setValues(v => ({ ...v, [f.key]: e.target.value }));
              }}>
                {openaiModels.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}
                <option value="__manual__">Digitar modelo manualmente…</option>
              </select> : f.key === 'gemini_model' && geminiModels.length > 0 && !manualGeminiModel ? <select className="form-select" value={values[f.key] || ''} onChange={e => {
                if (e.target.value === '__manual__') setManualGeminiModel(true);
                else setValues(v => ({ ...v, [f.key]: e.target.value }));
              }}>
                {geminiModels.map(model => <option key={model.id} value={model.id}>{model.name} — {model.id}</option>)}
                <option value="__manual__">Digitar modelo manualmente…</option>
              </select> : f.type === 'select' ? <select className="form-select" value={values[f.key] || f.defaultValue || 'claude'} onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))}>
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
            {section.title === 'Claude API' && <button className="btn btn-secondary" onClick={handleLoadClaudeModels} disabled={loadingClaudeModels}>
              {loadingClaudeModels ? <><div className="spinner" /> Consultando...</> : <><Activity size={16} /> Carregar modelos</>}
            </button>}
            {section.title === 'OpenAI API' && <button className="btn btn-secondary" onClick={() => handleTestAI('openai')} disabled={testingAI === 'openai'}><CheckCircle size={16} /> Testar OpenAI</button>}
            {section.title === 'OpenAI API' && <button className="btn btn-secondary" onClick={handleLoadOpenAIModels} disabled={loadingOpenaiModels}>{loadingOpenaiModels ? <><div className="spinner"/> Consultando...</> : <><Activity size={16}/> Carregar modelos</>}</button>}
            {section.title === 'Gemini API' && <button className="btn btn-secondary" onClick={() => handleTestAI('gemini')} disabled={testingAI === 'gemini'}><CheckCircle size={16} /> Testar Gemini</button>}
            {section.title === 'Gemini API' && <button className="btn btn-secondary" onClick={handleLoadGeminiModels} disabled={loadingGeminiModels}>
              {loadingGeminiModels ? <><div className="spinner" /> Consultando...</> : <><Activity size={16} /> Carregar modelos</>}
            </button>}
            {section.title === 'Evolution API (WhatsApp)' && (
              <button className="btn btn-secondary" onClick={handleTestEvolution} disabled={testingEvolution}>
                {testingEvolution ? <><div className="spinner" /> Testando...</> : <><MessageSquare size={16} /> Testar Envio</>}
              </button>
            )}
            {section.title === 'Notificações e Escalonamento' && <button className="btn btn-secondary" onClick={handleTestTelegram} disabled={testingTelegram}><MessageSquare size={16} /> {testingTelegram ? 'Testando...' : 'Testar Telegram'}</button>}
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
