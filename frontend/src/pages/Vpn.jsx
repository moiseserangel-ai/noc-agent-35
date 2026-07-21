import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useToast } from '../App.jsx';

export default function Vpn() {
  const toast = useToast();
  const [form, setForm] = useState({ server: '', username: '', password: '', psk: '', status: '' });
  const load = () => api.getVpn().then(r => setForm(r.data)).catch(e => toast(e.message, 'error'));
  useEffect(load, []);
  const save = async () => { try { await api.saveVpn(form); toast('Perfil L2TP/IPsec salvo', 'success'); load(); } catch (e) { toast(e.message, 'error'); } };
  const action = async type => { try { const r = type === 'connect' ? await api.connectVpn() : await api.disconnectVpn(); toast(r.message, 'success'); setTimeout(load, 2000); } catch (e) { toast(e.message, 'error'); } };
  return <div><div className="page-header"><div><h2>VPN L2TP/IPsec</h2><p>Cliente para acesso seguro a redes MikroTik. Apenas um perfil ativo por CT.</p></div></div>
    <div className="card" style={{ maxWidth: 700 }}><div className="form-group"><label>Servidor MikroTik</label><input className="form-input" value={form.server || ''} onChange={e => setForm({...form, server:e.target.value})} placeholder="vpn.exemplo.com ou IP" /></div>
    <div className="form-group"><label>Usuário L2TP</label><input className="form-input" value={form.username || ''} onChange={e => setForm({...form, username:e.target.value})} /></div>
    <div className="form-group"><label>Senha</label><input type="password" className="form-input" value={form.password || ''} onChange={e => setForm({...form, password:e.target.value})} /></div>
    <div className="form-group"><label>IPsec PSK</label><input type="password" className="form-input" value={form.psk || ''} onChange={e => setForm({...form, psk:e.target.value})} /></div>
    <p><strong>Status:</strong> {form.status || 'desconhecido'}</p><div style={{display:'flex',gap:8}}><button className="btn btn-primary" onClick={save}>Salvar</button><button className="btn btn-success" onClick={() => action('connect')}>Conectar</button><button className="btn btn-danger" onClick={() => action('disconnect')}>Desconectar</button></div></div></div>;
}
