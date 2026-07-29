import { useState, useEffect } from 'react';
import { Plus, Trash2, Wifi, Edit2, Server, History } from 'lucide-react';
import { api } from '../lib/api.js';
import { useToast } from '../App.jsx';
import { TypeBadge } from '../components/StatusBadge.jsx';
import Modal from '../components/Modal.jsx';

const EMPTY_DEVICE = { name: '', hostname: '', port: 22, type: 'mikrotik', username: '', password: '', group: '', zabbixHostId: '', notes: '', manufacturer: 'MikroTik', platform: 'RouterOS', model: '', osVersion: '', capabilities: '' };
const TYPE_DEFAULTS = { mikrotik: { manufacturer:'MikroTik',platform:'RouterOS',port:22 }, linux:{manufacturer:'Comunidade',platform:'Linux',port:22}, huawei_vrp:{manufacturer:'Huawei',platform:'VRP',port:22}, cisco_ios:{manufacturer:'Cisco',platform:'IOS-XE',port:22}, juniper_junos:{manufacturer:'Juniper',platform:'Junos',port:22}, fortigate_fortios:{manufacturer:'Fortinet',platform:'FortiOS',port:22}, ubiquiti_edgeos:{manufacturer:'Ubiquiti',platform:'EdgeOS',port:22}, unifi_controller:{manufacturer:'Ubiquiti',platform:'UniFi OS',port:443}, datacom_dmos:{manufacturer:'Datacom',platform:'DMOS',port:22}, nokia_sros:{manufacturer:'Nokia',platform:'SR OS',port:22} };

