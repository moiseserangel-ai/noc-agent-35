const numeric = value => Number(value) || 0;

export function flowCorrelationKind(left, right) {
  if (!left || !right || left.id === right.id) return null;
  const sameSource = left.sourceAddress && left.sourceAddress === right.sourceAddress;
  const sameDestination = left.destinationAddress && left.destinationAddress === right.destinationAddress;
  const sameService = (left.port || 0) === (right.port || 0) && (left.protocol || '') === (right.protocol || '');
  if (sameSource && left.exporterName !== right.exporterName) return 'multi_target';
  if (sameDestination && sameService && left.sourceAddress !== right.sourceAddress) return 'distributed';
  if (sameSource && left.exporterName === right.exporterName && (left.port || 0) !== (right.port || 0)) return 'attack_chain';
  return null;
}

export function calculateFlowRisk(anomaly, context = {}) {
  let score = anomaly.severity === 'critical' ? 42 : anomaly.severity === 'high' ? 32 : anomaly.severity === 'medium' ? 20 : 10;
  score += Math.round(Math.min(20, Math.max(0, numeric(anomaly.confidence) - 50) * 0.4));
  score += Math.min(10, Math.max(0, numeric(anomaly.consecutiveCount) - 1) * 2);
  if (numeric(anomaly.packets) >= 1000000 || numeric(anomaly.bytes) >= 1000000000) score += 12;
  else if (numeric(anomaly.packets) >= 100000 || numeric(anomaly.bytes) >= 100000000) score += 7;
  else if (numeric(anomaly.packets) >= 10000 || numeric(anomaly.bytes) >= 10000000) score += 3;
  score += Math.min(12, Math.max(0, numeric(context.relatedEvents) - 1) * 2);
  if (numeric(context.exporters) > 1) score += 7;
  if (numeric(context.sources) > 4) score += 7;
  if (context.protectedDestination) score += context.criticality === 'critical' ? 10 : context.criticality === 'high' ? 6 : 3;
  score = Math.min(100, Math.max(0, Math.round(score)));
  return { score, level: score >= 80 ? 'critical' : score >= 60 ? 'high' : score >= 35 ? 'medium' : 'low' };
}

export function correlateFlowAnomalies(rows, windowMinutes = 15) {
  const cutoff = Date.now() - windowMinutes * 60000, active = rows.filter(row => new Date(row.lastSeenAt).getTime() >= cutoff && !['resolved','suppressed'].includes(row.status));
  const remaining = new Set(active.map(row => row.id)), groups = [];
  for (const seed of active) {
    if (!remaining.has(seed.id)) continue;
    const members = [seed], queue = [seed]; remaining.delete(seed.id);
    while (queue.length) {
      const current = queue.shift();
      for (const candidate of active) {
        if (!remaining.has(candidate.id) || !flowCorrelationKind(current, candidate)) continue;
        remaining.delete(candidate.id); members.push(candidate); queue.push(candidate);
      }
    }
    if (members.length < 2) continue;
    const kinds = new Set();
    for (let i = 0; i < members.length; i++) for (let j = i + 1; j < members.length; j++) { const kind = flowCorrelationKind(members[i], members[j]); if (kind) kinds.add(kind); }
    const exporters = [...new Set(members.map(row => row.exporterName).filter(Boolean))], sources = [...new Set(members.map(row => row.sourceAddress).filter(Boolean))], destinations = [...new Set(members.map(row => row.destinationAddress).filter(Boolean))], kind = kinds.has('distributed') ? 'distributed' : kinds.has('multi_target') ? 'multi_target' : 'attack_chain';
    const anchor = [...members].sort((a,b) => new Date(a.firstSeenAt) - new Date(b.firstSeenAt))[0], risk = calculateFlowRisk(anchor, { relatedEvents: members.length, exporters: exporters.length, sources: sources.length });
    groups.push({ id: `corr:${anchor.id}`, kind, title: kind === 'distributed' ? 'Possível ataque distribuído' : kind === 'multi_target' ? 'Origem atuando em vários equipamentos' : 'Possível cadeia de ataque', riskScore: risk.score, riskLevel: risk.level, eventCount: members.length, exporters, sources, destinations, anomalyIds: members.map(row => row.id), firstSeenAt: new Date(Math.min(...members.map(row => new Date(row.firstSeenAt).getTime()))), lastSeenAt: new Date(Math.max(...members.map(row => new Date(row.lastSeenAt).getTime()))) });
  }
  return groups.sort((a,b) => b.riskScore - a.riskScore || new Date(b.lastSeenAt) - new Date(a.lastSeenAt));
}
