import { useEffect, useState } from 'react';
import { Users as UsersIcon, Plus, Save, Trash2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { useToast } from '../contexts/ToastContext.jsx';

const empty = { username: '', name: '', password: '', role: 'operator', mustChangePassword: true };
const roleName = role => ({ admin: 'Administrador global', operator: 'Operador NOC', viewer: 'Visualização global', tenant_admin:'Administrador da empresa',tenant_operator:'Operador da empresa',tenant_viewer:'Visualização da empresa' }[role] || role);
const globalRoles=[['admin','Administrador global'],['operator','Operador NOC'],['viewer','Visualização global']],tenantRoles=[['tenant_admin','Administrador da empresa'],['tenant_operator','Operador da empresa'],['tenant_viewer','Visualização da empresa']];

export default function Users({user}) {
  const tenantScoped=Boolean(user?.tenantId);
  const [users, setUsers] = useState([]);
  const [tenants,setTenants]=useState([]);
  const [form, setForm] = useState({...empty,role:tenantScoped?'tenant_operator':'operator'});
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const load = () => api.getUsers().then(r => setUsers(r.data)).catch(e => toast(e.message, 'error'));
  useEffect(()=>{load();if(!tenantScoped)api.getTenants().then(result=>setTenants(result.data)).catch(()=>{});}, []);

  const create = async e => {
    e.preventDefault(); setBusy(true);
    try { await api.createUser(form); setForm({...empty,role:tenantScoped?'tenant_operator':'operator'}); await load(); toast('Usuário criado', 'success'); }
    catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  const update = async (id, data) => { try { await api.updateUser(id, data); await load(); toast('Usuário atualizado', 'success'); } catch (e) { toast(e.message, 'error'); } };
  const remove = async user => { if (!window.confirm(`Excluir o usuário ${user.username}?`)) return; try { await api.deleteUser(user.id); await load(); toast('Usuário excluído', 'success'); } catch (e) { toast(e.message, 'error'); } };

  return <div>
    <div className="page-header"><h2>Usuários e permissões</h2><p>Controle individual de acesso ao NOC Agent</p></div>
    <form className="card" onSubmit={create} style={{ marginBottom: 16 }}>
      <h3 style={{ marginBottom: 12 }}><Plus size={18} /> Novo usuário</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 10 }}>
        <input className="form-input" placeholder="Usuário" value={form.username} onChange={e => setForm({...form, username:e.target.value})} required />
        <input className="form-input" placeholder="Nome completo" value={form.name} onChange={e => setForm({...form, name:e.target.value})} required />
        <input className="form-input" type="password" placeholder="Senha forte temporária (mín. 10)" value={form.password} onChange={e => setForm({...form, password:e.target.value})} required minLength={10} />
        <select className="form-select" value={form.role} onChange={e => setForm({...form, role:e.target.value})}>{(tenantScoped||form.tenantId?tenantRoles:globalRoles).map(([value,label])=><option value={value} key={value}>{label}</option>)}</select>
        {!tenantScoped&&<select className="form-select" value={form.tenantId||''} onChange={e=>{const tenantId=e.target.value;setForm({...form,tenantId,role:tenantId?'tenant_operator':'operator'})}}><option value="">Equipe global do NOC</option>{tenants.map(item=><option key={item.id} value={item.id}>Cliente: {item.name}</option>)}</select>}
      </div>
      <button className="btn btn-primary" style={{ marginTop: 12 }} disabled={busy}><Plus size={15}/> Criar usuário</button>
    </form>
    <div className="card">
      <h3 style={{ marginBottom: 12 }}><UsersIcon size={18}/> Usuários cadastrados</h3>
      <div style={{ overflowX: 'auto' }}><table style={{ width:'100%', borderCollapse:'collapse' }}><thead><tr><th>Nome</th><th>Usuário</th><th>Escopo</th><th>Perfil</th><th>2FA</th><th>Estado</th><th>Último acesso</th><th>Ações</th></tr></thead><tbody>
        {users.map(u => <tr key={u.id} style={{ borderTop:'1px solid var(--border-primary)' }}><td style={{padding:10}}>{u.name}</td><td>{u.username}</td><td>{tenantScoped?'Minha empresa':<select className="form-select" value={u.tenantId||''} onChange={e=>{const tenantId=e.target.value||null;update(u.id,{tenantId,role:tenantId?'tenant_operator':'operator'})}}><option value="">NOC global</option>{tenants.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select>}</td><td><select className="form-select" style={{minWidth:180}} value={u.role} onChange={e => update(u.id,{role:e.target.value})}>{(u.tenantId?tenantRoles:globalRoles).map(([value,label])=><option value={value} key={value}>{label}</option>)}</select></td><td><span className={`badge ${u.twoFactorEnabled?'badge-success':'badge-warning'}`}>{u.twoFactorEnabled?'Ativo':'Inativo'}</span></td><td><button className={`btn ${u.isActive?'btn-success':'btn-secondary'}`} onClick={() => update(u.id,{isActive:!u.isActive})}>{u.isActive?'Ativo':'Inativo'}</button></td><td>{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString('pt-BR') : 'Nunca'}</td><td style={{display:'flex',gap:6,padding:10}}><button className="btn btn-secondary" onClick={() => { const password=window.prompt('Nova senha forte temporária (mínimo 10 caracteres):'); if(password) update(u.id,{password}); }}><Save size={14}/> Senha</button><button className="btn btn-secondary" onClick={() => remove(u)}><Trash2 size={14}/></button></td></tr>)}
      </tbody></table></div>
      <p style={{marginTop:12,fontSize:'.8rem',color:'var(--text-muted)'}}>Administrador da empresa: gerencia somente recursos e usuários da própria empresa. Operador: atende Tasks. Visualização: somente consultas.</p>
    </div>
  </div>;
}
