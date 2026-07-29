const STATUS_MAP = {
  pending: { label: 'Novo', className: 'badge-warning' },
  in_progress: { label: 'Em atendimento', className: 'badge-info' },
  diagnosing: { label: 'Diagnosticando', className: 'badge-info' },
  awaiting_approval: { label: 'Aguardando', className: 'badge-cyan' },
  executing: { label: 'Executando', className: 'badge-info' },
  completed: { label: 'Resolvido (legado)', className: 'badge-success' },
  resolved: { label: 'Resolvido', className: 'badge-success' },
  validated: { label: 'Validado', className: 'badge-cyan' },
  closed: { label: 'Encerrado', className: 'badge-muted' },
  failed: { label: 'Falhou', className: 'badge-danger' },
  cancelled: { label: 'Cancelado', className: 'badge-muted' },
};

const PRIORITY_MAP = {
  low: { label: 'Baixa', className: 'badge-muted' },
  medium: { label: 'Média', className: 'badge-info' },
  high: { label: 'Alta', className: 'badge-warning' },
  critical: { label: 'Crítica', className: 'badge-danger' },
};

export function StatusBadge({ status }) {
  const config = STATUS_MAP[status] || { label: status, className: 'badge-muted' };
  return (
    <span className={`badge ${config.className}`}>
      <span className="badge-dot" />
      {config.label}
    </span>
  );
}

export function PriorityBadge({ priority }) {
  const config = PRIORITY_MAP[priority] || { label: priority, className: 'badge-muted' };
  return <span className={`badge ${config.className}`}>{config.label}</span>;
}

export function TypeBadge({ type }) {
  const types = { mikrotik: ['MikroTik','badge-cyan'], linux: ['Linux','badge-success'], huawei_vrp: ['Huawei VRP','badge-warning'], cisco_ios:['Cisco IOS','badge-info'], juniper_junos:['Juniper Junos','badge-purple'], fortigate_fortios:['FortiGate','badge-danger'], ubiquiti_edgeos:['EdgeOS','badge-info'], unifi_controller:['UniFi','badge-cyan'], datacom_dmos:['Datacom','badge-warning'], nokia_sros:['Nokia SR OS','badge-purple'] };
  const [label, className] = types[type] || [type, 'badge-muted'];
  return (
    <span className={`badge ${className}`}>{label}</span>
  );
}