export default function Devices({ canManage = false }) {
  const [devices, setDevices] = useState([]);
  const [deviceTypes, setDeviceTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editDevice, setEditDevice] = useState(null);
  const [form, setForm] = useState({ ...EMPTY_DEVICE });
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(null);
  const [historyDevice, setHistoryDevice] = useState(null);
  const [changes, setChanges] = useState([]);
  const toast = useToast();

  const load = () => {
    api.getDevices().then(r => setDevices(r.data)).catch(() => {}).finally(() => setLoading(false));
  };

  useEffect(() => { load(); api.getDeviceTypes().then(r=>setDeviceTypes(r.data)).catch(()=>{}); }, []);

  const openNew = () => { setEditDevice(null); setForm({ ...EMPTY_DEVICE }); setModalOpen(true); };
  const openEdit = (d) => { setEditDevice(d); setForm({ ...d, password: '' }); setModalOpen(true); };

  const handleSave = async () => {
    if (!form.name || !form.hostname || !form.username || (!editDevice && !form.password)) {
      toast('Preencha todos os campos obrigatórios', 'error');
      return;
    }
    setSaving(true);
    try {
      const data = { ...form };
      if (editDevice && !data.password) delete data.password;
      if (editDevice) {
        await api.updateDevice(editDevice.id, data);
        toast('Dispositivo atualizado', 'success');
      } else {
        await api.createDevice(data);
        toast('Dispositivo criado', 'success');
      }
      setModalOpen(false);
      load();
    } catch (err) {
      toast(err.message, 'error');
    } finally { setSaving(false); }
  };

  const handleDelete = async (id, name) => {
    if (!confirm(`Excluir "${name}"?`)) return;
    try {
      await api.deleteDevice(id);
      toast('Dispositivo excluído', 'success');
      load();
    } catch (err) { toast(err.message, 'error'); }
  };

  const handleTest = async (id) => {
    setTesting(id);
    try {
      const r = await api.testDevice(id);
      toast(r.success ? `✅ ${r.message || 'Conexão OK!'}` : `❌ ${r.error}`, r.success ? 'success' : 'error');
    } catch (err) { toast(`❌ ${err.message}`, 'error'); }
    finally { setTesting(null); }
  };

  const updateField = (field, value) => setForm(f => ({ ...f, [field]: value }));
  const openHistory = async device => { setHistoryDevice(device); setChanges([]); try { setChanges((await api.getDeviceChanges(device.id)).data); } catch(error) { toast(error.message,'error'); } };

  if (loading) return <div className="loading-screen"><div className="spinner" /></div>;

  return (
    <div>
      <div className="page-header page-header-actions">
        <div>
          <h2>Equipamentos</h2>
          <p>Gerencie seus dispositivos de rede</p>
        </div>
        {canManage && <button className="btn btn-primary" onClick={openNew}><Plus size={16} /> Adicionar</button>}
      </div>

      {devices.length === 0 ? (
        <div className="card"><div className="empty-state">
          <Server size={48} />
          <p>Nenhum dispositivo cadastrado.<br />Clique em "Adicionar" para começar.</p>
        </div></div>
      ) : (
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Nome</th>
                <th>Host/IP</th>
                <th>Tipo</th>
                <th>Porta</th>
                <th>Grupo</th>
                {canManage && <th>Ações</th>}
              </tr>
            </thead>
            <tbody>
              {devices.map(d => (
                <tr key={d.id}>
                  <td style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{d.name}</td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>{d.hostname}</td>
                  <td><TypeBadge type={d.type} /></td>
                  <td>{d.port}</td>
                  <td>{d.group || '—'}</td>
                  {canManage && <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button className="btn btn-ghost btn-sm" onClick={() => handleTest(d.id)} disabled={testing === d.id}>
                        {testing === d.id ? <div className="spinner" /> : <Wifi size={14} />}
                      </button>
                      <button className="btn btn-ghost btn-sm" onClick={() => openEdit(d)}><Edit2 size={14} /></button>
                      <button className="btn btn-ghost btn-sm" title="Histórico de alterações" onClick={() => openHistory(d)}><History size={14} /></button>
                      <button className="btn btn-ghost btn-sm" onClick={() => handleDelete(d.id, d.name)} style={{ color: 'var(--danger)' }}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canManage && <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editDevice ? 'Editar Dispositivo' : 'Novo Dispositivo'}
        footer={<>
          <button className="btn btn-secondary" onClick={() => setModalOpen(false)}>Cancelar</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? <><div className="spinner" /> Salvando...</> : 'Salvar'}
          </button>
        </>}
      >
        <div className="form-group">
          <label className="form-label">Nome *</label>
          <input className="form-input" value={form.name} onChange={e => updateField('name', e.target.value)} placeholder="Ex: Router Core 01" />
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Hostname / IP *</label>
            <input className="form-input" value={form.hostname} onChange={e => updateField('hostname', e.target.value)} placeholder="192.168.1.1" />
          </div>
          <div className="form-group">
            <label className="form-label">{form.type==='unifi_controller'?'Porta HTTPS':'Porta SSH'}</label>
            <input className="form-input" type="number" value={form.port} onChange={e => updateField('port', parseInt(e.target.value) || 22)} />
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Tipo *</label>
          <select className="form-select" value={form.type} onChange={e => { const type=e.target.value; setForm(f=>({...f,type,...TYPE_DEFAULTS[type]})); }}>
            {(deviceTypes.length ? deviceTypes : [{type:'mikrotik',label:'MikroTik RouterOS'},{type:'linux',label:'Linux'},{type:'huawei_vrp',label:'Huawei VRP / NetEngine'},{type:'cisco_ios',label:'Cisco IOS / IOS-XE'},{type:'juniper_junos',label:'Juniper Junos'},{type:'fortigate_fortios',label:'Fortinet FortiGate / FortiOS'}]).map(item=><option key={item.type} value={item.type}>{item.label}</option>)}
          </select>
        </div>
        <div className="form-row">
          <div className="form-group"><label className="form-label">Fabricante</label><input className="form-input" value={form.manufacturer || ''} onChange={e=>updateField('manufacturer',e.target.value)} placeholder="Huawei" /></div>
          <div className="form-group"><label className="form-label">Plataforma</label><input className="form-input" value={form.platform || ''} onChange={e=>updateField('platform',e.target.value)} placeholder="VRP" /></div>
        </div>
        <div className="form-row">
          <div className="form-group"><label className="form-label">Modelo</label><input className="form-input" value={form.model || ''} onChange={e=>updateField('model',e.target.value)} placeholder="NE8000 M8" /></div>
          <div className="form-group"><label className="form-label">Versão do sistema</label><input className="form-input" value={form.osVersion || ''} onChange={e=>updateField('osVersion',e.target.value)} placeholder="V800R023..." /></div>
        </div>
        <div className="form-group"><label className="form-label">Capacidades</label><input className="form-input" value={form.capabilities || ''} onChange={e=>updateField('capabilities',e.target.value)} placeholder="bgp,isis,mpls,l2vpn,evpn" /><small style={{color:'var(--text-muted)'}}>Separe as tecnologias por vírgula.</small></div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Usuário SSH *</label>
            <input className="form-input" value={form.username} onChange={e => updateField('username', e.target.value)} placeholder="admin" />
          </div>
          <div className="form-group">
            <label className="form-label">Senha SSH {editDevice ? '' : '*'}</label>
            <input className="form-input" type="password" value={form.password} onChange={e => updateField('password', e.target.value)}
              placeholder={editDevice ? '(manter atual)' : ''} />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Grupo</label>
            <input className="form-input" value={form.group} onChange={e => updateField('group', e.target.value)} placeholder="Core / Borda / Acesso" />
          </div>
          <div className="form-group">
            <label className="form-label">Zabbix Host ID</label>
            <input className="form-input" value={form.zabbixHostId} onChange={e => updateField('zabbixHostId', e.target.value)} placeholder="ID do host no Zabbix" />
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Notas</label>
          <textarea className="form-textarea" value={form.notes} onChange={e => updateField('notes', e.target.value)} placeholder="Observações sobre o equipamento..." />
        </div>
      </Modal>}
      <Modal isOpen={Boolean(historyDevice)} onClose={()=>setHistoryDevice(null)} title={`Alterações — ${historyDevice?.name || ''}`} footer={<button className="btn btn-secondary" onClick={()=>setHistoryDevice(null)}>Fechar</button>}>
        <div style={{display:'flex',flexDirection:'column',gap:10,maxHeight:'55vh',overflowY:'auto'}}>{changes.map(change=><div key={change.id} style={{padding:12,border:'1px solid var(--border-primary)',borderRadius:8}}><strong>{change.taskNumber?`#TASK-${change.taskNumber}`:'Alteração'}</strong><div style={{margin:'4px 0'}}>{change.comment}</div><small style={{color:'var(--text-muted)'}}>{new Date(change.createdAt).toLocaleString('pt-BR')} · {change.agentName} · {change.nativeAudit || 'histórico NOC'}</small></div>)}{!changes.length&&<span style={{color:'var(--text-muted)'}}>Nenhuma alteração comentada registrada.</span>}</div>
      </Modal>
    </div>
  );
}
