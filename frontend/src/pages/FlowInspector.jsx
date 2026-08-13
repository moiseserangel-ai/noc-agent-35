import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Database,
  Filter,
  RefreshCw,
  Search,
  Shield,
  TrafficCone,
  TrendingUp,
  X,
} from "lucide-react";
import { api } from "../lib/api.js";
import { useToast } from "../contexts/ToastContext.jsx";
import "../styles/flow-inspector.css";
import "../styles/flow-review.css";

const size = (value) => {
  const n = Number(value) || 0;
  return n >= 1e9
    ? `${(n / 1e9).toFixed(2)} GB`
    : n >= 1e6
      ? `${(n / 1e6).toFixed(2)} MB`
      : n >= 1e3
        ? `${(n / 1e3).toFixed(1)} KB`
        : `${n} B`;
};
const integer = (value) => Number(value || 0).toLocaleString("pt-BR");
const identityLabel = (value) =>
  value?.name
    ? `${value.name}${value.type ? ` · ${value.type}` : ""}${value.owner ? ` · ${value.owner}` : ""}`
    : "";

function NotificationHistory({ rows, onRetry, busy, isAdmin }) {
  return (
    <section className="card flow-notification-history">
      <header className="flow-section-title">
        <div>
          <span className="flow-kicker">Entregas auditáveis</span>
          <h3>Histórico de notificações</h3>
        </div>
        <small>
          {rows.filter((row) => row.status === "failed").length} falha(s) nas
          últimas entregas
        </small>
      </header>
      <div className="flow-report-table">
        <table>
          <thead>
            <tr>
              <th>Data</th>
              <th>Evento</th>
              <th>Canal</th>
              <th>Destinatário</th>
              <th>Status</th>
              <th>Detalhes</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{new Date(row.createdAt).toLocaleString("pt-BR")}</td>
                <td>{row.title || row.event}</td>
                <td>{row.channel}</td>
                <td>{row.recipient || "Painel/global"}</td>
                <td>
                  <span className={`flow-delivery ${row.status}`}>
                    {row.status === "sent" ? "Entregue" : "Falhou"}
                  </span>
                </td>
                <td title={row.error || row.message || ""}>
                  {row.error
                    ? "Falha no envio"
                    : row.message?.slice(0, 80) || "—"}
                </td>
                <td>
                  {isAdmin &&
                    ["telegram", "whatsapp"].includes(row.channel) && (
                      <button
                        className="btn btn-ghost btn-sm"
                        disabled={busy}
                        onClick={() => onRetry(row)}
                      >
                        Reenviar
                      </button>
                    )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && (
          <div className="empty-state">
            <Shield />
            <p>Ainda não há entregas vinculadas ao NetFlow.</p>
          </div>
        )}
      </div>
    </section>
  );
}

function IntegrationAdmin({
  config,
  setConfig,
  password,
  setPassword,
  onSave,
  onTest,
  onRotate,
  busy,
  isAdmin,
  exporters,
}) {
  if (!isAdmin) return null;
  return (
    <section className="card flow-integration">
      <header className="flow-section-title">
        <div>
          <span className="flow-kicker">Administração</span>
          <h3>Integração NetFlow/IPFIX</h3>
        </div>
        <small>
          {config?.passwordConfigured
            ? "Credencial configurada"
            : "Credencial ausente"}
        </small>
      </header>
      <div className="flow-integration-grid">
        <label>
          <span>URL do ClickHouse</span>
          <input
            value={config?.url || ""}
            onChange={(e) => setConfig((v) => ({ ...v, url: e.target.value }))}
          />
        </label>
        <label>
          <span>Usuário de consulta</span>
          <input
            value={config?.user || ""}
            onChange={(e) => setConfig((v) => ({ ...v, user: e.target.value }))}
          />
        </label>
        <label>
          <span>IP do coletor</span>
          <input value={config?.collectorAddress || ""} disabled />
        </label>
        <label>
          <span>Porta NetFlow/IPFIX</span>
          <input value={config?.collectorPort || 2055} disabled />
        </label>
      </div>
      <div className="flow-profile-actions">
        <button className="btn btn-secondary" disabled={busy} onClick={onTest}>
          Testar conexão
        </button>
        <button className="btn btn-primary" disabled={busy} onClick={onSave}>
          Salvar integração
        </button>
      </div>
      <div className="flow-password-rotate">
        <label>
          <span>Nova senha do usuário ClickHouse</span>
          <input
            type="password"
            minLength="16"
            autoComplete="new-password"
            placeholder="Mínimo de 16 caracteres"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <button
          className="btn btn-danger"
          disabled={busy || password.length < 16}
          onClick={onRotate}
        >
          Trocar senha nos dois serviços
        </button>
        <small>
          A senha atual nunca é exibida. A rotação altera primeiro o coletor,
          valida a conexão e depois atualiza o segredo criptografado do NOC
          Agent.
        </small>
      </div>
      <div className="flow-discovered">
        <strong>Exportadores descobertos ({exporters.length})</strong>
        {exporters.map((row) => (
          <span key={row.exporterName}>
            {row.exporterName} · {row.exporterAddress}
          </span>
        ))}
        <small>
          Para adicionar outro dispositivo, configure nele o envio para{" "}
          {config?.collectorAddress || "o coletor"}:
          {config?.collectorPort || 2055}. Ele aparecerá automaticamente após o
          primeiro fluxo.
        </small>
      </div>
    </section>
  );
}

function RecurrenceControl({ minutes, setMinutes, onSave, busy, isAdmin }) {
  return (
    <section className="card flow-recurrence">
      <header className="flow-section-title">
        <div>
          <span className="flow-kicker">Antirruído</span>
          <h3>Controle de recorrência</h3>
        </div>
        <small>Evita Tasks repetidas para o mesmo evento.</small>
      </header>
      <div className="flow-recurrence-body">
        <label>
          <span>Intervalo global após a ocorrência anterior</span>
          <select
            disabled={!isAdmin}
            value={minutes}
            onChange={(event) => setMinutes(event.target.value)}
          >
            <option value="15">15 minutos</option>
            <option value="30">30 minutos</option>
            <option value="60">1 hora</option>
            <option value="180">3 horas</option>
            <option value="360">6 horas</option>
            <option value="720">12 horas</option>
            <option value="1440">24 horas</option>
            <option value="10080">7 dias</option>
          </select>
        </label>
        {isAdmin && (
          <button className="btn btn-primary" disabled={busy} onClick={onSave}>
            Salvar intervalo
          </button>
        )}
        <p>
          A recorrência permanece registrada na anomalia e na linha do tempo da
          Task anterior, sem gerar nova Task ou notificação.
        </p>
      </div>
    </section>
  );
}

function ExporterHealth({ rows, config, setConfig, onSave, busy, isAdmin }) {
  const labels = {
    online: "Online",
    delayed: "Atrasado",
    offline: "Sem comunicação",
  };
  return (
    <section className="card flow-health">
      <header className="flow-section-title">
        <div>
          <span className="flow-kicker">Telemetria</span>
          <h3>Saúde dos exportadores</h3>
        </div>
        <small>
          {rows.filter((row) => row.status === "online").length}/{rows.length}{" "}
          enviando fluxos
        </small>
      </header>
      <div className="flow-health-list">
        {rows.map((row) => (
          <article key={row.exporterName} className={row.status}>
            <i />
            <div>
              <strong>{row.exporterName}</strong>
              <span>
                {row.exporterAddress || "Endereço não informado"} · última
                coleta {new Date(row.lastSeenAt).toLocaleString("pt-BR")}
              </span>
            </div>
            <b>{labels[row.status]}</b>
          </article>
        ))}
      </div>
      {isAdmin && (
        <div className="flow-health-config">
          <label>
            <input
              type="checkbox"
              checked={config.enabled}
              onChange={(e) =>
                setConfig((v) => ({ ...v, enabled: e.target.checked }))
              }
            />{" "}
            Monitoramento ativo
          </label>
          <label>
            <span>Considerar offline após</span>
            <select
              value={config.timeoutMinutes}
              onChange={(e) =>
                setConfig((v) => ({ ...v, timeoutMinutes: e.target.value }))
              }
            >
              <option value="10">10 minutos</option>
              <option value="15">15 minutos</option>
              <option value="30">30 minutos</option>
              <option value="60">1 hora</option>
              <option value="180">3 horas</option>
            </select>
          </label>
          <label>
            <span>Ação</span>
            <select
              value={config.notificationMode}
              onChange={(e) =>
                setConfig((v) => ({ ...v, notificationMode: e.target.value }))
              }
            >
              <option value="panel">Somente painel</option>
              <option value="task">Criar Task</option>
              <option value="task_telegram">Task + Telegram</option>
            </select>
          </label>
          <button className="btn btn-primary" disabled={busy} onClick={onSave}>
            Salvar monitoramento
          </button>
        </div>
      )}
    </section>
  );
}

