import { useState } from 'react';
import {
  Activity, ArrowRight, CheckCircle, DatabaseBackup, Eye, EyeOff, Lock,
  MessageSquare, Network, Server, Shield, TerminalSquare, User,
} from 'lucide-react';
import { api } from '../lib/api.js';
import ThemeSelector from '../components/ThemeSelector.jsx';

const FEATURES = [
  { icon: Activity, title: 'Incidentes e capacidade', text: 'Alertas Zabbix, SLA, escalonamento, tendências e acompanhamento operacional.' },
  { icon: Server, title: 'Operação multi-vendor', text: 'Agentes especialistas para nove plataformas de rede, segurança e servidores.' },
  { icon: TerminalSquare, title: 'Terminal CLI seguro', text: 'Console auditado, autocomplete e múltiplas sessões SSH com controle de mudanças.' },
  { icon: Network, title: 'Topologia automática', text: 'Mapa operacional com descoberta LLDP/CDP, correlação de vizinhos e impactos.' },
  { icon: DatabaseBackup, title: 'Backup e compliance', text: 'Snapshots agendados, comparação de versões e baselines por fabricante.' },
  { icon: MessageSquare, title: 'Automação multicanal', text: 'Tasks, relatórios e agentes via painel, WhatsApp e Telegram com IA multi-modelo.' },
];

const INTEGRATIONS = [
  'Zabbix', 'MikroTik', 'Huawei', 'Cisco', 'Juniper', 'FortiGate',
  'Ubiquiti', 'Datacom', 'Nokia', 'Linux', 'WhatsApp', 'Telegram', 'Multi-IA',
];

export default function Login({ onLogin, branding, theme, onTheme }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [requiresTwoFactor, setRequiresTwoFactor] = useState(false);
  const [otp, setOtp] = useState('');

  const handleSubmit = async event => {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const result = await api.login(username.trim(), password, otp);
      if (result.requiresTwoFactor) {
        setRequiresTwoFactor(true);
        setError('Confirme sua identidade com o código de autenticação.');
        return;
      }
      localStorage.setItem('noc_token', result.token);
      onLogin(result.user);
    } catch (requestError) {
      setError(requestError.message || 'Não foi possível entrar. Verifique suas credenciais.');
    } finally {
      setLoading(false);
    }
  };

  const systemName = branding?.name || 'NOC Agent 35';

  return (
    <main className="login-page">
      <div className="login-theme"><ThemeSelector value={theme} onChange={onTheme} compact/></div>
      <div className="login-ambient" aria-hidden="true">
        <span className="login-orb login-orb-one" />
        <span className="login-orb login-orb-two" />
        <div className="login-grid" />
      </div>

      <section className="login-showcase">
        <header className="login-brand">
          <div className="login-brand-mark">
            {branding?.logo ? <img className="brand-logo-image" src={branding.logo} alt="" /> : <Activity size={25} />}
          </div>
          <div>
            <strong>{systemName}</strong>
            <span>{branding?.subtitle || 'AI Monitoring'}</span>
          </div>
        </header>

        <div className="login-hero">
          <div className="login-eyebrow"><span /> Plataforma multi-vendor para operações NOC</div>
          <h1>Operações de rede mais <em>rápidas, seguras e inteligentes.</em></h1>
          <p>Centralize monitoramento, incidentes, topologia, capacidade, compliance, backups e automações em uma única plataforma.</p>
          <div className="login-proof">
            <span><CheckCircle size={15} /> 9 plataformas suportadas</span>
            <span><CheckCircle size={15} /> Mudanças auditadas</span>
            <span><CheckCircle size={15} /> IA com múltiplos provedores</span>
          </div>
        </div>

        <div className="login-feature-grid">
          {FEATURES.map(feature => (
            <article className="login-feature" key={feature.title}>
              <div><feature.icon size={18} /></div>
              <section><strong>{feature.title}</strong><p>{feature.text}</p></section>
            </article>
          ))}
        </div>

        <div className="login-integrations">
          <span>Integrações e plataformas</span>
          <div>{INTEGRATIONS.map(item => <small key={item}>{item}</small>)}</div>
        </div>
      </section>

      <aside className="login-access">
        <div className="login-access-inner">
          <div className="login-mobile-brand">
            <div className="login-brand-mark">
              {branding?.logo ? <img className="brand-logo-image" src={branding.logo} alt="" /> : <Activity size={24} />}
            </div>
            <strong>{systemName}</strong>
          </div>

          <div className="login-security-badge"><Shield size={14} /> Ambiente protegido</div>
          <div className="login-form-heading">
            <h2>Acesse sua conta</h2>
            <p>{branding?.loginSubtitle || 'Entre para acessar o centro de operações.'}</p>
          </div>

          <form className="login-form" onSubmit={handleSubmit}>
            <div className="form-group">
              <label className="form-label" htmlFor="login-username">Usuário</label>
              <div className="login-field">
                <User size={17} />
                <input id="login-username" className="form-input" placeholder="Digite seu usuário" value={username}
                  onChange={event => setUsername(event.target.value)} autoFocus autoComplete="username" required />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="login-password">Senha</label>
              <div className="login-field">
                <Lock size={17} />
                <input id="login-password" type={showPassword ? 'text' : 'password'} className="form-input"
                  placeholder="Digite sua senha" value={password} onChange={event => setPassword(event.target.value)}
                  autoComplete="current-password" required />
                <button type="button" className="login-password-toggle" onClick={() => setShowPassword(value => !value)}
                  aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}>
                  {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </div>

            {requiresTwoFactor && <div className="form-group login-otp-group">
              <label className="form-label" htmlFor="login-otp">Código de autenticação</label>
              <div className="login-field">
                <Shield size={17} />
                <input id="login-otp" className="form-input" inputMode="numeric" autoComplete="one-time-code"
                  maxLength={6} pattern="[0-9]{6}" placeholder="000000" value={otp}
                  onChange={event => setOtp(event.target.value.replace(/\D/g, ''))} autoFocus required />
              </div>
              <small>Informe o código de 6 dígitos do seu aplicativo autenticador.</small>
            </div>}

            {error && <div className={`login-alert ${requiresTwoFactor ? 'info' : ''}`} role="alert">
              <span>{requiresTwoFactor ? 'i' : '!'}</span>{error}
            </div>}

            <button type="submit" className="btn btn-primary btn-lg login-submit" disabled={loading || !username.trim() || !password || (requiresTwoFactor && otp.length !== 6)}>
              {loading ? <><div className="spinner" /> Autenticando...</> : <>Entrar no sistema <ArrowRight size={18} /></>}
            </button>
          </form>

          <div className="login-restricted">
            <Lock size={13} />
            <span><strong>Acesso restrito.</strong> Sessões e ações administrativas são monitoradas e auditadas.</span>
          </div>
          <footer>© {new Date().getFullYear()} {systemName} · Operações de rede com inteligência</footer>
        </div>
      </aside>
    </main>
  );
}
