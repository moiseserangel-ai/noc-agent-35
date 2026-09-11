import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './styles/index.css';

class StartupErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('Falha ao iniciar o frontend do NOC Agent', error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main style={{ minHeight:'100vh', display:'grid', placeItems:'center', padding:24, background:'#07111f', color:'#e8f2ff', fontFamily:'Inter, sans-serif' }}>
        <section style={{ width:'min(620px, 100%)', padding:28, border:'1px solid #24415f', borderRadius:16, background:'#0d1b2a' }}>
          <h1 style={{ marginTop:0 }}>Não foi possível abrir o NOC Agent</h1>
          <p>O navegador encontrou um erro ao carregar a interface. Recarregue a página; se continuar, envie o código abaixo ao administrador.</p>
          <pre style={{ whiteSpace:'pre-wrap', overflowWrap:'anywhere', padding:14, borderRadius:8, background:'#07111f' }}>{String(this.state.error?.message || this.state.error)}</pre>
          <button onClick={() => window.location.reload()} style={{ padding:'10px 16px', border:0, borderRadius:8, cursor:'pointer' }}>Recarregar</button>
        </section>
      </main>
    );
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <StartupErrorBoundary><App /></StartupErrorBoundary>
  </React.StrictMode>
);
