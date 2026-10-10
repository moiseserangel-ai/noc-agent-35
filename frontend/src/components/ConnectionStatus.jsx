import { useEffect, useState } from 'react';

export default function ConnectionStatus() {
  const [state, setState] = useState('checking');
  useEffect(() => {
    let disposed = false;
    let controller;
    const check = async () => {
      controller?.abort();
      const request = new AbortController();
      controller = request;
      const timeout = setTimeout(() => request.abort(), 8000);
      try {
        const response = await fetch('/api/health', { signal: request.signal, cache: 'no-store' });
        const data = await response.json();
        if (!disposed && controller === request) setState(response.ok && data.status === 'ok' ? 'online' : 'offline');
      } catch {
        if (!disposed && controller === request) setState('offline');
      } finally { clearTimeout(timeout); }
    };
    const offline = () => { controller?.abort(); setState('offline'); };
    const visible = () => { if (document.visibilityState === 'visible') check(); };
    check();
    const timer = setInterval(visible, 30000);
    window.addEventListener('online', check);
    window.addEventListener('offline', offline);
    document.addEventListener('visibilitychange', visible);
    return () => {
      disposed = true; controller?.abort(); clearInterval(timer);
      window.removeEventListener('online', check);
      window.removeEventListener('offline', offline);
      document.removeEventListener('visibilitychange', visible);
    };
  }, []);
  return <div className={`topbar-status connection-${state}`} role="status" title="Conexão com a API do NOC Agent; não representa a saúde de todos os equipamentos">
    <span className="status-pulse" />
    {state === 'online' ? 'NOC conectado' : state === 'offline' ? 'Sem conexão com o NOC' : 'Verificando conexão'}
  </div>;
}
