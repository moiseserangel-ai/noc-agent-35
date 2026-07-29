import { Fragment, useEffect, useRef, useState } from 'react';
import { BookOpen, CheckSquare, ChevronDown, ChevronRight, FileText, Link2, Pencil, Power, RefreshCw, Search, Square, Trash2, Upload, X } from 'lucide-react';
import { api } from '../lib/api.js';
import { useToast } from '../App.jsx';

const scopeLabel = {
  global: 'Todos os agentes',
  support: 'Agente de suporte',
  mikrotik: 'MikroTik RouterOS',
  linux: 'Linux',
  huawei_vrp: 'Huawei VRP / NetEngine',
  cisco_ios: 'Cisco IOS / IOS-XE',
  juniper_junos: 'Juniper Junos',
  fortigate_fortios: 'Fortinet FortiGate / FortiOS',
  ubiquiti_edgeos: 'Ubiquiti EdgeRouter / EdgeOS',
  unifi_controller: 'Ubiquiti UniFi Controller',
  datacom_dmos: 'Datacom DMOS',
  nokia_sros: 'Nokia SR OS',
};
const sourceLabel = { markdown: 'Markdown', text: 'Texto', pdf: 'PDF', url: 'Link HTTPS' };
const emptyForm = { id: null, title: '', filename: '', content: '', fileData: '', sourceType: 'markdown', sourceUrl: '', refreshUrl: false, crawlMode: false, agentScope: 'global', tags: '' };
const date = value => new Date(value).toLocaleString('pt-BR');

