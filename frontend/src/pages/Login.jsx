import { useState } from 'react';
import {
  Activity, ArrowRight, BarChart3, CheckCircle, Eye, EyeOff, Lock,
  MessageSquare, Server, Shield, TerminalSquare, User,
} from 'lucide-react';
import { api } from '../lib/api.js';

const FEATURES = [
  { icon: Activity, title: 'Monitoramento inteligente', text: 'Alertas do Zabbix, incidentes, SLA e acompanhamento operacional em tempo real.' },
  { icon: Server, title: 'Agentes especialistas', text: 'Diagnóstico assistido para MikroTik RouterOS, Huawei VRP e servidores Linux.' },
  { icon: TerminalSquare, title: 'Terminal CLI seguro', text: 'Console auditada e sessões SSH interativas com múltiplos equipamentos.' },
  { icon: MessageSquare, title: 'Operação multicanal', text: 'Integração com WhatsApp e Telegram para solicitações e notificações.' },
  { icon: BarChart3, title: 'Tasks e relatórios', text: 'Fluxo completo de incidentes, responsáveis, histórico e indicadores.' },
  { icon: Shield, title: 'Segurança e auditoria', text: 'Perfis de acesso, autenticação em dois fatores e rastreabilidade das ações.' },
];

const INTEGRATIONS = ['Zabbix', 'MikroTik', 'Huawei', 'Linux', 'WhatsApp', 'Telegram', 'Claude', 'OpenAI', 'Gemini'];

export default function Login({ onLogin, branding }) {
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
          <div className="login-eyebrow"><span /> Plataforma de operações NOC</div>
          <h1>Operações de rede mais <em>rápidas, seguras e inteligentes.</em></h1>
          <p>Centralize monitoramento, incidentes, diagnósticos, automações e acesso aos equipamentos em uma única plataforma.</p>
          <div className="login-proof">
            <span><CheckCircle size={15} /> Monitoramento contínuo</span>
            <span><CheckCircle size={15} /> Operações auditadas</span>
            <span><CheckCircle size={15} /> Agentes especializados</span>
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