function RetentionPolicy({ data, setData, onSave, onExecute, busy, isAdmin }) {
  if (!data) return null;
  const fields = [
    ["metricsDays", "Métricas e gráficos", "metrics"],
    ["anomaliesDays", "Anomalias resolvidas", "anomalies"],
    ["notificationsDays", "Notificações", "notifications"],
    ["silencesDays", "Silenciamentos encerrados", "silences"],
    ["rawFlowsDays", "Fluxos brutos", "rawFlows"],
  ];
  return (
    <section className="card flow-retention">
      <header className="flow-section-title">
        <div>
          <span className="flow-kicker">Armazenamento</span>
          <h3>Retenção automática</h3>
        </div>
        <small>Limpeza automática uma vez ao dia.</small>
      </header>
      <div className="flow-retention-grid">
        {fields.map(([key, label, countKey]) => (
          <label key={key}>
            <span>{label}</span>
            <input
              type="number"
              disabled={!isAdmin}
              min={key === "rawFlowsDays" ? 1 : key === "metricsDays" ? 7 : 30}
              value={data.policy[key]}
              onChange={(e) =>
                setData((v) => ({
                  ...v,
                  policy: { ...v.policy, [key]: e.target.value },
                }))
              }
            />
            <small>dias · {integer(data.counts[countKey])} elegível(is)</small>
          </label>
        ))}
      </div>
      {isAdmin && (
        <div className="flow-profile-actions">
          <button className="btn btn-primary" disabled={busy} onClick={onSave}>
            Salvar política
          </button>
          <button
            className="btn btn-secondary"
            disabled={busy || !Object.values(data.counts).some(Number)}
            onClick={onExecute}
          >
            Executar limpeza agora
          </button>
        </div>
      )}
    </section>
  );
}