export default function Knowledge() {
  const [documents, setDocuments] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState({ query: '', agentScope: 'mikrotik' });
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [discovery, setDiscovery] = useState(null);
  const [discovering, setDiscovering] = useState(false);
  const [selectedPages, setSelectedPages] = useState([]);
  const [importJob, setImportJob] = useState(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [expandedCollections, setExpandedCollections] = useState([]);
  const fileRef = useRef();
  const toast = useToast();

  const load = async () => {
    setLoading(true);
    try { setDocuments((await api.getKnowledgeDocuments()).data); }
    catch (error) { toast(error.message, 'error'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (!importJob?.id || !['queued', 'running'].includes(importJob.status)) return;
    const timer = setInterval(async () => {
      try {
        const job = (await api.getKnowledgeImportJob(importJob.id)).data;
        setImportJob(job);
        if (!['queued', 'running'].includes(job.status)) {
          toast(`Importação concluída: ${job.imported} página(s), ${job.failed} erro(s).`, job.failed ? 'warning' : 'success');
          load();
        }
      } catch (error) { toast(error.message, 'error'); clearInterval(timer); }
    }, 1800);
    return () => clearInterval(timer);
  }, [importJob?.id, importJob?.status]);

  const chooseFile = async event => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const extension = file.name.split('.').pop()?.toLowerCase();
    const sourceType = extension === 'md' ? 'markdown' : extension === 'txt' ? 'text' : extension === 'pdf' ? 'pdf' : null;
    if (!sourceType) return toast('Selecione um arquivo .md, .txt ou .pdf.', 'error');
    const max = sourceType === 'pdf' ? 5 * 1024 * 1024 : 2 * 1024 * 1024;
    if (file.size > max) return toast(`O arquivo deve ter no máximo ${sourceType === 'pdf' ? 5 : 2} MB.`, 'error');
    const base = file.name.replace(/\.(md|txt|pdf)$/i, '').replace(/[-_]+/g, ' ');
    if (sourceType === 'pdf') {
      const fileData = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      setForm(current => ({ ...current, sourceType, filename: file.name, title: current.title || base, content: '', fileData }));
    } else {
      const content = await file.text();
      setForm(current => ({ ...current, sourceType, filename: file.name, title: current.title || base, content, fileData: '' }));
    }
  };

  const save = async event => {
    event.preventDefault();
    if (form.sourceType === 'url' && !form.sourceUrl.trim()) return toast('Informe um link HTTPS.', 'error');
    if (form.sourceType !== 'url' && !form.content && !form.fileData) return toast('Selecione um arquivo .md, .txt ou .pdf.', 'error');
    setSaving(true);
    try {
      if (form.id) await api.updateKnowledgeDocument(form.id, form);
      else await api.createKnowledgeDocument(form);
      toast(form.id ? 'Documento atualizado e reindexado.' : 'Documento indexado com sucesso.', 'success');
      setForm(emptyForm);
      await load();
    } catch (error) { toast(error.message, 'error'); }
    finally { setSaving(false); }
  };

  const edit = async id => {
    try {
      const item = (await api.getKnowledgeDocument(id)).data;
      setForm({ id: item.id, title: item.title, filename: item.filename, content: item.content, fileData: '', sourceType: item.sourceType || 'markdown', sourceUrl: item.sourceUrl || '', refreshUrl: false, crawlMode: false, agentScope: item.agentScope, tags: item.tags || '' });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) { toast(error.message, 'error'); }
  };

  const toggle = async item => {
    try {
      await api.setKnowledgeDocumentStatus(item.id, item.status === 'active' ? 'disabled' : 'active');
      toast(item.status === 'active' ? 'Documento desabilitado.' : 'Documento habilitado.', 'success');
      load();
    } catch (error) { toast(error.message, 'error'); }
  };

  const remove = async item => {
    if (!window.confirm(`Remover "${item.title}" da base de conhecimento?`)) return;
    try {
      await api.deleteKnowledgeDocument(item.id);
      toast('Documento removido.', 'success');
      if (form.id === item.id) setForm(emptyForm);
      load();
    } catch (error) { toast(error.message, 'error'); }
  };

  const testSearch = async event => {
    event.preventDefault();
    if (!search.query.trim()) return;
    setSearching(true);
    try { setResults((await api.testKnowledgeSearch(search.query, search.agentScope)).data); }
    catch (error) { toast(error.message, 'error'); }
    finally { setSearching(false); }
  };

  const discover = async () => {
    if (!form.sourceUrl.trim()) return toast('Informe a página inicial da seção.', 'error');
    setDiscovering(true);
    setDiscovery(null);
    try {
      const data = (await api.discoverKnowledgePages({ startUrl: form.sourceUrl, maxDepth: 2, maxPages: 50 })).data;
      setDiscovery(data);
      setSelectedPages(data.pages.map(page => page.url));
      setReviewOpen(false);
      toast(`${data.pages.length} página(s) relacionada(s) encontrada(s).`, 'success');
    } catch (error) { toast(error.message, 'error'); }
    finally { setDiscovering(false); }
  };

  const togglePage = url => setSelectedPages(current => current.includes(url) ? current.filter(item => item !== url) : [...current, url]);
  const startImport = async () => {
    if (!selectedPages.length) return toast('Selecione ao menos uma página.', 'error');
    try {
      const job = (await api.importKnowledgePages({ startUrl: discovery.startUrl, urls: selectedPages, agentScope: form.agentScope, tags: form.tags })).data;
      setImportJob(job);
      toast('Importação iniciada em segundo plano.', 'success');
    } catch (error) { toast(error.message, 'error'); }
  };

  const documentGroups = documents.reduce((groups, item) => {
    const key = item.collectionRootUrl ? `collection:${item.collectionRootUrl}` : `document:${item.id}`;
    if (!groups.has(key)) groups.set(key, { key, rootUrl: item.collectionRootUrl, documents: [] });
    groups.get(key).documents.push(item);
    return groups;
  }, new Map());
  const groupedDocuments = [...documentGroups.values()];
  const toggleCollection = key => setExpandedCollections(current => current.includes(key) ? current.filter(item => item !== key) : [...current, key]);

  return <div>
    <div className="page-header page-header-actions">
      <div><h2>Base de conhecimento</h2><p>Documentação Markdown consultada pelos agentes antes de responder, diagnosticar ou propor configurações</p></div>
      <button className="btn btn-secondary" onClick={load}><RefreshCw size={15}/> Atualizar</button>
    </div>

    <div className="knowledge-summary">
      <div className="stat-card"><div className="stat-icon"><BookOpen size={20}/></div><div><div className="stat-value">{documents.length}</div><div className="stat-label">Documentos</div></div></div>
      <div className="stat-card"><div className="stat-icon"><FileText size={20}/></div><div><div className="stat-value">{documents.reduce((total, item) => total + item.chunkCount, 0)}</div><div className="stat-label">Trechos indexados</div></div></div>
      <div className="knowledge-safety"><strong>Proteção ativa</strong><span>Documentos servem como referência e não podem autorizar comandos nem contornar aprovação humana.</span></div>
    </div>

    <div className="knowledge-grid">
      <form className="card knowledge-editor" onSubmit={save}>
        <div className="card-header"><div><h3>{form.id ? 'Editar fonte' : 'Adicionar conhecimento'}</h3><p>MD/TXT até 2 MB · PDF até 5 MB · páginas HTTPS</p></div>{form.id && <button type="button" className="btn btn-ghost" onClick={()=>setForm(emptyForm)}><X size={16}/></button>}</div>
        <div className="knowledge-source-tabs">
          <button type="button" className={form.sourceType!=='url'?'active':''} onClick={()=>setForm({...emptyForm,agentScope:form.agentScope,tags:form.tags})}><Upload size={15}/> Arquivo</button>
          <button type="button" className={form.sourceType==='url'?'active':''} onClick={()=>setForm({...emptyForm,sourceType:'url',agentScope:form.agentScope,tags:form.tags})}><BookOpen size={15}/> Link HTTPS</button>
        </div>
        {form.sourceType === 'url' ? <>
          <div className="form-group"><label className="form-label">Endereço da página</label><input className="form-input" type="url" required placeholder="https://documentacao.exemplo.com/guia" value={form.sourceUrl} onChange={e=>setForm({...form,sourceUrl:e.target.value})}/></div>
          {form.id && <label className="knowledge-refresh"><input type="checkbox" checked={form.refreshUrl} onChange={e=>setForm({...form,refreshUrl:e.target.checked})}/><span>Baixar novamente e atualizar o conteúdo desta página</span></label>}
          {!form.id && <label className="knowledge-refresh"><input type="checkbox" checked={form.crawlMode} onChange={e=>{setForm({...form,crawlMode:e.target.checked});setDiscovery(null);setSelectedPages([]);}}/><span>Descobrir links relacionados (profundidade 2, até 50 páginas)</span></label>}
        </> : <>
          <input ref={fileRef} type="file" accept=".md,.txt,.pdf,text/markdown,text/plain,application/pdf" hidden onChange={chooseFile}/>
          <button type="button" className={`knowledge-dropzone ${form.filename ? 'selected' : ''}`} onClick={()=>fileRef.current?.click()}>
            <Upload size={24}/><strong>{form.filename || 'Selecionar MD, TXT ou PDF'}</strong><span>{form.filename ? 'Clique para substituir o conteúdo' : 'PDFs digitalizados sem texto pesquisável precisam de OCR'}</span>
          </button>
        </>}
        {!form.crawlMode && <div className="form-group"><label className="form-label">Título {form.sourceType==='url'&&'(opcional)'}</label><input className="form-input" required={form.sourceType!=='url'} maxLength="180" value={form.title} onChange={e=>setForm({...form,title:e.target.value})}/></div>}
        <div className="form-group"><label className="form-label">Especialista</label><select className="form-select" value={form.agentScope} onChange={e=>setForm({...form,agentScope:e.target.value})}>{Object.entries(scopeLabel).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></div>
        <div className="form-group"><label className="form-label">Tags</label><input className="form-input" placeholder="Ex.: bgp, firewall, ne8000, routeros-v7" maxLength="500" value={form.tags} onChange={e=>setForm({...form,tags:e.target.value})}/></div>
        {(form.content || form.fileData || form.sourceUrl) && <div className="knowledge-file-preview"><FileText size={15}/><span>{form.sourceType==='url' ? 'A página será baixada com proteção de rede' : form.sourceType==='pdf' ? 'PDF pronto para extração de texto' : `${form.content.length.toLocaleString('pt-BR')} caracteres carregados`}</span></div>}
        {form.crawlMode
          ? <button type="button" className="btn btn-primary" disabled={discovering} onClick={discover}>{discovering ? <><RefreshCw className="spin" size={16}/> Procurando páginas...</> : <><Search size={16}/> Descobrir páginas relacionadas</>}</button>
          : <button className="btn btn-primary" disabled={saving}>{saving ? <><span className="spinner spinner-sm"/> Indexando...</> : <><Upload size={16}/>{form.id ? 'Salvar e reindexar' : 'Importar e indexar'}</>}</button>}
      </form>

      <div className="card">
        <div className="card-header"><div><h3>Testar recuperação</h3><p>Confira exatamente quais trechos um especialista encontrará</p></div></div>
        <form className="knowledge-search" onSubmit={testSearch}>
          <select className="form-select" value={search.agentScope} onChange={e=>setSearch({...search,agentScope:e.target.value})}>{Object.entries(scopeLabel).filter(([key])=>key!=='global').map(([value,label])=><option key={value} value={value}>{label}</option>)}</select>
          <div><input className="form-input" placeholder="Ex.: como configurar peer BGP no NE8000?" value={search.query} onChange={e=>setSearch({...search,query:e.target.value})}/><button className="btn btn-primary" disabled={searching}><Search size={16}/></button></div>
        </form>
        <div className="knowledge-results">
          {!results.length && <div className="empty-state"><Search size={28}/><p>Faça uma pergunta para validar a indexação.</p></div>}
          {results.map((item,index)=><article key={item.id}><header><strong>#{index+1} {item.document.title}</strong><span>Relevância {item.score}</span></header><small>{item.heading} · {scopeLabel[item.document.agentScope]}</small><p>{item.content}</p></article>)}
        </div>
      </div>
    </div>

    {(discovery || importJob) && <div className="card knowledge-crawl-card">
      <div className="card-header"><div><h3>Importação de seção</h3><p>Revise as páginas relacionadas antes de adicioná-las à base</p></div></div>
      {importJob ? <div className="knowledge-job">
        <div><RefreshCw className={['queued','running'].includes(importJob.status)?'spin':''} size={22}/><div><strong>{['queued','running'].includes(importJob.status)?'Importando documentação...':'Importação finalizada'}</strong><span>{importJob.processed || 0} de {importJob.totalPages} páginas · {importJob.imported || 0} importadas · {importJob.failed || 0} erros</span></div></div>
        <div className="knowledge-progress"><span style={{width:`${Math.round(((importJob.processed||0)/Math.max(importJob.totalPages,1))*100)}%`}}/></div>
        {importJob.currentUrl&&<small>{importJob.currentUrl}</small>}
        {importJob.errors?.length>0&&<div className="knowledge-job-errors">{importJob.errors.map((item,index)=><span key={index}>{item.url}: {item.error}</span>)}</div>}
      </div> : <>
        <div className="knowledge-crawl-overview">
          <div className="knowledge-crawl-count"><div><Link2 size={22}/></div><section><strong>{discovery.pages.length} páginas relacionadas</strong><span>{selectedPages.length} selecionadas para importação</span></section></div>
          <div className="knowledge-crawl-badges">{discovery.truncated&&<span>Limite de descoberta atingido</span>}{discovery.errors.length>0&&<span>{discovery.errors.length} páginas ignoradas</span>}</div>
          <div className="knowledge-crawl-actions"><button className="btn btn-secondary" onClick={()=>setReviewOpen(value=>!value)}>{reviewOpen?<X size={15}/>:<CheckSquare size={15}/>} {reviewOpen?'Fechar revisão':'Revisar páginas'}</button><button className="btn btn-primary" disabled={!selectedPages.length} onClick={startImport}><Upload size={16}/> Importar {selectedPages.length} página(s)</button></div>
        </div>
        {reviewOpen && <div className="knowledge-review">
          <div className="knowledge-review-toolbar"><span>Selecione somente o conteúdo que deseja disponibilizar aos agentes.</span><button className="btn btn-ghost btn-sm" onClick={()=>setSelectedPages(selectedPages.length===discovery.pages.length?[]:discovery.pages.map(page=>page.url))}>{selectedPages.length===discovery.pages.length?<Square size={15}/>:<CheckSquare size={15}/>} {selectedPages.length===discovery.pages.length?'Desmarcar todas':'Selecionar todas'}</button></div>
          <div className="knowledge-page-list">{discovery.pages.map(page=><label key={page.url}><input type="checkbox" checked={selectedPages.includes(page.url)} onChange={()=>togglePage(page.url)}/><div><strong>{page.title}</strong><span>{page.url}</span></div><small>Nível {page.depth}{page.characters ? ` · ${page.characters.toLocaleString('pt-BR')} caracteres` : ' · Catálogo oficial'}</small></label>)}</div>
        </div>}
      </>}
    </div>}

    <div className="card" style={{marginTop:16}}>
      <div className="card-header"><div><h3>Documentos indexados</h3><p>Ative, edite ou remova o conhecimento disponível aos agentes</p></div></div>
      {loading ? <div className="loading-screen" style={{minHeight:180}}><div className="spinner"/></div> :
      <div className="table-container"><table><thead><tr><th>Documento</th><th>Especialista</th><th>Indexação</th><th>Responsável</th><th>Status</th><th></th></tr></thead><tbody>
        {groupedDocuments.map(group => {
          if (!group.rootUrl) {
            const item = group.documents[0];
            return <tr key={item.id}><td><strong>{item.title}</strong><br/><span className="knowledge-muted">{sourceLabel[item.sourceType] || 'Markdown'} · {item.sourceUrl || item.filename}{item.tags ? ` · ${item.tags}` : ''}</span></td><td>{scopeLabel[item.agentScope] || item.agentScope}</td><td>{item.chunkCount} trechos<br/><span className="knowledge-muted">{date(item.updatedAt)}</span></td><td>{item.uploadedBy}</td><td><span className={`status-badge ${item.status==='active'?'status-completed':'status-pending'}`}>{item.status==='active'?'Ativo':'Desabilitado'}</span></td><td><div className="table-actions"><button className="btn btn-ghost btn-sm" title="Editar" onClick={()=>edit(item.id)}><Pencil size={15}/></button><button className="btn btn-ghost btn-sm" title={item.status==='active'?'Desabilitar':'Habilitar'} onClick={()=>toggle(item)}><Power size={15}/></button><button className="btn btn-ghost btn-sm" title="Excluir" onClick={()=>remove(item)}><Trash2 size={15}/></button></div></td></tr>;
          }
          const expanded = expandedCollections.includes(group.key);
          const root = group.documents.find(item => item.sourceUrl === group.rootUrl) || group.documents[0];
          const chunks = group.documents.reduce((total, item) => total + item.chunkCount, 0);
          const active = group.documents.filter(item => item.status === 'active').length;
          return <Fragment key={group.key}>
            <tr className="knowledge-collection-row" onClick={()=>toggleCollection(group.key)}>
              <td><div className="knowledge-collection-title">{expanded?<ChevronDown size={17}/>:<ChevronRight size={17}/>}<div><strong>{root.title}</strong><span>{group.rootUrl}</span></div></div></td>
              <td>{scopeLabel[root.agentScope] || root.agentScope}</td>
              <td><strong>{group.documents.length} páginas</strong><br/><span className="knowledge-muted">{chunks} trechos</span></td>
              <td>{root.uploadedBy}</td>
              <td><span className={`status-badge ${active?'status-completed':'status-pending'}`}>{active} de {group.documents.length} ativas</span></td>
              <td><button className="btn btn-ghost btn-sm" aria-label={expanded?'Recolher coleção':'Expandir coleção'}>{expanded?<ChevronDown size={16}/>:<ChevronRight size={16}/>}</button></td>
            </tr>
            {expanded && group.documents.map(item=><tr key={item.id} className="knowledge-collection-child"><td><strong>{item.title}</strong><br/><span className="knowledge-muted">{item.sourceUrl}</span></td><td>{scopeLabel[item.agentScope] || item.agentScope}</td><td>{item.chunkCount} trechos<br/><span className="knowledge-muted">{date(item.updatedAt)}</span></td><td>{item.uploadedBy}</td><td><span className={`status-badge ${item.status==='active'?'status-completed':'status-pending'}`}>{item.status==='active'?'Ativo':'Desabilitado'}</span></td><td><div className="table-actions"><button className="btn btn-ghost btn-sm" title="Editar" onClick={()=>edit(item.id)}><Pencil size={15}/></button><button className="btn btn-ghost btn-sm" title={item.status==='active'?'Desabilitar':'Habilitar'} onClick={()=>toggle(item)}><Power size={15}/></button><button className="btn btn-ghost btn-sm" title="Excluir" onClick={()=>remove(item)}><Trash2 size={15}/></button></div></td></tr>)}
          </Fragment>;
        })}
        {!documents.length&&<tr><td colSpan="6"><div className="empty-state"><BookOpen size={30}/><p>Nenhum documento foi adicionado.</p></div></td></tr>}
      </tbody></table></div>}
    </div>
  </div>;
}
