import { useEffect, useState } from 'react';
import { Copy, KeyRound, LogOut, ShieldCheck, Smartphone } from 'lucide-react';
import { api } from '../lib/api.js';
import { useToast } from '../App.jsx';

export default function Security({ user, onUser, forcePasswordChange = false }) {
  const [passwords, setPasswords] = useState({ current: '', next: '', confirm: '' });
  const [setup, setSetup] = useState(null);
  const [code, setCode] = useState('');
  const [sessions, setSessions] = useState([]);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const loadSessions = () => api.getSessions().then(r => setSessions(r.data)).catch(() => {});
  useEffect(() => { if (!forcePasswordChange) loadSessions(); }, [forcePasswordChange]);

  const change = async e => {
    e.preventDefault();
    if (passwords.next !== passwords.confirm) return toast('As novas senhas não coincidem', 'error');
    setBusy(true);
    try {
      const r = await api.changePassword(passwords.current, passwords.next);
      localStorage.setItem('noc_token', r.token); onUser(r.user); setPasswords({ current: '', next: '', confirm: '' });
      toast('Senha alterada e outras sessões encerradas', 'success');
    } catch (error) { toast(error.message, 'error'); } finally { setBusy(false); }
  };
  const start2fa = async () => { const password = window.prompt('Digite sua senha atual:'); if (!password) return; try { setSetup((await api.setupTwoFactor(password)).data); } catch (e) { toast(e.message, 'error'); } };
  const enable2fa = async () => { try { const r = await api.enableTwoFactor(code); onUser(r.user); setSetup(null); setCode(''); toast('2FA ativado', 'success'); } catch (e) { toast(e.message, 'error'); } };
  const disable2fa = async () => { const password = window.prompt('Digite sua senha atual:'); if (!password) return; const otp = window.prompt('Digite o código 2FA:'); if (!otp) return; try { const r = await api.disableTwoFactor(password, otp); onUser(r.user); toast('2FA desativado', 'success'); } catch (e) { toast(e.message, 'error'); } };
  const revoke = async session => { if (!window.confirm('Encerrar esta sessão?')) return; try { const r = await api.revokeSession(session.id); if (r.current) { localStorage.removeItem('noc_token'); location.reload(); } else loadSessions(); } catch (e) { toast(e.message, 'error'); } };

  return <div style={forcePasswordChange ? { maxWidth: 650, margin: '40px auto', padding: 16 } : {}}>
    <div className="page-header"><h2>{forcePasswordChange ? 'Troca obrigatória de senha' : 'Minha segurança'}</h2><p>{forcePasswordChange ? 'Defina uma senha pessoal antes de continuar.' : 'Senha, autenticação em dois fatores e sessões ativas'}</p></div>
    <form className="card" onSubmit={change} style={{ marginBottom: 16 }}><h3><KeyRound size={18} /> Alterar senha</h3><p style={{ fontSize: '.8rem', color: 'var(--text-muted)', margin: '8px 0' }}>Mínimo de 10 caracteres, com maiúscula, minúscula, número e símbolo.</p><div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 10 }}><input className="form-input" type="password" placeholder="Senha atual" value={passwords.current} onChange={e => setPasswords({ ...passwords, current: e.target.value })} required /><input className="form-input" type="password" placeholder="Nova senha" value={passwords.next} onChange={e => setPasswords({ ...passwords, next: e.target.value })} required /><input className="form-input" type="password" placeholder="Confirmar nova senha" value={passwords.confirm} onChange={e => setPasswords({ ...passwords, confirm: e.target.value })} required /></div><button className="btn btn-primary" style={{ marginTop: 12 }} disabled={busy}>Alterar senha</button></form>
    {!forcePasswordChange && <><div className="card" style={{ marginBottom: 16 }}><h3><ShieldCheck size={18} /> Autenticação em dois fatores</h3><p style={{ margin: '8px 0', color: 'var(--text-secondary)' }}>Status: <strong>{user?.twoFactorEnabled ? 'Ativado' : 'Desativado'}</strong></p>{!user?.twoFactorEnabled && !setup && <button className="btn btn-primary" onClick={start2fa}>Configurar 2FA</button>}{user?.twoFactorEnabled && <button className="btn btn-secondary" onClick={disable2fa}>Desativar 2FA</button>}{setup && <div style={{ marginTop: 12, padding: 12, background: 'var(--bg-tertiary)', borderRadius: 8 }}><p>Adicione manualmente no Google Authenticator, Microsoft Authenticator ou Authy:</p><div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '10px 0' }}><code style={{ fontSize: '1rem', wordBreak: 'break-all' }}>{setup.secret}</code><button className="btn btn-secondary" onClick={() => navigator.clipboard.writeText(setup.secret)}><Copy size={14} /></button></div><details><summary>URI avançada</summary><code style={{ wordBreak: 'break-all', fontSize: '.7rem' }}>{setup.uri}</code></details><div style={{ display: 'flex', gap: 8, marginTop: 10 }}><input className="form-input" style={{ maxWidth: 180 }} inputMode="numeric" maxLength={6} placeholder="Código de 6 dígitos" value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} /><button className="btn btn-success" onClick={enable2fa}>Confirmar e ativar</button></div></div>}</div>
    <div className="card"><h3><Smartphone size={18} /> Sessões ativas</h3><div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>{sessions.map(s => <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: 10, background: 'var(--bg-tertiary)', borderRadius: 8, alignItems: 'center' }}><div><strong>{s.current ? 'Este dispositivo' : 'Outro dispositivo'}</strong><div style={{ fontSize: '.75rem', color: 'var(--text-muted)' }}>{s.ipAddress || 'IP desconhecido'} · {new Date(s.lastSeenAt).toLocaleString('pt-BR')}</div><div style={{ fontSize: '.68rem', color: 'var(--text-muted)', maxWidth: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.userAgent}</div></div><button className="btn btn-secondary" onClick={() => revoke(s)}><LogOut size={14} /> Encerrar</button></div>)}</div></div></>}
  </div>;
}