function SilenceWindows({
  rows,
  form,
  setForm,
  onSave,
  onDelete,
  busy,
  isAdmin,
  exporters,
  rules,
}) {
  const now = Date.now(),
    status = (row) =>
      new Date(row.endsAt) < now
        ? "Encerrada"
        : new Date(row.startsAt) > now
          ? "Programada"
          : "Ativa";
  return (
    <section className="card flow-silences">
      <header className="flow-section-title">
        <div>
          <span className="flow-kicker">Manutenção controlada</span>
          <h3>Silenciamento programado</h3>
        </div>
        <small>A detecção fica registrada, sem Task ou mensagem externa.</small>
      </header>
      {isAdmin && (
        <div className="flow-rule-form">
          <select
            value={form.exporterName}
            onChange={(e) =>
              setForm((v) => ({ ...v, exporterName: e.target.value }))
            }
          >
            <option value="">Todos equipamentos</option>
            {exporters.map((row) => (
              <option key={row.exporterName}>{row.exporterName}</option>
            ))}
          </select>
          <select
            value={form.ruleId}
            onChange={(e) => setForm((v) => ({ ...v, ruleId: e.target.value }))}
          >
            <option value="">Todas as detecções</option>
            {rules.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
          <label>
            <span>Início</span>
            <input
              type="datetime-local"
              value={form.startsAt}
              onChange={(e) =>
                setForm((v) => ({ ...v, startsAt: e.target.value }))
              }
            />
          </label>
          <label>
            <span>Fim</span>
            <input
              type="datetime-local"
              value={form.endsAt}
              onChange={(e) =>
                setForm((v) => ({ ...v, endsAt: e.target.value }))
              }
            />
          </label>
          <input
            placeholder="Motivo obrigatório"
            value={form.reason}
            onChange={(e) => setForm((v) => ({ ...v, reason: e.target.value }))}
          />
          <button className="btn btn-primary" disabled={busy} onClick={onSave}>
            Programar
          </button>
        </div>
      )}
      <div className="flow-rule-list">
        {rows.map((row) => (
          <article key={row.id}>
            <div>
              <strong>
                {status(row)} · {row.exporterName || "Todos equipamentos"}
              </strong>
              <span>
                {row.ruleId
                  ? rules.find((rule) => rule.id === row.ruleId)?.name ||
                    "Regra específica"
                  : "Todas as detecções"}{" "}
                · {new Date(row.startsAt).toLocaleString("pt-BR")} até{" "}
                {new Date(row.endsAt).toLocaleString("pt-BR")}
              </span>
              <small>
                {row.reason} · por {row.createdBy || "administrador"}
              </small>
            </div>
            {isAdmin && (
              <button
                className="btn btn-ghost btn-sm"
                disabled={busy}
                onClick={() => onDelete(row)}
              >
                Remover
              </button>
            )}
          </article>
        ))}
        {!rows.length && (
          <div className="empty-state">
            <Shield />
            <p>Nenhum silenciamento programado.</p>
          </div>
        )}
      </div>
    </section>
  );
}

function RuleTestPreview({ result, onTest, busy, isAdmin }) {
  if (!isAdmin) return null;
  return (
    <section className="card flow-rule-test">
      <header className="flow-section-title">
        <div>
          <span className="flow-kicker">Validação preventiva</span>
          <h3>Simular regra atual</h3>
        </div>
        <button
          className="btn btn-secondary btn-sm"
          disabled={busy}
          onClick={onTest}
        >
          {busy ? <span className="spinner" /> : <Search size={15} />} Testar
          sem notificar
        </button>
      </header>
      <p>
        A simulação consulta os últimos cinco minutos e não salva a regra, não
        cria Task e não envia Telegram.
      </p>
      {result && (
        <>
          <div className="flow-report-summary">
            {[
              ["Combinações", result.matches],
              ["Fluxos", result.flows],
              ["Pacotes", result.packets],
              ["Volume", size(result.bytes)],
            ].map(([label, value]) => (
              <article key={label}>
                <strong>
                  {typeof value === "number" ? integer(value) : value}
                </strong>
                <span>{label}</span>
              </article>
            ))}
          </div>
          {result.rows.length > 0 ? (
            <div className="flow-report-table">
              <table>
                <thead>
                  <tr>
                    <th>Equipamento</th>
                    <th>Origem</th>
                    <th>Destino</th>
                    <th>Protocolo</th>
                    <th>Porta</th>
                    <th>Volume</th>
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row, index) => (
                    <tr
                      key={`${row.exporterName}-${row.sourceAddress}-${row.destinationAddress}-${row.port}-${index}`}
                    >
                      <td>{row.exporterName}</td>
                      <td>{row.sourceAddress}</td>
                      <td>{row.destinationAddress}</td>
                      <td>{row.protocol}</td>
                      <td>{row.port || "—"}</td>
                      <td>{size(row.bytes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-state flow-safe">
              <Shield />
              <p>Nenhum fluxo atual seria atingido por essa regra.</p>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function AreaChart({
  rows,
  field,
  formatter = integer,
  color = "var(--primary)",
}) {
  const data = rows.slice(-48),
    values = data.map((row) => Number(row[field]) || 0),
    maximum = Math.max(...values, 1);
  if (data.length < 2)
    return (
      <div className="flow-chart-empty">
        <TrendingUp />
        <span>O gráfico aparecerá após a próxima coleta</span>
      </div>
    );
  const points = values
      .map(
        (value, index) =>
          `${18 + (index / (values.length - 1)) * 564},${148 - (value / maximum) * 118}`,
      )
      .join(" "),
    area = `18,148 ${points} 582,148`;
  return (
    <div className="flow-chart">
      <svg viewBox="0 0 600 170" preserveAspectRatio="none">
        <defs>
          <linearGradient id={`flow-${field}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity=".38" />
            <stop offset="1" stopColor={color} stopOpacity=".02" />
          </linearGradient>
        </defs>
        <g className="flow-chart-grid">
          <line x1="18" y1="30" x2="582" y2="30" />
          <line x1="18" y1="89" x2="582" y2="89" />
          <line x1="18" y1="148" x2="582" y2="148" />
        </g>
        <polygon points={area} fill={`url(#flow-${field})`} />
        <polyline points={points} fill="none" stroke={color} />
        {data.map((row, index) => (
          <circle
            key={row.id || row.day || index}
            cx={18 + (index / (data.length - 1)) * 564}
            cy={148 - (values[index] / maximum) * 118}
            r="3"
            fill={color}
          >
            <title>
              {new Date(row.collectedAt).toLocaleString("pt-BR")} ·{" "}
              {formatter(values[index])}
            </title>
          </circle>
        ))}
      </svg>
      <div className="flow-chart-axis">
        <span>
          {new Date(data[0].collectedAt).toLocaleTimeString("pt-BR", {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
        <b>Pico {formatter(maximum)}</b>
        <span>
          {new Date(data.at(-1).collectedAt).toLocaleTimeString("pt-BR", {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      </div>
    </div>
  );
}

function CustomRuleEditor({
  rules,
  form,
  setForm,
  onSave,
  onDelete,
  onToggle,
  onEdit,
  onDuplicate,
  onCancel,
  busy,
  isAdmin,
  exporters,
}) {
  return (
    <section className="card flow-rules">
      <header className="flow-section-title">
        <div>
          <span className="flow-kicker">Detecção administrável</span>
          <h3>Regras personalizadas</h3>
        </div>
        <small>Observação · sem bloqueio automático</small>
      </header>
      {isAdmin && (
        <div className="flow-rule-form">
          <input
            placeholder="Nome da regra"
            value={form.name}
            onChange={(e) => setForm((v) => ({ ...v, name: e.target.value }))}
          />
          <select
            value={form.exporterName}
            onChange={(e) =>
              setForm((v) => ({ ...v, exporterName: e.target.value }))
            }
          >
            <option value="">Todos equipamentos</option>
            {exporters.map((row) => (
              <option key={row.exporterName}>{row.exporterName}</option>
            ))}
          </select>
          <select
            value={form.protocol}
            onChange={(e) =>
              setForm((v) => ({ ...v, protocol: e.target.value }))
            }
          >
            <option value="">Todos protocolos</option>
            <option value="tcp">TCP</option>
            <option value="udp">UDP</option>
            <option value="icmp">ICMP</option>
          </select>
          <input
            type="number"
            placeholder="Porta destino"
            value={form.destinationPort}
            onChange={(e) =>
              setForm((v) => ({ ...v, destinationPort: e.target.value }))
            }
          />
          <input
            placeholder="IP origem"
            value={form.sourceAddress}
            onChange={(e) =>
              setForm((v) => ({ ...v, sourceAddress: e.target.value }))
            }
          />
          <input
            placeholder="IP destino"
            value={form.destinationAddress}
            onChange={(e) =>
              setForm((v) => ({ ...v, destinationAddress: e.target.value }))
            }
          />
          <input
            maxLength="2"
            placeholder="País origem"
            value={form.sourceCountry}
            onChange={(e) =>
              setForm((v) => ({ ...v, sourceCountry: e.target.value }))
            }
          />
          <input
            maxLength="2"
            placeholder="País destino"
            value={form.destinationCountry}
            onChange={(e) =>
              setForm((v) => ({ ...v, destinationCountry: e.target.value }))
            }
          />
          <input
            type="number"
            placeholder="Mínimo em bytes"
            value={form.minBytes}
            onChange={(e) =>
              setForm((v) => ({ ...v, minBytes: e.target.value }))
            }
          />
          <select
            value={form.severity}
            onChange={(e) =>
              setForm((v) => ({ ...v, severity: e.target.value }))
            }
          >
            <option value="warning">Alerta</option>
            <option value="critical">Crítica</option>
          </select>
          <select
            value={form.priority}
            onChange={(e) =>
              setForm((v) => ({ ...v, priority: e.target.value }))
            }
          >
            <option value="medium">Prioridade média</option>
            <option value="high">Prioridade alta</option>
            <option value="critical">Prioridade crítica</option>
          </select>
          <select
            value={form.notificationMode}
            onChange={(e) =>
              setForm((v) => ({ ...v, notificationMode: e.target.value }))
            }
          >
            <option value="panel">Somente painel</option>
            <option value="task">Criar Task</option>
            <option value="telegram">Enviar Telegram</option>
            <option value="task_telegram">Task + Telegram</option>
          </select>
          <input
            placeholder="Chat ID Telegram (opcional)"
            value={form.telegramChatId}
            onChange={(e) =>
              setForm((v) => ({ ...v, telegramChatId: e.target.value }))
            }
          />
          <select
            value={form.confirmationCount}
            onChange={(e) =>
              setForm((v) => ({ ...v, confirmationCount: e.target.value }))
            }
          >
            <option value="2">Confirmar em 2 coletas</option>
            <option value="3">Confirmar em 3 coletas</option>
            <option value="4">Confirmar em 4 coletas</option>
          </select>
          <select
            value={form.recurrenceMinutes}
            onChange={(e) =>
              setForm((v) => ({ ...v, recurrenceMinutes: e.target.value }))
            }
          >
            <option value="0">Recorrência global</option>
            <option value="15">Recorrência 15 min</option>
            <option value="30">Recorrência 30 min</option>
            <option value="60">Recorrência 1 hora</option>
            <option value="180">Recorrência 3 horas</option>
            <option value="360">Recorrência 6 horas</option>
            <option value="1440">Recorrência 24 horas</option>
            <option value="10080">Recorrência 7 dias</option>
          </select>
          <button className="btn btn-primary" disabled={busy} onClick={onSave}>
            {form.id ? "Salvar" : "Adicionar"}
          </button>
          {form.id && (
            <button className="btn btn-secondary" onClick={onCancel}>
              Cancelar
            </button>
          )}
        </div>
      )}
      <div className="flow-rule-list">
        {rules.map((row) => (
          <article className={!row.enabled ? "disabled" : ""} key={row.id}>
            <div>
              <strong>{row.name}</strong>
              <span>
                {row.enabled ? "Ativa" : "Desativada"} ·{" "}
                {row.exporterName || "Todos"} ·{" "}
                {row.protocol?.toUpperCase() || "qualquer protocolo"}
                {row.destinationPort ? `/${row.destinationPort}` : ""}
              </span>
            </div>
            {isAdmin && (
              <div className="flow-rule-actions">
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => onToggle(row)}
                >
                  {row.enabled ? "Desativar" : "Ativar"}
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => onEdit(row)}
                >
                  Editar
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => onDuplicate(row)}
                >
                  Duplicar
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => onDelete(row)}
                >
                  Excluir
                </button>
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

function RankingBars({
  rows,
  label,
  value = "bytes",
  formatter = size,
  detail,
}) {
  const maximum = Math.max(...rows.map((row) => Number(row[value]) || 0), 1);
  return (
    <div className="flow-bars">
      {rows.map((row, index) => (
        <article key={`${label(row)}-${index}`}>
          <div>
            <strong>{label(row)}</strong>
            <span>{formatter(row[value])}</span>
          </div>
          <i>
            <b
              style={{
                width: `${Math.max(2, (Number(row[value] || 0) / maximum) * 100)}%`,
              }}
            />
          </i>
          {detail && <small>{detail(row)}</small>}
        </article>
      ))}
    </div>
  );
}

function CustomRules({
  rules,
  form,
  setForm,
  onSave,
  onDelete,
  busy,
  isAdmin,
  exporters,
}) {
  return (
    <section className="card flow-rules">
      <header className="flow-section-title">
        <div>
          <span className="flow-kicker">Detecção administrável</span>
          <h3>Regras personalizadas</h3>
        </div>
        <small>Observação · sem bloqueio automático</small>
      </header>
      {isAdmin && (
        <div className="flow-rule-form">
          <input
            placeholder="Nome da regra"
            value={form.name}
            onChange={(e) => setForm((v) => ({ ...v, name: e.target.value }))}
          />
          <select
            value={form.exporterName}
            onChange={(e) =>
              setForm((v) => ({ ...v, exporterName: e.target.value }))
            }
          >
            <option value="">Todos equipamentos</option>
            {exporters.map((row) => (
              <option key={row.exporterName}>{row.exporterName}</option>
            ))}
          </select>
          <select
            value={form.protocol}
            onChange={(e) =>
              setForm((v) => ({ ...v, protocol: e.target.value }))
            }
          >
            <option value="">Todos protocolos</option>
            <option value="tcp">TCP</option>
            <option value="udp">UDP</option>
            <option value="icmp">ICMP</option>
          </select>
          <input
            type="number"
            placeholder="Porta destino"
            value={form.destinationPort}
            onChange={(e) =>
              setForm((v) => ({ ...v, destinationPort: e.target.value }))
            }
          />
          <input
            placeholder="IP origem"
            value={form.sourceAddress}
            onChange={(e) =>
              setForm((v) => ({ ...v, sourceAddress: e.target.value }))
            }
          />
          <input
            placeholder="IP destino"
            value={form.destinationAddress}
            onChange={(e) =>
              setForm((v) => ({ ...v, destinationAddress: e.target.value }))
            }
          />
          <input
            maxLength="2"
            placeholder="País origem"
            value={form.sourceCountry}
            onChange={(e) =>
              setForm((v) => ({ ...v, sourceCountry: e.target.value }))
            }
          />
          <input
            maxLength="2"
            placeholder="País destino"
            value={form.destinationCountry}
            onChange={(e) =>
              setForm((v) => ({ ...v, destinationCountry: e.target.value }))
            }
          />
          <input
            type="number"
            placeholder="Mínimo em bytes"
            value={form.minBytes}
            onChange={(e) =>
              setForm((v) => ({ ...v, minBytes: e.target.value }))
            }
          />
          <select
            value={form.severity}
            onChange={(e) =>
              setForm((v) => ({ ...v, severity: e.target.value }))
            }
          >
            <option value="warning">Alerta</option>
            <option value="critical">Crítica</option>
          </select>
          <button className="btn btn-primary" disabled={busy} onClick={onSave}>
            Adicionar
          </button>
        </div>
      )}
      <div className="flow-rule-list">
        {rules.map((row) => (
          <article key={row.id}>
            <div>
              <strong>{row.name}</strong>
              <span>
                {row.exporterName || "Todos"} ·{" "}
                {row.protocol?.toUpperCase() || "qualquer protocolo"}
                {row.destinationPort ? `/${row.destinationPort}` : ""} ·{" "}
                {row.confirmationCount} coletas
              </span>
            </div>
            {isAdmin && (
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => onDelete(row)}
              >
                Excluir
              </button>
            )}
          </article>
        ))}
        {!rules.length && (
          <div className="empty-state">
            <Shield />
            <p>Nenhuma regra personalizada cadastrada.</p>
          </div>
        )}
      </div>
    </section>
  );
}

function SecurityReport({
  report,
  filters,
  setFilters,
  onLoad,
  onExport,
  busy,
  exporters,
}) {
  return (
    <section className="card flow-security-report">
      <header className="flow-section-title">
        <div>
          <span className="flow-kicker">Histórico auditável</span>
          <h3>Relatório de segurança</h3>
        </div>
        <div>
          <button
            className="btn btn-secondary btn-sm"
            disabled={busy}
            onClick={onExport}
          >
            Exportar CSV
          </button>{" "}
          <button
            className="btn btn-primary btn-sm"
            disabled={busy}
            onClick={onLoad}
          >
            Atualizar
          </button>
        </div>
      </header>
      <div className="flow-report-filters">
        <select
          value={filters.days}
          onChange={(e) => setFilters((v) => ({ ...v, days: e.target.value }))}
        >
          <option value="1">24 horas</option>
          <option value="7">7 dias</option>
          <option value="30">30 dias</option>
          <option value="90">90 dias</option>
        </select>
        <select
          value={filters.exporterName}
          onChange={(e) =>
            setFilters((v) => ({ ...v, exporterName: e.target.value }))
          }
        >
          <option value="">Todos equipamentos</option>
          {exporters.map((row) => (
            <option key={row.exporterName}>{row.exporterName}</option>
          ))}
        </select>
        <select
          value={filters.severity}
          onChange={(e) =>
            setFilters((v) => ({ ...v, severity: e.target.value }))
          }
        >
          <option value="">Todas severidades</option>
          <option value="warning">Alerta</option>
          <option value="critical">Crítica</option>
        </select>
        <select
          value={filters.classification}
          onChange={(e) =>
            setFilters((v) => ({ ...v, classification: e.target.value }))
          }
        >
          <option value="">Todas classificações</option>
          <option value="attack">Ataque</option>
          <option value="false_positive">Falso positivo</option>
          <option value="legitimate">Tráfego legítimo</option>
        </select>
      </div>
      {report && (
        <>
          <div className="flow-report-summary">
            {[
              ["Ocorrências", report.summary.total],
              ["Críticas", report.summary.critical],
              ["Confirmadas", report.summary.confirmed],
              ["Resolvidas", report.summary.resolved],
              ["Automáticas", report.summary.automatic],
              ["Ataques", report.summary.attacks],
              ["Falsos positivos", report.summary.falsePositives],
              ["Recorrências evitadas", report.summary.recurrence],
            ].map(([label, value]) => (
              <article key={label}>
                <strong>{integer(value)}</strong>
                <span>{label}</span>
              </article>
            ))}
          </div>
          <div className="flow-security-dashboard">
            <section>
              <header>
                <div>
                  <span className="flow-kicker">Tendência</span>
                  <h4>Ocorrências no período</h4>
                </div>
                <b>{integer(report.summary.total)}</b>
              </header>
              <AreaChart rows={report.timeline} field="total" />
            </section>
            <section>
              <header>
                <span className="flow-kicker">Equipamentos</span>
                <h4>Eventos por exportador</h4>
              </header>
              <RankingBars
                rows={report.byExporter.slice(0, 8)}
                label={(row) => row.name}
                value="count"
                formatter={integer}
              />
            </section>
            <section>
              <header>
                <span className="flow-kicker">Detecções</span>
                <h4>Eventos por tipo</h4>
              </header>
              <RankingBars
                rows={report.byType.slice(0, 8)}
                label={(row) => row.name.replace("custom_rule:", "Regra ")}
                value="count"
                formatter={integer}
              />
            </section>
            <section>
              <header>
                <span className="flow-kicker">Protocolos</span>
                <h4>Distribuição observada</h4>
              </header>
              <RankingBars
                rows={report.byProtocol.slice(0, 8)}
                label={(row) => row.name}
                value="count"
                formatter={integer}
              />
            </section>
            <section>
              <header>
                <span className="flow-kicker">Classificação</span>
                <h4>Resultado da análise</h4>
              </header>
              <RankingBars
                rows={report.byClassification.filter(
                  (row) => row.name !== "não informado",
                )}
                label={(row) =>
                  ({
                    attack: "Ataque",
                    false_positive: "Falso positivo",
                    legitimate: "Legítimo",
                  })[row.name] || row.name
                }
                value="count"
                formatter={integer}
              />
            </section>
            <section>
              <header>
                <span className="flow-kicker">Origens</span>
                <h4>Principais endereços</h4>
              </header>
              <RankingBars
                rows={report.topSources.slice(0, 8)}
                label={(row) => row.name}
                value="count"
                formatter={integer}
              />
            </section>
          </div>
          <div className="flow-report-table">
            <table>
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Equipamento</th>
                  <th>Evento</th>
                  <th>Severidade</th>
                  <th>Status</th>
                  <th>Origem</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.slice(0, 100).map((row) => (
                  <tr key={row.id}>
                    <td>{new Date(row.lastSeenAt).toLocaleString("pt-BR")}</td>
                    <td>{row.exporterName}</td>
                    <td>{row.title}</td>
                    <td>
                      {row.severity === "critical" ? "Crítica" : "Alerta"}
                    </td>
                    <td>{row.status}</td>
                    <td>{row.sourceAddress || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

export default function FlowInspector({ isAdmin = false }) {
  const [data, setData] = useState(null),
    [mitigations, setMitigations] = useState([]),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [selectedExporter, setSelectedExporter] = useState("all"),
    [search, setSearch] = useState(""),
    toast = useToast();
  const [trafficFilters, setTrafficFilters] = useState({
      minutes: "15",
      protocol: "",
      port: "",
      ip: "",
      domain: "",
      direction: "",
    }),
    [trafficResult, setTrafficResult] = useState(null),
    [trafficBusy, setTrafficBusy] = useState(false);
  const [securityProfiles, setSecurityProfiles] = useState({}),
    [profileBusy, setProfileBusy] = useState(false);
  const emptyRule = {
    name: "",
    enabled: true,
    exporterName: "",
    protocol: "",
    destinationPort: "",
    sourceAddress: "",
    destinationAddress: "",
    sourceCountry: "",
    destinationCountry: "",
    minBytes: 0,
    severity: "warning",
    priority: "high",
    notificationMode: "task",
    telegramChatId: "",
    confirmationCount: 2,
    recurrenceMinutes: 0,
  };
  const [customRules, setCustomRules] = useState([]),
    [ruleForm, setRuleForm] = useState(emptyRule),
    [ruleBusy, setRuleBusy] = useState(false),
    [ruleTest, setRuleTest] = useState(null),
    [ruleTestBusy, setRuleTestBusy] = useState(false);
  const [securityReport, setSecurityReport] = useState(null),
    [reportFilters, setReportFilters] = useState({
      days: "7",
      exporterName: "",
      severity: "",
      classification: "",
    }),
    [reportBusy, setReportBusy] = useState(false);
  const toLocalInput = (date) => {
      const d = new Date(date - (Date.now() % 60000)),
        offset = d.getTimezoneOffset() * 60000;
      return new Date(d - offset).toISOString().slice(0, 16);
    },
    silenceDefault = () => ({
      exporterName: "",
      ruleId: "",
      startsAt: toLocalInput(Date.now()),
      endsAt: toLocalInput(Date.now() + 3600000),
      reason: "",
    });
  const [silences, setSilences] = useState([]),
    [silenceForm, setSilenceForm] = useState(silenceDefault),
    [silenceBusy, setSilenceBusy] = useState(false);
  const [flowNotifications, setFlowNotifications] = useState([]),
    [notificationBusy, setNotificationBusy] = useState(false);
  const [recurrenceMinutes, setRecurrenceMinutes] = useState("60"),
    [recurrenceBusy, setRecurrenceBusy] = useState(false);
  const [exporterHealthConfig, setExporterHealthConfig] = useState({
      enabled: true,
      timeoutMinutes: 15,
      notificationMode: "task",
    }),
    [exporterHealthBusy, setExporterHealthBusy] = useState(false);
  const [retention, setRetention] = useState(null),
    [retentionBusy, setRetentionBusy] = useState(false);
  const [flowIntegration, setFlowIntegration] = useState(null),
    [flowPassword, setFlowPassword] = useState(""),
    [integrationBusy, setIntegrationBusy] = useState(false);
  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const [dashboard, mitigationRows] = await Promise.all([
          api.getFlowInspector(),
          api.getFlowMitigations(),
        ]);
        setData(dashboard.data);
        setMitigations(mitigationRows.data);
      } catch (error) {
        toast(error.message, "error");
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [toast],
  );
  useEffect(() => {
    load();
    const timer = setInterval(() => load(true), 30000);
    return () => clearInterval(timer);
  }, [load]);
  useEffect(() => {
    api
      .getFlowSecurityProfiles()
      .then((r) => setSecurityProfiles(r.data))
      .catch(() => {});
    api
      .getFlowCustomRules()
      .then((r) => setCustomRules(r.data))
      .catch(() => {});
    api
      .getFlowSilences()
      .then((r) => setSilences(r.data))
      .catch(() => {});
    api
      .getFlowNotifications()
      .then((r) => setFlowNotifications(r.data))
      .catch(() => {});
    api
      .getFlowRecurrence()
      .then((r) => setRecurrenceMinutes(String(r.data.minutes)))
      .catch(() => {});
    api
      .getFlowExporterHealth()
      .then((r) => setExporterHealthConfig(r.data))
      .catch(() => {});
    api
      .getFlowRetention()
      .then((r) => setRetention(r.data))
      .catch(() => {});
    api
      .getFlowIntegration()
      .then((r) => setFlowIntegration(r.data))
      .catch(() => {});
  }, []);
  const collect = async () => {
    setBusy(true);
    try {
      const result = await api.collectFlowInspector();
      toast(result.message, "success");
      await load(true);
    } catch (error) {
      toast(error.message, "error");
    } finally {
      setBusy(false);
    }
  };
  const searchTraffic = async () => {
    setTrafficBusy(true);
    try {
      const result = await api.searchFlowTraffic({
        ...trafficFilters,
        exporter: selectedExporter === "all" ? "" : selectedExporter,
      });
      setTrafficResult(result.data);
    } catch (error) {
      toast(error.message, "error");
    } finally {
      setTrafficBusy(false);
    }
  };
  const clearTrafficFilters = () => {
    setTrafficFilters({
      minutes: "15",
      protocol: "",
      port: "",
      ip: "",
      domain: "",
      direction: "",
    });
    setTrafficResult(null);
  };
  const updateProfile = (key, value) =>
    selectedExporter !== "all" &&
    setSecurityProfiles((rows) => ({
      ...rows,
      [selectedExporter]: { ...rows[selectedExporter], [key]: value },
    }));
  const saveProfile = async () => {
    if (selectedExporter === "all") return;
    setProfileBusy(true);
    try {
      const result = await api.saveFlowSecurityProfile(
        selectedExporter,
        securityProfiles[selectedExporter],
      );
      setSecurityProfiles((rows) => ({
        ...rows,
        [selectedExporter]: result.data,
      }));
      toast(result.message, "success");
    } catch (error) {
      toast(error.message, "error");
    } finally {
      setProfileBusy(false);
    }
  };
  const saveRule = async () => {
    if (!ruleForm.name.trim()) return toast("Informe o nome da regra", "error");
    setRuleBusy(true);
    try {
      const result = await api.saveFlowCustomRule(ruleForm);
      setCustomRules((rows) => [
        ...rows.filter((item) => item.id !== result.data.id),
        result.data,
      ]);
      setRuleForm(emptyRule);
      toast(result.message, "success");
    } catch (error) {
      toast(error.message, "error");
    } finally {
      setRuleBusy(false);
    }
  };
  const testRule = async () => {
    setRuleTestBusy(true);
    try {
      const result = await api.testFlowCustomRule(ruleForm);
      setRuleTest(result.data);
      toast(result.message, "success");
    } catch (error) {
      toast(error.message, "error");
    } finally {
      setRuleTestBusy(false);
    }
  };
  const saveSilence = async () => {
    if (!silenceForm.reason.trim())
      return toast("Informe o motivo do silenciamento", "error");
    setSilenceBusy(true);
    try {
      const result = await api.saveFlowSilence(silenceForm);
      setSilences((rows) => [
        result.data,
        ...rows.filter((row) => row.id !== result.data.id),
      ]);
      setSilenceForm(silenceDefault());
      toast(result.message, "success");
    } catch (error) {
      toast(error.message, "error");
    } finally {
      setSilenceBusy(false);
    }
  };
  const saveRecurrence = async () => {
    setRecurrenceBusy(true);
    try {
      const result = await api.saveFlowRecurrence({
        minutes: Number(recurrenceMinutes),
      });
      setRecurrenceMinutes(String(result.data.minutes));
      toast(result.message, "success");
    } catch (error) {
      toast(error.message, "error");
    } finally {
      setRecurrenceBusy(false);
    }
  };
  const saveExporterHealth = async () => {
    setExporterHealthBusy(true);
    try {
      const result = await api.saveFlowExporterHealth({
        ...exporterHealthConfig,
        timeoutMinutes: Number(exporterHealthConfig.timeoutMinutes),
      });
      setExporterHealthConfig(result.data);
      toast(result.message, "success");
      await load(true);
    } catch (error) {
      toast(error.message, "error");
    } finally {
      setExporterHealthBusy(false);
    }
  };
  const saveRetention = async () => {
    setRetentionBusy(true);
    try {
      const result = await api.saveFlowRetention(
        Object.fromEntries(
          Object.entries(retention.policy).map(([key, value]) => [
            key,
            Number(value),
          ]),
        ),
      );
      const preview = await api.getFlowRetention();
      setRetention(preview.data);
      toast(result.message, "success");
    } catch (error) {
      toast(error.message, "error");
    } finally {
      setRetentionBusy(false);
    }
  };
  const executeRetention = async () => {
    if (
      !window.confirm(
        "Excluir definitivamente os registros indicados na prévia de retenção?",
      )
    )
      return;
    setRetentionBusy(true);
    try {
      const result = await api.executeFlowRetention();
      const preview = await api.getFlowRetention();
      setRetention(preview.data);
      toast(
        `${result.message}: ${Object.values(result.data.deleted).reduce((sum, value) => sum + Number(value), 0)} registro(s)`,
        "success",
      );
    } catch (error) {
      toast(error.message, "error");
    } finally {
      setRetentionBusy(false);
    }
  };
  const testIntegration = async () => {
    setIntegrationBusy(true);
    try {
      const result = await api.testFlowIntegration({
        url: flowIntegration.url,
        user: flowIntegration.user,
      });
      toast(
        `${result.message} · ${integer(result.data.flows)} fluxos em 5 min`,
        "success",
      );
    } catch (error) {
      toast(error.message, "error");
    } finally {
      setIntegrationBusy(false);
    }
  };
  const saveIntegration = async () => {
    setIntegrationBusy(true);
    try {
      const result = await api.saveFlowIntegration({
        url: flowIntegration.url,
        user: flowIntegration.user,
      });
      setFlowIntegration(result.data);
      toast(result.message, "success");
    } catch (error) {
      toast(error.message, "error");
    } finally {
      setIntegrationBusy(false);
    }
  };
  const rotateIntegrationPassword = async () => {
    if (
      !window.confirm(
        "Trocar a senha do ClickHouse e atualizar o segredo do NOC Agent?",
      )
    )
      return;
    setIntegrationBusy(true);
    try {
      const result = await api.rotateFlowPassword(flowPassword);
      setFlowPassword("");
      setFlowIntegration((v) => ({ ...v, passwordConfigured: true }));
      toast(result.message, "success");
    } catch (error) {
      toast(error.message, "error");
    } finally {
      setIntegrationBusy(false);
    }
  };
  const deleteSilence = async (row) => {
    if (!window.confirm("Remover este silenciamento?")) return;
    setSilenceBusy(true);
    try {
      const result = await api.deleteFlowSilence(row.id);
      setSilences((items) => items.filter((item) => item.id !== row.id));
      toast(result.message, "success");
    } catch (error) {
      toast(error.message, "error");
    } finally {
      setSilenceBusy(false);
    }
  };
  const retryNotification = async (row) => {
    if (!window.confirm(`Reenviar esta notificação por ${row.channel}?`))
      return;
    setNotificationBusy(true);
    try {
      const result = await api.retryFlowNotification(row.id);
      setFlowNotifications((items) => [result.data, ...items]);
      toast(result.message, "success");
    } catch (error) {
      toast(error.message, "error");
      api
        .getFlowNotifications()
        .then((r) => setFlowNotifications(r.data))
        .catch(() => {});
    } finally {
      setNotificationBusy(false);
    }
  };
  const deleteRule = async (row) => {
    if (!window.confirm(`Excluir a regra "${row.name}"?`)) return;
    setRuleBusy(true);
    try {
      const result = await api.deleteFlowCustomRule(row.id);
      setCustomRules((items) => items.filter((item) => item.id !== row.id));
      toast(result.message, "success");
    } catch (error) {
      toast(error.message, "error");
    } finally {
      setRuleBusy(false);
    }
  };
  const toggleRule = async (row) => {
    setRuleBusy(true);
    try {
      const result = await api.saveFlowCustomRule({
        ...row,
        enabled: !row.enabled,
      });
      setCustomRules((items) =>
        items.map((item) => (item.id === row.id ? result.data : item)),
      );
      toast(
        result.data.enabled ? "Regra ativada" : "Regra desativada",
        "success",
      );
    } catch (error) {
      toast(error.message, "error");
    } finally {
      setRuleBusy(false);
    }
  };
  const editRule = (row) => setRuleForm({ ...row });
  const duplicateRule = (row) =>
    setRuleForm({
      ...row,
      id: undefined,
      name: `${row.name} (cópia)`,
      enabled: false,
    });
  const cancelRuleEdit = () => setRuleForm(emptyRule);
  const loadSecurityReport = async () => {
    setReportBusy(true);
    try {
      const result = await api.getFlowSecurityReport(reportFilters);
      setSecurityReport(result.data);
    } catch (error) {
      toast(error.message, "error");
    } finally {
      setReportBusy(false);
    }
  };
  useEffect(() => {
    let active = true;
    setReportBusy(true);
    api
      .getFlowSecurityReport(reportFilters)
      .then((result) => {
        if (active) setSecurityReport(result.data);
      })
      .catch((error) => toast(error.message, "error"))
      .finally(() => {
        if (active) setReportBusy(false);
      });
    return () => {
      active = false;
    };
  }, [reportFilters, toast]);
  const exportSecurityReport = async () => {
    setReportBusy(true);
    try {
      const result = await api.downloadFlowSecurityCsv(reportFilters),
        url = URL.createObjectURL(result.blob),
        link = document.createElement("a");
      link.href = url;
      link.download = result.filename;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast(error.message, "error");
    } finally {
      setReportBusy(false);
    }
  };
  const classify = async (row, classification) => {
    const labels = {
        attack: "confirmar como ataque",
        false_positive: "marcar como falso positivo",
        legitimate: "marcar como tráfego legítimo",
      },
      resolution = window.prompt(
        `Justificativa para ${labels[classification]}:`,
        classification === "attack"
          ? "Evidências revisadas pelo operador."
          : "",
      );
    if (resolution === null) return;
    setBusy(true);
    try {
      const result = await api.classifyFlowAnomaly(
        row.id,
        classification,
        resolution,
      );
      toast(result.message, "success");
      await load(true);
    } catch (error) {
      toast(error.message, "error");
    } finally {
      setBusy(false);
    }
  };
  const prepareMitigation = async (row) => {
    const duration = Number(
      window.prompt(
        "Duração do bloqueio temporário em minutos (5 a 240):",
        "30",
      ),
    );
    if (!duration) return;
    setBusy(true);
    try {
      const result = await api.prepareFlowMitigation(row.id, duration);
      toast(result.message, "success");
      await load(true);
    } catch (error) {
      toast(error.message, "error");
    } finally {
      setBusy(false);
    }
  };
  const approveMitigation = async (row) => {
    if (
      !window.confirm(
        `Aplicar no ${row.deviceName} o bloqueio temporário de ${row.targetIp} por ${row.durationMinutes} minutos?\n\n${row.command}`,
      )
    )
      return;
    setBusy(true);
    try {
      const result = await api.approveFlowMitigation(row.id);
      toast(result.message, "success");
      await load(true);
    } catch (error) {
      toast(error.message, "error");
    } finally {
      setBusy(false);
    }
  };
  const timeline = useMemo(() => {
    const rows = [...(data?.snapshots || [])]
      .filter(
        (row) =>
          selectedExporter === "all" || row.exporterName === selectedExporter,
      )
      .reverse();
    if (selectedExporter !== "all") return rows;
    const buckets = new Map();
    for (const row of rows) {
      const key = Math.floor(new Date(row.collectedAt).getTime() / 300000),
        current = buckets.get(key) || {
          id: key,
          collectedAt: row.collectedAt,
          bytes: 0,
          packets: 0,
          flows: 0,
        };
      current.bytes += Number(row.bytes) || 0;
      current.packets += Number(row.packets) || 0;
      current.flows += Number(row.flows) || 0;
      buckets.set(key, current);
    }
    return [...buckets.values()];
  }, [data, selectedExporter]);
  if (loading)
    return (
      <div className="loading-screen">
        <span className="spinner" /> Carregando tráfego...
      </div>
    );
  if (!data) return null;
  const activeAnomalies = data.anomalies.filter((row) =>
      ["observed", "confirmed"].includes(row.status),
    ),
    scopedExporters = data.exporters.filter(
      (row) =>
        selectedExporter === "all" || row.exporterName === selectedExporter,
    ),
    visibleExporters = data.exporters.filter((row) =>
      `${row.exporterName} ${row.exporterAddress}`
        .toLowerCase()
        .includes(search.toLowerCase()),
    ),
    scopedSources = data.topSources
      .filter(
        (row) =>
          selectedExporter === "all" || row.exporterName === selectedExporter,
      )
      .sort((a, b) => Number(b.bytes) - Number(a.bytes))
      .slice(0, 10),
    scopedPorts = data.topPorts
      .filter(
        (row) =>
          selectedExporter === "all" || row.exporterName === selectedExporter,
      )
      .sort((a, b) => Number(b.bytes) - Number(a.bytes))
      .slice(0, 10),
    scopedAnomalies = activeAnomalies.filter(
      (row) =>
        selectedExporter === "all" || row.exporterName === selectedExporter,
    ),
    totals = scopedExporters.reduce(
      (sum, row) => ({
        flows: sum.flows + Number(row.flows),
        bytes: sum.bytes + Number(row.bytes),
        packets: sum.packets + Number(row.packets),
      }),
      { flows: 0, bytes: 0, packets: 0 },
    ),
    learningRows = Array.isArray(data.learning) ? data.learning : [],
    scopedLearning =
      selectedExporter === "all"
        ? learningRows
        : learningRows.filter((row) => row.exporterName === selectedExporter),
    learningProgress = scopedLearning.length
      ? Math.round(
          scopedLearning.reduce((sum, row) => sum + row.progress, 0) /
            scopedLearning.length,
        )
      : 0,
    learningReady =
      scopedLearning.length > 0 && scopedLearning.every((row) => row.ready),
    learningEnd = scopedLearning
      .filter((row) => !row.ready)
      .sort((a, b) => new Date(b.endsAt) - new Date(a.endsAt))[0]?.endsAt;
  return (
    <div className="flow-page">
      <div className="page-header page-header-actions">
        <div>
          <h2>Inspeção de tráfego</h2>
          <p>NetFlow/IPFIX · análise comportamental e detecção de anomalias</p>
        </div>
        <button className="btn btn-primary" disabled={busy} onClick={collect}>
          {busy ? <span className="spinner" /> : <RefreshCw size={15} />}{" "}
          Coletar agora
        </button>
      </div>
      <IntegrationAdmin
        config={flowIntegration}
        setConfig={setFlowIntegration}
        password={flowPassword}
        setPassword={setFlowPassword}
        onSave={saveIntegration}
        onTest={testIntegration}
        onRotate={rotateIntegrationPassword}
        busy={integrationBusy}
        isAdmin={isAdmin}
        exporters={data.exporters}
      />
      <RecurrenceControl
        minutes={recurrenceMinutes}
        setMinutes={setRecurrenceMinutes}
        onSave={saveRecurrence}
        busy={recurrenceBusy}
        isAdmin={isAdmin}
      />
      <ExporterHealth
        rows={data.exporterHealth || []}
        config={exporterHealthConfig}
        setConfig={setExporterHealthConfig}
        onSave={saveExporterHealth}
        busy={exporterHealthBusy}
        isAdmin={isAdmin}
      />
      <RetentionPolicy
        data={retention}
        setData={setRetention}
        onSave={saveRetention}
        onExecute={executeRetention}
        busy={retentionBusy}
        isAdmin={isAdmin}
      />
      <CustomRuleEditor
        rules={customRules}
        form={ruleForm}
        setForm={setRuleForm}
        onSave={saveRule}
        onDelete={deleteRule}
        onToggle={toggleRule}
        onEdit={editRule}
        onDuplicate={duplicateRule}
        onCancel={cancelRuleEdit}
        busy={ruleBusy}
        isAdmin={isAdmin}
        exporters={data.exporters}
      />
      <RuleTestPreview
        result={ruleTest}
        onTest={testRule}
        busy={ruleTestBusy}
        isAdmin={isAdmin}
      />
      <SilenceWindows
        rows={silences}
        form={silenceForm}
        setForm={setSilenceForm}
        onSave={saveSilence}
        onDelete={deleteSilence}
        busy={silenceBusy}
        isAdmin={isAdmin}
        exporters={data.exporters}
        rules={customRules}
      />
      <NotificationHistory
        rows={flowNotifications}
        onRetry={retryNotification}
        busy={notificationBusy}
        isAdmin={isAdmin}
      />
      <SecurityReport
        report={securityReport}
        filters={reportFilters}
        setFilters={setReportFilters}
        onLoad={loadSecurityReport}
        onExport={exportSecurityReport}
        busy={reportBusy}
        exporters={data.exporters}
      />
      <div className="flow-mode">
        <Shield size={22} />
        <div>
          <strong>Modo observação</strong>
          <span>Nenhuma mitigação ou bloqueio será executado</span>
        </div>
        <div className="flow-progress">
          <i style={{ width: `${learningProgress}%` }} />
          <small>
            {learningReady
              ? `Linha de base ativa · ${learningProgress}%`
              : `Aprendizado ${learningProgress}%${learningEnd ? ` · previsto até ${new Date(learningEnd).toLocaleString("pt-BR")}` : ""}`}
          </small>
        </div>
      </div>
      <section className="card flow-exporter-selector">
        <header>
          <div>
            <span className="flow-kicker">Escopo da análise</span>
            <h3>Equipamentos monitorados</h3>
          </div>
          <label>
            <Search size={14} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar nome ou IP"
            />
          </label>
        </header>
        <div className="flow-exporter-tabs">
          <button
            className={selectedExporter === "all" ? "active" : ""}
            onClick={() => setSelectedExporter("all")}
          >
            <span className="flow-device-icon">
              <Database size={17} />
            </span>
            <span>
              <strong>Todos os equipamentos</strong>
              <small>{data.exporters.length} exportador(es) ativos</small>
            </span>
            <b>
              {size(
                data.exporters.reduce((sum, row) => sum + Number(row.bytes), 0),
              )}
            </b>
          </button>
          {visibleExporters.map((row) => (
            <button
              key={row.exporterAddress}
              className={selectedExporter === row.exporterName ? "active" : ""}
              onClick={() => setSelectedExporter(row.exporterName)}
            >
              <span className="flow-device-icon">
                <TrafficCone size={17} />
              </span>
              <span>
                <strong>{row.exporterName}</strong>
                <small>{row.exporterAddress}</small>
              </span>
              <b>{size(row.bytes)}</b>
              <i title="Recebendo fluxos" />
            </button>
          ))}
        </div>
      </section>
      {selectedExporter !== "all" && securityProfiles[selectedExporter] && (
        <section className="card flow-profile">
          <header className="flow-section-title">
            <div>
              <span className="flow-kicker">Política por equipamento</span>
              <h3>Perfil de segurança · {selectedExporter}</h3>
            </div>
            <Shield size={20} />
          </header>
          <div className="flow-profile-grid">
            {[
              ["scanPorts", "Portas distintas para scan"],
              ["scanDestinations", "Destinos incomuns"],
              ["tcpPackets", "Pacotes TCP"],
              ["tcpFlows", "Fluxos TCP"],
              ["udpPackets", "Pacotes UDP"],
              ["udpBytes", "Bytes UDP"],
              ["icmpPackets", "Pacotes ICMP"],
              ["confirmationCount", "Coletas para confirmar"],
            ].map(([key, label]) => (
              <label key={key}>
                <span>{label}</span>
                <input
                  type="number"
                  disabled={!isAdmin}
                  value={securityProfiles[selectedExporter][key]}
                  onChange={(e) => updateProfile(key, e.target.value)}
                />
              </label>
            ))}
            <label className="flow-profile-trusted">
              <span>IPs confiáveis (separados por vírgula)</span>
              <textarea
                disabled={!isAdmin}
                value={(
                  securityProfiles[selectedExporter].trustedIps || []
                ).join(", ")}
                onChange={(e) => updateProfile("trustedIps", e.target.value)}
              />
            </label>
          </div>
          {isAdmin && (
            <div className="flow-profile-actions">
              <button
                className="btn btn-primary"
                disabled={profileBusy}
                onClick={saveProfile}
              >
                {profileBusy ? (
                  <span className="spinner" />
                ) : (
                  <Shield size={15} />
                )}{" "}
                Salvar perfil
              </button>
              <small>
                As exceções ignoram apenas detecção; nenhuma regra é aplicada ao
                equipamento.
              </small>
            </div>
          )}
        </section>
      )}
      <section className="card flow-search">
        <header className="flow-section-title">
          <div>
            <span className="flow-kicker">Pesquisa detalhada</span>
            <h3>Filtrar tráfego</h3>
          </div>
          <Filter size={20} />
        </header>
        <div className="flow-filter-grid">
          <label>
            <span>Período</span>
            <select
              value={trafficFilters.minutes}
              onChange={(e) =>
                setTrafficFilters((v) => ({ ...v, minutes: e.target.value }))
              }
            >
              <option value="15">Últimos 15 minutos</option>
              <option value="60">Última hora</option>
              <option value="360">Últimas 6 horas</option>
              <option value="1440">Últimas 24 horas</option>
            </select>
          </label>
          <label>
            <span>Protocolo</span>
            <select
              value={trafficFilters.protocol}
              onChange={(e) =>
                setTrafficFilters((v) => ({ ...v, protocol: e.target.value }))
              }
            >
              <option value="">Todos</option>
              <option value="tcp">TCP</option>
              <option value="udp">UDP</option>
              <option value="icmp">ICMP</option>
              <option value="icmpv6">ICMPv6</option>
            </select>
          </label>
          <label>
            <span>Porta/serviço</span>
            <input
              type="number"
              min="1"
              max="65535"
              placeholder="Ex.: 443"
              value={trafficFilters.port}
              onChange={(e) =>
                setTrafficFilters((v) => ({ ...v, port: e.target.value }))
              }
            />
          </label>
          <label>
            <span>IP origem ou destino</span>
            <input
              placeholder="Ex.: 192.168.2.208"
              value={trafficFilters.ip}
              onChange={(e) =>
                setTrafficFilters((v) => ({ ...v, ip: e.target.value }))
              }
            />
          </label>
          <label>
            <span>Domínio estimado</span>
            <input
              placeholder="Ex.: google.com"
              value={trafficFilters.domain}
              onChange={(e) =>
                setTrafficFilters((v) => ({ ...v, domain: e.target.value }))
              }
            />
          </label>
          <label>
            <span>Direção</span>
            <select
              value={trafficFilters.direction}
              onChange={(e) =>
                setTrafficFilters((v) => ({ ...v, direction: e.target.value }))
              }
            >
              <option value="">Todas</option>
              <option value="ingress">Entrada</option>
              <option value="egress">Saída</option>
            </select>
          </label>
          <div className="flow-filter-actions">
            <button
              className="btn btn-primary"
              disabled={trafficBusy}
              onClick={searchTraffic}
            >
              {trafficBusy ? (
                <span className="spinner" />
              ) : (
                <Search size={15} />
              )}{" "}
              Pesquisar
            </button>
            <button
              className="btn btn-secondary"
              disabled={trafficBusy}
              onClick={clearTrafficFilters}
            >
              <X size={15} /> Limpar filtros
            </button>
          </div>
        </div>
        {trafficResult && (
          <>
            <small className="flow-domain-notice">
              {trafficResult.domainNotice}
            </small>
            <div className="flow-results">
              <table>
                <thead>
                  <tr>
                    <th>Equipamento</th>
                    <th>Origem</th>
                    <th>Destino</th>
                    <th>Protocolo</th>
                    <th>Portas</th>
                    <th>Direção</th>
                    <th>Volume</th>
                    <th>Fluxos</th>
                  </tr>
                </thead>
                <tbody>
                  {trafficResult.rows.map((row, index) => (
                    <tr
                      key={`${row.sourceAddress}-${row.destinationAddress}-${row.protocol}-${index}`}
                    >
                      <td>{row.exporterName}</td>
                      <td>
                        <strong>{row.sourceAddress}</strong>
                        {row.sourceDomain && (
                          <small>{row.sourceDomain} · estimado</small>
                        )}
                      </td>
                      <td>
                        <strong>{row.destinationAddress}</strong>
                        {row.destinationDomain && (
                          <small>{row.destinationDomain} · estimado</small>
                        )}
                      </td>
                      <td>{row.protocol}</td>
                      <td>
                        {row.sourcePort || "—"} → {row.destinationPort || "—"}
                      </td>
                      <td>
                        {row.direction === "ingress"
                          ? "Entrada"
                          : row.direction === "egress"
                            ? "Saída"
                            : "Não informada"}
                      </td>
                      <td>{size(row.bytes)}</td>
                      <td>{integer(row.flows)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!trafficResult.rows.length && (
                <div className="empty-state">
                  <Search />
                  <p>Nenhum fluxo encontrado com esses filtros.</p>
                </div>
              )}
            </div>
          </>
        )}
      </section>
      <div className="stats-grid flow-stats">
        <div className="stat-card">
          <Database />
          <div>
            <span className="stat-label">Exportadores ativos</span>
            <div className="stat-value">{data.exporters.length}</div>
            <small>recebendo agora</small>
          </div>
        </div>
        <div className="stat-card">
          <Activity />
          <div>
            <span className="stat-label">Fluxos · 5 min</span>
            <div className="stat-value">{integer(totals.flows)}</div>
            <small>{integer(totals.packets)} pacotes</small>
          </div>
        </div>
        <div className="stat-card">
          <TrafficCone />
          <div>
            <span className="stat-label">Volume · 5 min</span>
            <div className="stat-value">{size(totals.bytes)}</div>
            <small>tráfego observado</small>
          </div>
        </div>
        <div className="stat-card">
          <AlertTriangle />
          <div>
            <span className="stat-label">Anomalias ativas</span>
            <div className="stat-value">{activeAnomalies.length}</div>
            <small>
              {
                activeAnomalies.filter((row) => row.severity === "critical")
                  .length
              }{" "}
              críticas
            </small>
          </div>
        </div>
      </div>
      <div className="flow-chart-grid">
        <section className="card flow-chart-card">
          <header>
            <div>
              <span className="flow-kicker">Tendência</span>
              <h3>Volume por coleta</h3>
            </div>
            <b>{size(timeline.at(-1)?.bytes)}</b>
          </header>
          <AreaChart rows={timeline} field="bytes" formatter={size} />
        </section>
        <section className="card flow-chart-card">
          <header>
            <div>
              <span className="flow-kicker">Intensidade</span>
              <h3>Pacotes por coleta</h3>
            </div>
            <b>{integer(timeline.at(-1)?.packets)}</b>
          </header>
          <AreaChart rows={timeline} field="packets" color="#8b5cf6" />
        </section>
      </div>
      <div className="flow-grid">
        <section className="card">
          <header className="flow-section-title">
            <div>
              <span className="flow-kicker">Top talkers</span>
              <h3>Principais origens · 15 min</h3>
            </div>
          </header>
          <RankingBars
            rows={scopedSources}
            label={(row) => identityLabel(row.identity) || row.address}
            detail={(row) =>
              `${identityLabel(row.identity) ? `${row.address} · ` : ""}${selectedExporter === "all" ? `${row.exporterName} · ` : ""}${integer(row.destinations)} destinos · ${integer(row.ports)} portas`
            }
          />
        </section>
        <section className="card">
          <header className="flow-section-title">
            <div>
              <span className="flow-kicker">Serviços</span>
              <h3>Portas de destino · 15 min</h3>
            </div>
          </header>
          <RankingBars
            rows={scopedPorts}
            label={(row) => row.port || "Outros"}
            detail={(row) =>
              `${selectedExporter === "all" ? `${row.exporterName} · ` : ""}${integer(row.packets)} pacotes · ${integer(row.flows)} fluxos`
            }
          />
        </section>
      </div>
      <div className="flow-grid">
        <section className="card">
          <header className="flow-section-title">
            <div>
              <span className="flow-kicker">Coletores</span>
              <h3>Exportadores no escopo</h3>
            </div>
            <span className="flow-live">
              <i /> AO VIVO
            </span>
          </header>
          {scopedExporters.map((row) => {
            const learning = learningRows.find(
              (item) => item.exporterName === row.exporterName,
            );
            return (
              <article className="flow-exporter" key={row.exporterAddress}>
                <div>
                  <strong>{row.exporterName}</strong>
                  <span>
                    {row.exporterAddress} ·{" "}
                    {learning?.ready
                      ? "baseline ativo"
                      : `aprendizado ${learning?.progress || 0}%`}
                  </span>
                </div>
                <div>
                  <b>{integer(row.flows)}</b>
                  <small>fluxos</small>
                </div>
                <div>
                  <b>{size(row.bytes)}</b>
                  <small>volume</small>
                </div>
                <div>
                  <b>{integer(row.uniqueSources)}</b>
                  <small>origens</small>
                </div>
              </article>
            );
          })}
        </section>
        <section className="card">
          <header className="flow-section-title">
            <div>
              <span className="flow-kicker">Segurança</span>
              <h3>Anomalias observadas</h3>
            </div>
          </header>
          {!scopedAnomalies.length ? (
            <div className="empty-state flow-safe">
              <Shield />
              <strong>Tráfego dentro do padrão observado</strong>
              <p>Nenhuma anomalia ativa no momento.</p>
            </div>
          ) : (
            scopedAnomalies.map((row) => (
              <article className={`flow-anomaly ${row.severity}`} key={row.id}>
                <strong>{row.title}</strong>
                <p>{row.description}</p>
                {(row.sourceIdentity || row.destinationIdentity) && (
                  <p className="flow-identity">
                    {row.sourceIdentity && (
                      <>Origem: {identityLabel(row.sourceIdentity)}</>
                    )}
                    {row.sourceIdentity && row.destinationIdentity ? " · " : ""}
                    {row.destinationIdentity && (
                      <>Destino: {identityLabel(row.destinationIdentity)}</>
                    )}
                  </p>
                )}
                <small>
                  {row.exporterName} ·{" "}
                  {new Date(row.lastSeenAt).toLocaleString("pt-BR")}
                </small>
              </article>
            ))
          )}
        </section>
      </div>
      {scopedAnomalies.some(
        (row) =>
          ["observed", "confirmed"].includes(row.status) && !row.classification,
      ) && (
        <section className="card flow-review">
          <header>
            <div>
              <span className="flow-kicker">Validação humana</span>
              <h3>Eventos aguardando classificação</h3>
            </div>
            <small>
              Essa decisão ajusta reincidências equivalentes por 30 dias.
            </small>
          </header>
          {scopedAnomalies
            .filter(
              (row) =>
                ["observed", "confirmed"].includes(row.status) &&
                !row.classification,
            )
            .map((row) => (
              <article key={row.id}>
                <div>
                  <strong>{row.title}</strong>
                  <span>
                    {row.exporterName} ·{" "}
                    {row.sourceAddress || "origem não identificada"} · confiança{" "}
                    {row.confidence}%
                  </span>
                  <p>{row.description}</p>
                </div>
                <div>
                  <button
                    className="btn btn-danger btn-sm"
                    disabled={busy}
                    onClick={() => classify(row, "attack")}
                  >
                    Confirmar ataque
                  </button>
                  <button
                    className="btn btn-secondary btn-sm"
                    disabled={busy}
                    onClick={() => classify(row, "false_positive")}
                  >
                    Falso positivo
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    disabled={busy}
                    onClick={() => classify(row, "legitimate")}
                  >
                    Tráfego legítimo
                  </button>
                </div>
              </article>
            ))}
        </section>
      )}
      {(scopedAnomalies.some((row) => row.classification === "attack") ||
        mitigations.length > 0) && (
        <section className="card flow-review flow-mitigations">
          <header>
            <div>
              <span className="flow-kicker">Resposta assistida</span>
              <h3>Mitigações temporárias</h3>
            </div>
            <small>
              Somente IP público; execução exclusiva pelo administrador.
            </small>
          </header>
          {scopedAnomalies
            .filter(
              (row) =>
                row.classification === "attack" &&
                !mitigations.some(
                  (item) =>
                    item.anomalyId === row.id &&
                    ["proposed", "active"].includes(item.status),
                ),
            )
            .map((row) => (
              <article key={row.id}>
                <div>
                  <strong>{row.sourceAddress}</strong>
                  <span>{row.title}</span>
                  <p>Prepare uma proposta sem alterar o equipamento.</p>
                </div>
                <button
                  className="btn btn-secondary btn-sm"
                  disabled={busy}
                  onClick={() => prepareMitigation(row)}
                >
                  Preparar mitigação
                </button>
              </article>
            ))}
          {mitigations.map((row) => (
            <article key={row.id}>
              <div>
                <strong>
                  {row.targetIp} · {row.deviceName}
                </strong>
                <span>
                  {row.status} · {row.durationMinutes} minutos
                </span>
                <code>{row.command}</code>
              </div>
              {row.status === "proposed" && isAdmin && (
                <button
                  className="btn btn-danger btn-sm"
                  disabled={busy}
                  onClick={() => approveMitigation(row)}
                >
                  Revisar e aplicar
                </button>
              )}
            </article>
          ))}
        </section>
      )}
    </div>
  );
}
