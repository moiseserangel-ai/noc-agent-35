import prisma from "../database/client.js";
import { decrypt } from "../utils/crypto.js";
import logger from "../utils/logger.js";
import dns from "node:dns/promises";
import crypto from "node:crypto";
import { addTaskMessage, createTask, updateTask } from "./task.service.js";
import {
  getNotificationConfig,
  notifyTask,
  retryNotificationLog,
  sendTelegramMessage,
} from "./notification.service.js";

const settingKeys = [
  "flow_inspector_url",
  "flow_inspector_user",
  "flow_inspector_password",
  "flow_learning_started_at",
];
const number = (value) => Number(value) || 0;
const stripV4 = (value) => String(value || "").replace(/^::ffff:/, "");
const sqlText = (value) => `'${String(value || "").replaceAll("'", "''")}'`;
const dnsCache = new Map();
async function reverseName(address) {
  const ip = stripV4(address),
    cached = dnsCache.get(ip);
  if (cached && cached.expires > Date.now()) return cached.name;
  let name = "";
  try {
    name =
      (
        await Promise.race([
          dns.reverse(ip),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("timeout")), 1200),
          ),
        ])
      )[0] || "";
  } catch {}
  dnsCache.set(ip, { name, expires: Date.now() + 6 * 3600000 });
  return name;
}
const privateAddress = (value) => {
  const ip = stripV4(value);
  return /^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\.|^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(
    ip,
  );
};
async function inventoryByAddress(values) {
  const addresses = [...new Set(values.map(stripV4).filter(Boolean))],
    result = new Map();
  if (!addresses.length) return result;
  const [devices, assignments] = await Promise.all([
    prisma.device.findMany({
      where: { hostname: { in: addresses } },
      select: {
        id: true,
        name: true,
        hostname: true,
        type: true,
        manufacturer: true,
        model: true,
        tenant: { select: { name: true } },
        site: { select: { name: true } },
        cmdbAsset: {
          select: {
            id: true,
            name: true,
            category: true,
            owner: true,
            contact: true,
            criticality: true,
          },
        },
      },
    }),
    prisma.ipamAddress.findMany({
      where: { address: { in: addresses }, status: { not: "available" } },
      select: {
        address: true,
        hostname: true,
        description: true,
        status: true,
        asset: {
          select: {
            id: true,
            name: true,
            category: true,
            owner: true,
            contact: true,
            criticality: true,
            tenant: { select: { name: true } },
            site: { select: { name: true } },
            device: {
              select: {
                id: true,
                name: true,
                type: true,
                manufacturer: true,
                model: true,
              },
            },
          },
        },
        subnet: { select: { name: true, cidr: true } },
      },
    }),
  ]);
  for (const device of devices)
    result.set(device.hostname, {
      matched: true,
      source: "device",
      name: device.cmdbAsset?.name || device.name,
      type: device.cmdbAsset?.category || device.type,
      owner: device.cmdbAsset?.owner || null,
      contact: device.cmdbAsset?.contact || null,
      criticality: device.cmdbAsset?.criticality || null,
      tenant: device.tenant?.name || null,
      site: device.site?.name || null,
      manufacturer: device.manufacturer || null,
      model: device.model || null,
    });
  for (const item of assignments) {
    const asset = item.asset;
    result.set(item.address, {
      matched: true,
      source: "ipam",
      name: asset?.name || item.hostname || item.description || item.address,
      type: asset?.category || "ipam",
      owner: asset?.owner || null,
      contact: asset?.contact || null,
      criticality: asset?.criticality || null,
      tenant: asset?.tenant?.name || null,
      site: asset?.site?.name || null,
      manufacturer: asset?.device?.manufacturer || null,
      model: asset?.device?.model || null,
      subnet: item.subnet?.cidr || null,
      subnetName: item.subnet?.name || null,
    });
  }
  for (const address of addresses)
    if (!result.has(address) && privateAddress(address))
      result.set(address, {
        matched: false,
        source: "private_unmanaged",
        name: "IP interno não cadastrado",
        type: "unknown",
      });
  return result;
}

async function config() {
  const rows = await prisma.settings.findMany({
      where: { key: { in: settingKeys } },
    }),
    data = Object.fromEntries(
      rows.map((row) => [
        row.key,
        row.encrypted ? decrypt(row.value) : row.value,
      ]),
    );
  return {
    url: String(
      data.flow_inspector_url || "http://192.168.250.66:8123",
    ).replace(/\/$/, ""),
    user: data.flow_inspector_user || "noc_agent",
    password: data.flow_inspector_password || "",
    learningStartedAt: data.flow_learning_started_at
      ? new Date(data.flow_learning_started_at)
      : null,
  };
}
async function query(sql) {
  const cfg = await config();
  if (!cfg.password)
    throw Object.assign(
      new Error("Integração do inspetor de tráfego não configurada"),
      { statusCode: 400 },
    );
  const response = await fetch(`${cfg.url}/?default_format=JSONEachRow`, {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`${cfg.user}:${cfg.password}`).toString("base64")}`,
      "content-type": "text/plain",
    },
    body: sql,
    signal: AbortSignal.timeout(15000),
  });
  const body = await response.text();
  if (!response.ok)
    throw new Error(
      `Flow Inspector HTTP ${response.status}: ${body.slice(0, 300)}`,
    );
  let rows = body.trim()
    ? body
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line))
    : [];
  if (
    /^SELECT\s+'(?:port_scan|tcp_flood|udp_flood|icmp_flood)'\s+type/i.test(
      String(sql).trim(),
    ) &&
    rows.length
  ) {
    const profiles = await getFlowSecurityProfiles([
      ...new Set(rows.map((row) => row.exporterName)),
    ]);
    rows = rows.filter((row) => {
      const profile = profiles[row.exporterName] || defaultSecurityProfile;
      return (
        meetsProfile(row, profile) &&
        !profile.trustedIps.includes(stripV4(row.sourceAddress)) &&
        !profile.trustedIps.includes(stripV4(row.destinationAddress))
      );
    });
  }
  return rows;
}

const summarySql = `SELECT IPv6NumToString(ExporterAddress) exporterAddress, ExporterName exporterName, count() flows, sum(Bytes) bytes, sum(Packets) packets, uniqExact(SrcAddr) uniqueSources, uniqExact(DstAddr) uniqueDestinations, argMax(IPv6NumToString(SrcAddr), Bytes) topSource, argMax(IPv6NumToString(DstAddr), Bytes) topDestination, argMax(DstPort, Bytes) topPort FROM default.flows WHERE TimeReceived >= now() - INTERVAL 5 MINUTE GROUP BY ExporterAddress, ExporterName ORDER BY bytes DESC`;

const detectorQueries = [
  `SELECT 'port_scan' type, ExporterName exporterName, IPv6NumToString(SrcAddr) sourceAddress, '' destinationAddress, Proto protocol, 0 port, count() flows, sum(Packets) packets, sum(Bytes) bytes, uniqExact(DstPort) distinctPorts, uniqExactIf(DstPort,DstPort<1024) privilegedPorts, uniqExact(DstAddr) distinctDestinations, uniqExactIf(DstAddr,DstPort NOT IN (53,80,123,443,853)) unusualDestinations FROM default.flows WHERE TimeReceived >= now()-INTERVAL 5 MINUTE AND SrcPort NOT IN (53,80,123,443,853,1900,5353) GROUP BY ExporterName, SrcAddr, Proto HAVING (privilegedPorts>=20 AND distinctPorts>=20) OR (unusualDestinations>=200 AND distinctPorts>=20) ORDER BY privilegedPorts+unusualDestinations DESC LIMIT 100`,
  `SELECT 'tcp_flood' type, ExporterName exporterName, IPv6NumToString(SrcAddr) sourceAddress, IPv6NumToString(DstAddr) destinationAddress, Proto protocol, DstPort port, count() flows, sum(Packets) packets, sum(Bytes) bytes, uniqExact(DstPort) distinctPorts, uniqExact(DstAddr) distinctDestinations FROM default.flows WHERE TimeReceived >= now()-INTERVAL 5 MINUTE AND Proto=6 GROUP BY ExporterName, SrcAddr, DstAddr, Proto, DstPort HAVING packets>=200000 OR flows>=5000 ORDER BY packets DESC LIMIT 100`,
  `SELECT 'udp_flood' type, ExporterName exporterName, IPv6NumToString(SrcAddr) sourceAddress, IPv6NumToString(DstAddr) destinationAddress, Proto protocol, DstPort port, count() flows, sum(Packets) packets, sum(Bytes) bytes, uniqExact(DstPort) distinctPorts, uniqExact(DstAddr) distinctDestinations FROM default.flows WHERE TimeReceived >= now()-INTERVAL 5 MINUTE AND Proto=17 GROUP BY ExporterName, SrcAddr, DstAddr, Proto, DstPort HAVING packets>=200000 OR bytes>=500000000 ORDER BY packets DESC LIMIT 100`,
  `SELECT 'icmp_flood' type, ExporterName exporterName, IPv6NumToString(SrcAddr) sourceAddress, IPv6NumToString(DstAddr) destinationAddress, Proto protocol, 0 port, count() flows, sum(Packets) packets, sum(Bytes) bytes, 0 distinctPorts, uniqExact(DstAddr) distinctDestinations FROM default.flows WHERE TimeReceived >= now()-INTERVAL 5 MINUTE AND Proto IN (1,58) GROUP BY ExporterName, SrcAddr, DstAddr, Proto HAVING packets>=50000 OR bytes>=100000000 ORDER BY packets DESC LIMIT 100`,
  `SELECT 'amplification' type, ExporterName exporterName, IPv6NumToString(SrcAddr) sourceAddress, IPv6NumToString(DstAddr) destinationAddress, Proto protocol, SrcPort port, count() flows, sum(Packets) packets, sum(Bytes) bytes, uniqExact(DstPort) distinctPorts, uniqExact(DstAddr) distinctDestinations FROM default.flows WHERE TimeReceived >= now()-INTERVAL 5 MINUTE AND Proto=17 AND SrcPort IN (53,123,1900,11211,389,19) GROUP BY ExporterName, SrcAddr, DstAddr, Proto, SrcPort HAVING bytes>=100000000 OR packets>=100000 ORDER BY bytes DESC LIMIT 100`,
];
const defaultSecurityProfile = {
  volumeMultiplier: 3,
  criticalMultiplier: 6,
  scanPorts: 20,
  scanDestinations: 200,
  tcpPackets: 200000,
  tcpFlows: 5000,
  udpPackets: 200000,
  udpBytes: 500000000,
  icmpPackets: 50000,
  icmpBytes: 100000000,
  confirmationCount: 2,
  trustedIps: [],
};
const profileKey = "flow_security_profiles";
const customRuleKey = "flow_custom_rules";
const silenceKey = "flow_silence_windows";
const recurrenceKey = "flow_recurrence_minutes";
const exporterHealthKey = "flow_exporter_health";
const retentionKey = "flow_retention_policy";
const retentionRunKey = "flow_retention_last_run";
const cleanProfile = (value) => ({
  volumeMultiplier: Math.max(
    1.5,
    Math.min(20, number(value?.volumeMultiplier) || 3),
  ),
  criticalMultiplier: Math.max(
    3,
    Math.min(40, number(value?.criticalMultiplier) || 6),
  ),
  scanPorts: Math.max(
    5,
    Math.min(1000, Math.round(number(value?.scanPorts) || 20)),
  ),
  scanDestinations: Math.max(
    20,
    Math.min(10000, Math.round(number(value?.scanDestinations) || 200)),
  ),
  tcpPackets: Math.max(10000, Math.round(number(value?.tcpPackets) || 200000)),
  tcpFlows: Math.max(500, Math.round(number(value?.tcpFlows) || 5000)),
  udpPackets: Math.max(10000, Math.round(number(value?.udpPackets) || 200000)),
  udpBytes: Math.max(
    10000000,
    Math.round(number(value?.udpBytes) || 500000000),
  ),
  icmpPackets: Math.max(5000, Math.round(number(value?.icmpPackets) || 50000)),
  icmpBytes: Math.max(
    1000000,
    Math.round(number(value?.icmpBytes) || 100000000),
  ),
  confirmationCount: Math.max(
    2,
    Math.min(6, Math.round(number(value?.confirmationCount) || 2)),
  ),
  trustedIps: [
    ...new Set(
      (Array.isArray(value?.trustedIps)
        ? value.trustedIps
        : String(value?.trustedIps || "").split(/[\s,;]+/)
      )
        .map(stripV4)
        .filter((ip) => /^[0-9a-fA-F:.]+$/.test(ip)),
    ),
  ].slice(0, 200),
});
async function storedProfiles() {
  const row = await prisma.settings.findUnique({ where: { key: profileKey } });
  try {
    return JSON.parse(row?.value || "{}");
  } catch {
    return {};
  }
}
export async function getFlowSecurityProfiles(exporters = []) {
  const stored = await storedProfiles();
  return Object.fromEntries(
    exporters.map((name) => [
      name,
      cleanProfile({ ...defaultSecurityProfile, ...stored[name] }),
    ]),
  );
}
export async function saveFlowSecurityProfile(exporterName, input) {
  const name = String(exporterName || "")
    .trim()
    .slice(0, 120);
  if (!name)
    throw Object.assign(new Error("Informe o exportador"), { statusCode: 400 });
  const stored = await storedProfiles(),
    profile = cleanProfile(input);
  stored[name] = profile;
  await prisma.settings.upsert({
    where: { key: profileKey },
    update: { value: JSON.stringify(stored), encrypted: false },
    create: {
      key: profileKey,
      value: JSON.stringify(stored),
      encrypted: false,
    },
  });
  return { exporterName: name, ...profile };
}
const meetsProfile = (row, p) =>
  row.type === "port_scan"
    ? (number(row.privilegedPorts) >= p.scanPorts &&
        number(row.distinctPorts) >= p.scanPorts) ||
      (number(row.unusualDestinations) >= p.scanDestinations &&
        number(row.distinctPorts) >= p.scanPorts)
    : row.type === "tcp_flood"
      ? number(row.packets) >= p.tcpPackets || number(row.flows) >= p.tcpFlows
      : row.type === "udp_flood"
        ? number(row.packets) >= p.udpPackets || number(row.bytes) >= p.udpBytes
        : row.type === "icmp_flood"
          ? number(row.packets) >= p.icmpPackets ||
            number(row.bytes) >= p.icmpBytes
          : true;
const cleanRule = (value, id = value?.id || crypto.randomUUID()) => ({
  id,
  name: String(value?.name || "Regra personalizada")
    .trim()
    .slice(0, 100),
  enabled: value?.enabled !== false,
  exporterName: String(value?.exporterName || "")
    .trim()
    .slice(0, 120),
  protocol: ["tcp", "udp", "icmp", "icmpv6"].includes(
    String(value?.protocol || "").toLowerCase(),
  )
    ? String(value.protocol).toLowerCase()
    : "",
  destinationPort: Math.max(
    0,
    Math.min(65535, Math.round(number(value?.destinationPort))),
  ),
  sourceAddress: String(value?.sourceAddress || "")
    .trim()
    .slice(0, 80),
  destinationAddress: String(value?.destinationAddress || "")
    .trim()
    .slice(0, 80),
  sourceCountry: String(value?.sourceCountry || "")
    .trim()
    .toUpperCase()
    .slice(0, 2),
  destinationCountry: String(value?.destinationCountry || "")
    .trim()
    .toUpperCase()
    .slice(0, 2),
  minBytes: Math.max(0, Math.round(number(value?.minBytes))),
  severity: ["warning", "critical"].includes(value?.severity)
    ? value.severity
    : "warning",
  priority: ["medium", "high", "critical"].includes(value?.priority)
    ? value.priority
    : value?.severity === "critical"
      ? "critical"
      : "high",
  notificationMode: ["panel", "task", "telegram", "task_telegram"].includes(
    value?.notificationMode,
  )
    ? value.notificationMode
    : "task",
  telegramChatId: String(value?.telegramChatId || "")
    .trim()
    .slice(0, 80),
  confirmationCount: Math.max(
    2,
    Math.min(6, Math.round(number(value?.confirmationCount) || 2)),
  ),
  recurrenceMinutes: Math.max(
    0,
    Math.min(10080, Math.round(number(value?.recurrenceMinutes))),
  ),
});

export async function getFlowRecurrenceConfig() {
  const row = await prisma.settings.findUnique({
    where: { key: recurrenceKey },
  });
  return {
    minutes: Math.max(5, Math.min(10080, Math.round(number(row?.value) || 60))),
  };
}
export async function saveFlowRecurrenceConfig(input) {
  const value = Math.max(
    5,
    Math.min(10080, Math.round(number(input?.minutes) || 60)),
  );
  await prisma.settings.upsert({
    where: { key: recurrenceKey },
    update: { value: String(value), encrypted: false },
    create: { key: recurrenceKey, value: String(value), encrypted: false },
  });
  return { minutes: value };
}
const cleanExporterHealth = (value) => ({
  enabled: value?.enabled !== false,
  timeoutMinutes: Math.max(
    5,
    Math.min(1440, Math.round(number(value?.timeoutMinutes) || 15)),
  ),
  notificationMode: ["panel", "task", "task_telegram"].includes(
    value?.notificationMode,
  )
    ? value.notificationMode
    : "task",
});
export async function getFlowExporterHealthConfig() {
  const row = await prisma.settings.findUnique({
    where: { key: exporterHealthKey },
  });
  try {
    return cleanExporterHealth(JSON.parse(row?.value || "{}"));
  } catch {
    return cleanExporterHealth({});
  }
}
export async function saveFlowExporterHealthConfig(input) {
  const value = cleanExporterHealth(input);
  await prisma.settings.upsert({
    where: { key: exporterHealthKey },
    update: { value: JSON.stringify(value), encrypted: false },
    create: {
      key: exporterHealthKey,
      value: JSON.stringify(value),
      encrypted: false,
    },
  });
  return value;
}
const cleanRetention = (value) => ({
  metricsDays: Math.max(
    7,
    Math.min(365, Math.round(number(value?.metricsDays) || 30)),
  ),
  anomaliesDays: Math.max(
    30,
    Math.min(1095, Math.round(number(value?.anomaliesDays) || 180)),
  ),
  notificationsDays: Math.max(
    30,
    Math.min(1095, Math.round(number(value?.notificationsDays) || 180)),
  ),
  silencesDays: Math.max(
    30,
    Math.min(1095, Math.round(number(value?.silencesDays) || 180)),
  ),
  rawFlowsDays: Math.max(
    1,
    Math.min(90, Math.round(number(value?.rawFlowsDays) || 15)),
  ),
});
export async function getFlowRetentionPolicy() {
  const row = await prisma.settings.findUnique({
    where: { key: retentionKey },
  });
  try {
    return cleanRetention(JSON.parse(row?.value || "{}"));
  } catch {
    return cleanRetention({});
  }
}
export async function saveFlowRetentionPolicy(input) {
  const value = cleanRetention(input);
  await prisma.settings.upsert({
    where: { key: retentionKey },
    update: { value: JSON.stringify(value), encrypted: false },
    create: {
      key: retentionKey,
      value: JSON.stringify(value),
      encrypted: false,
    },
  });
  return value;
}
async function retentionCounts(policy) {
  const now = Date.now(),
    tasks = await prisma.task.findMany({
      where: { source: "flow_inspector" },
      select: { id: true },
    }),
    taskIds = tasks.map((row) => row.id),
    [metrics, anomalies, notifications, silences, raw] = await Promise.all([
      prisma.flowMetricSnapshot.count({
        where: {
          collectedAt: { lt: new Date(now - policy.metricsDays * 86400000) },
        },
      }),
      prisma.flowAnomaly.count({
        where: {
          lastSeenAt: { lt: new Date(now - policy.anomaliesDays * 86400000) },
          status: { in: ["resolved", "suppressed"] },
        },
      }),
      prisma.notificationLog.count({
        where: {
          createdAt: {
            lt: new Date(now - policy.notificationsDays * 86400000),
          },
          OR: [{ resourceType: "flow_anomaly" }, { taskId: { in: taskIds } }],
        },
      }),
      storedSilences().then(
        (rows) =>
          rows.filter(
            (row) =>
              new Date(row.endsAt).getTime() <
              now - policy.silencesDays * 86400000,
          ).length,
      ),
      query(
        `SELECT count() count FROM default.flows WHERE TimeReceived < now() - INTERVAL ${policy.rawFlowsDays} DAY`,
      ).then((rows) => number(rows[0]?.count)),
    ]);
  return { metrics, anomalies, notifications, silences, rawFlows: raw };
}
export async function previewFlowRetention() {
  const policy = await getFlowRetentionPolicy();
  return { policy, counts: await retentionCounts(policy) };
}
export async function executeFlowRetention({ automatic = false } = {}) {
  const policy = await getFlowRetentionPolicy(),
    counts = await retentionCounts(policy),
    now = Date.now();
  await prisma.flowMetricSnapshot.deleteMany({
    where: {
      collectedAt: { lt: new Date(now - policy.metricsDays * 86400000) },
    },
  });
  await prisma.flowAnomaly.deleteMany({
    where: {
      lastSeenAt: { lt: new Date(now - policy.anomaliesDays * 86400000) },
      status: { in: ["resolved", "suppressed"] },
    },
  });
  const tasks = await prisma.task.findMany({
    where: { source: "flow_inspector" },
    select: { id: true },
  });
  await prisma.notificationLog.deleteMany({
    where: {
      createdAt: { lt: new Date(now - policy.notificationsDays * 86400000) },
      OR: [
        { resourceType: "flow_anomaly" },
        { taskId: { in: tasks.map((row) => row.id) } },
      ],
    },
  });
  const silences = await storedSilences();
  await persistSilences(
    silences.filter(
      (row) =>
        new Date(row.endsAt).getTime() >= now - policy.silencesDays * 86400000,
    ),
  );
  if (counts.rawFlows > 0)
    await query(
      `ALTER TABLE default.flows DELETE WHERE TimeReceived < now() - INTERVAL ${policy.rawFlowsDays} DAY`,
    );
  await prisma.settings.upsert({
    where: { key: retentionRunKey },
    update: { value: new Date().toISOString(), encrypted: false },
    create: {
      key: retentionRunKey,
      value: new Date().toISOString(),
      encrypted: false,
    },
  });
  logger.info(
    `Retenção NetFlow ${automatic ? "automática" : "manual"}: ${JSON.stringify(counts)}`,
  );
  return { policy, deleted: counts };
}
async function maybeRunFlowRetention() {
  const row = await prisma.settings.findUnique({
      where: { key: retentionRunKey },
    }),
    last = row?.value ? new Date(row.value).getTime() : 0;
  if (Date.now() - last < 86400000) return null;
  return executeFlowRetention({ automatic: true });
}
async function storedCustomRules() {
  const row = await prisma.settings.findUnique({
    where: { key: customRuleKey },
  });
  try {
    return JSON.parse(row?.value || "[]").map((item) =>
      cleanRule(item, item.id),
    );
  } catch {
    return [];
  }
}
export async function listFlowCustomRules() {
  return storedCustomRules();
}
export async function saveFlowCustomRule(input) {
  const rows = await storedCustomRules(),
    rule = cleanRule(input),
    index = rows.findIndex((item) => item.id === rule.id);
  if (index >= 0) rows[index] = rule;
  else rows.push(rule);
  await prisma.settings.upsert({
    where: { key: customRuleKey },
    update: { value: JSON.stringify(rows), encrypted: false },
    create: {
      key: customRuleKey,
      value: JSON.stringify(rows),
      encrypted: false,
    },
  });
  return rule;
}
export async function deleteFlowCustomRule(id) {
  const rows = await storedCustomRules(),
    next = rows.filter((item) => item.id !== id);
  if (next.length === rows.length)
    throw Object.assign(new Error("Regra não encontrada"), { statusCode: 404 });
  await prisma.settings.upsert({
    where: { key: customRuleKey },
    update: { value: JSON.stringify(next), encrypted: false },
    create: {
      key: customRuleKey,
      value: JSON.stringify(next),
      encrypted: false,
    },
  });
  return { id };
}

const cleanSilence = (value, id = value?.id || crypto.randomUUID()) => {
  const startsAt = new Date(value?.startsAt);
  const endsAt = new Date(value?.endsAt);
  if (
    Number.isNaN(startsAt.getTime()) ||
    Number.isNaN(endsAt.getTime()) ||
    endsAt <= startsAt
  )
    throw Object.assign(
      new Error("Informe um período de silenciamento válido"),
      { statusCode: 400 },
    );
  const reason = String(value?.reason || "")
    .trim()
    .slice(0, 300);
  if (!reason)
    throw Object.assign(new Error("Informe o motivo do silenciamento"), {
      statusCode: 400,
    });
  return {
    id,
    enabled: value?.enabled !== false,
    exporterName: String(value?.exporterName || "")
      .trim()
      .slice(0, 120),
    ruleId: String(value?.ruleId || "")
      .trim()
      .slice(0, 80),
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    reason,
    createdBy: String(value?.createdBy || "").slice(0, 100),
    createdAt: value?.createdAt || new Date().toISOString(),
  };
};
async function storedSilences() {
  const row = await prisma.settings.findUnique({ where: { key: silenceKey } });
  try {
    return JSON.parse(row?.value || "[]").map((item) =>
      cleanSilence(item, item.id),
    );
  } catch {
    return [];
  }
}
async function persistSilences(rows) {
  await prisma.settings.upsert({
    where: { key: silenceKey },
    update: { value: JSON.stringify(rows), encrypted: false },
    create: { key: silenceKey, value: JSON.stringify(rows), encrypted: false },
  });
}
export async function listFlowSilences() {
  return (await storedSilences()).sort(
    (a, b) => new Date(b.startsAt) - new Date(a.startsAt),
  );
}
export async function saveFlowSilence(input, username) {
  const rows = await storedSilences(),
    silence = cleanSilence({
      ...input,
      createdBy: input?.createdBy || username,
    }),
    index = rows.findIndex((item) => item.id === silence.id);
  if (index >= 0) rows[index] = silence;
  else rows.push(silence);
  await persistSilences(rows);
  return silence;
}
export async function deleteFlowSilence(id) {
  const rows = await storedSilences(),
    next = rows.filter((item) => item.id !== id);
  if (next.length === rows.length)
    throw Object.assign(new Error("Silenciamento não encontrado"), {
      statusCode: 404,
    });
  await persistSilences(next);
  return { id };
}
async function activeSilenceFor(row) {
  const now = Date.now();
  return (await storedSilences()).find(
    (item) =>
      item.enabled &&
      new Date(item.startsAt).getTime() <= now &&
      new Date(item.endsAt).getTime() >= now &&
      (!item.exporterName || item.exporterName === row.exporterName) &&
      (!item.ruleId || row.type === `custom_rule:${item.ruleId}`),
  );
}
const reportDays = (value) =>
  Math.max(1, Math.min(90, Math.round(number(value) || 7)));
export async function flowSecurityReport(input = {}) {
  const days = reportDays(input.days),
    where = { lastSeenAt: { gte: new Date(Date.now() - days * 86400000) } };
  if (input.exporterName) where.exporterName = String(input.exporterName);
  if (input.type) where.type = String(input.type);
  if (input.severity) where.severity = String(input.severity);
  if (input.classification) where.classification = String(input.classification);
  const rows = await prisma.flowAnomaly.findMany({
      where,
      orderBy: { lastSeenAt: "desc" },
      take: 2000,
    }),
    countBy = (field) =>
      Object.entries(
        rows.reduce((map, row) => {
          const key = row[field] || "não informado";
          map[key] = (map[key] || 0) + 1;
          return map;
        }, {}),
      )
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count),
    timeline = Object.values(
      rows.reduce((map, row) => {
        const day = row.lastSeenAt.toISOString().slice(0, 10);
        map[day] ||= {
          day,
          collectedAt: `${day}T12:00:00.000Z`,
          total: 0,
          critical: 0,
          confirmed: 0,
          resolved: 0,
          recurrence: 0,
        };
        map[day].total++;
        if (row.severity === "critical") map[day].critical++;
        if (row.status === "confirmed" || row.classification === "attack")
          map[day].confirmed++;
        if (row.status === "resolved" || row.status === "suppressed")
          map[day].resolved++;
        if (row.resolution?.startsWith("Recorrência controlada:"))
          map[day].recurrence++;
        return map;
      }, {}),
    ).sort((a, b) => a.day.localeCompare(b.day));
  return {
    days,
    summary: {
      total: rows.length,
      critical: rows.filter((row) => row.severity === "critical").length,
      confirmed: rows.filter(
        (row) => row.status === "confirmed" || row.classification === "attack",
      ).length,
      resolved: rows.filter(
        (row) => row.status === "resolved" || row.status === "suppressed",
      ).length,
      automatic: rows.filter((row) =>
        row.resolution?.includes("automaticamente"),
      ).length,
      attacks: rows.filter((row) => row.classification === "attack").length,
      falsePositives: rows.filter(
        (row) => row.classification === "false_positive",
      ).length,
      legitimate: rows.filter((row) => row.classification === "legitimate")
        .length,
      recurrence: rows.filter((row) =>
        row.resolution?.startsWith("Recorrência controlada:"),
      ).length,
    },
    byExporter: countBy("exporterName"),
    byType: countBy("type"),
    bySeverity: countBy("severity"),
    byProtocol: countBy("protocol"),
    byStatus: countBy("status"),
    byClassification: countBy("classification"),
    topSources: countBy("sourceAddress").slice(0, 10),
    timeline,
    rows: rows.slice(0, 500),
  };
}
const csvCell = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
export async function flowSecurityCsv(input = {}) {
  const report = await flowSecurityReport(input),
    header = [
      "Data",
      "Equipamento",
      "Tipo",
      "Severidade",
      "Status",
      "Origem",
      "Destino",
      "Protocolo",
      "Porta",
      "Título",
      "Resolução",
    ],
    lines = report.rows.map((row) =>
      [
        row.lastSeenAt.toISOString(),
        row.exporterName,
        row.type,
        row.severity,
        row.status,
        row.sourceAddress,
        row.destinationAddress,
        row.protocol,
        row.port,
        row.title,
        row.resolution,
      ]
        .map(csvCell)
        .join(";"),
    );
  return Buffer.from(
    `\uFEFF${header.map(csvCell).join(";")}\n${lines.join("\n")}`,
    "utf8",
  );
}
async function customRuleRows() {
  const rules = (await storedCustomRules()).filter((rule) => rule.enabled),
    proto = { tcp: 6, udp: 17, icmp: 1, icmpv6: 58 },
    groups = await Promise.all(
      rules.map(async (rule) => {
        const where = ["TimeReceived>=now()-INTERVAL 5 MINUTE"];
        if (rule.exporterName)
          where.push(`ExporterName=${sqlText(rule.exporterName)}`);
        if (rule.protocol) where.push(`Proto=${proto[rule.protocol]}`);
        if (rule.destinationPort) where.push(`DstPort=${rule.destinationPort}`);
        if (rule.sourceAddress)
          where.push(
            `IPv6NumToString(SrcAddr) IN (${sqlText(rule.sourceAddress)},${sqlText(`::ffff:${rule.sourceAddress}`)})`,
          );
        if (rule.destinationAddress)
          where.push(
            `IPv6NumToString(DstAddr) IN (${sqlText(rule.destinationAddress)},${sqlText(`::ffff:${rule.destinationAddress}`)})`,
          );
        if (rule.sourceCountry)
          where.push(`SrcCountry=${sqlText(rule.sourceCountry)}`);
        if (rule.destinationCountry)
          where.push(`DstCountry=${sqlText(rule.destinationCountry)}`);
        const rows = await query(
          `SELECT ${sqlText(`custom_rule:${rule.id}`)} type, ExporterName exporterName, IPv6NumToString(SrcAddr) sourceAddress, IPv6NumToString(DstAddr) destinationAddress, Proto protocol, DstPort port, count() flows, sum(Packets) packets, sum(Bytes) bytes, 0 distinctPorts, 0 distinctDestinations FROM default.flows WHERE ${where.join(" AND ")} GROUP BY ExporterName,SrcAddr,DstAddr,Proto,DstPort HAVING bytes>=${rule.minBytes} ORDER BY bytes DESC LIMIT 20`,
        );
        return rows.map((row) => ({
          ...row,
          customTitle: rule.name,
          customSeverity: rule.severity,
          priority: rule.priority,
          notificationMode: rule.notificationMode,
          telegramChatId: rule.telegramChatId,
          confirmationCount: rule.confirmationCount,
          recurrenceMinutes: rule.recurrenceMinutes,
        }));
      }),
    );
  return groups.flat();
}
export async function testFlowCustomRule(input) {
  const rule = cleanRule(input, input?.id || "preview"),
    proto = { tcp: 6, udp: 17, icmp: 1, icmpv6: 58 },
    where = ["TimeReceived>=now()-INTERVAL 5 MINUTE"];
  if (rule.exporterName)
    where.push(`ExporterName=${sqlText(rule.exporterName)}`);
  if (rule.protocol) where.push(`Proto=${proto[rule.protocol]}`);
  if (rule.destinationPort) where.push(`DstPort=${rule.destinationPort}`);
  if (rule.sourceAddress)
    where.push(
      `IPv6NumToString(SrcAddr) IN (${sqlText(rule.sourceAddress)},${sqlText(`::ffff:${rule.sourceAddress}`)})`,
    );
  if (rule.destinationAddress)
    where.push(
      `IPv6NumToString(DstAddr) IN (${sqlText(rule.destinationAddress)},${sqlText(`::ffff:${rule.destinationAddress}`)})`,
    );
  if (rule.sourceCountry)
    where.push(`SrcCountry=${sqlText(rule.sourceCountry)}`);
  if (rule.destinationCountry)
    where.push(`DstCountry=${sqlText(rule.destinationCountry)}`);
  const raw = await query(
    `SELECT ExporterName exporterName, IPv6NumToString(SrcAddr) sourceAddress, IPv6NumToString(DstAddr) destinationAddress, Proto protocol, DstPort port, count() flows, sum(Packets) packets, sum(Bytes) bytes FROM default.flows WHERE ${where.join(" AND ")} GROUP BY ExporterName,SrcAddr,DstAddr,Proto,DstPort HAVING bytes>=${rule.minBytes} ORDER BY bytes DESC LIMIT 20`,
  );
  const rows = raw.map((row) => ({
    ...row,
    sourceAddress: stripV4(row.sourceAddress),
    destinationAddress: stripV4(row.destinationAddress),
    protocol: protocolName(row.protocol),
    port: number(row.port) || null,
    flows: number(row.flows),
    packets: number(row.packets),
    bytes: number(row.bytes),
  }));
  return {
    matches: rows.length,
    flows: rows.reduce((sum, row) => sum + row.flows, 0),
    packets: rows.reduce((sum, row) => sum + row.packets, 0),
    bytes: rows.reduce((sum, row) => sum + row.bytes, 0),
    rows,
    windowMinutes: 5,
  };
}
const protocolName = (value) =>
  ({ 1: "ICMP", 6: "TCP", 17: "UDP", 58: "ICMPv6" })[number(value)] ||
  String(value || "IP");
const threatMeta = (row) => {
  const common = { severity: "warning", confidence: 75 };
  if (String(row.type).startsWith("custom_rule:"))
    return {
      severity: row.customSeverity || "warning",
      confidence: 90,
      title: row.customTitle || "Regra personalizada acionada",
      description: `A regra personalizada encontrou ${integerText(row.flows)} fluxos e ${integerText(row.bytes)} bytes nos últimos cinco minutos.`,
    };
  if (row.type === "port_scan")
    return {
      ...common,
      title: `Possível varredura originada por ${row.sourceAddress}`,
      description: `${integerText(row.distinctPorts)} portas e ${integerText(row.distinctDestinations)} destinos observados em cinco minutos.`,
    };
  if (row.type === "tcp_flood")
    return {
      severity: number(row.packets) >= 1_000_000 ? "critical" : "warning",
      confidence: 65,
      title: `Possível flood TCP para ${row.destinationAddress}`,
      description: `${integerText(row.packets)} pacotes TCP direcionados à porta ${row.port} em cinco minutos. A ausência de flags TCP no NetFlow impede confirmar SYN flood.`,
    };
  if (row.type === "udp_flood")
    return {
      severity: number(row.packets) >= 1_000_000 ? "critical" : "warning",
      confidence: 82,
      title: `Possível flood UDP para ${row.destinationAddress}`,
      description: `${integerText(row.packets)} pacotes e ${integerText(row.bytes)} bytes UDP direcionados à porta ${row.port}.`,
    };
  if (row.type === "icmp_flood")
    return {
      severity: number(row.packets) >= 250_000 ? "critical" : "warning",
      confidence: 88,
      title: `Possível flood ${protocolName(row.protocol)} para ${row.destinationAddress}`,
      description: `${integerText(row.packets)} pacotes observados em cinco minutos.`,
    };
  return {
    severity: "critical",
    confidence: 88,
    title: `Possível amplificação UDP pela porta ${row.port}`,
    description: `Resposta volumétrica de protocolo amplificável: ${integerText(row.bytes)} bytes e ${integerText(row.packets)} pacotes.`,
  };
};
const integerText = (value) => number(value).toLocaleString("pt-BR");

const openTaskStatuses = [
  "pending",
  "diagnosing",
  "awaiting_approval",
  "executing",
  "open",
  "acknowledged",
  "in_progress",
];
async function deliverCustomWithoutTask(anomaly, row, meta) {
  if (
    !String(row.type).startsWith("custom_rule:") ||
    !["panel", "telegram"].includes(row.notificationMode) ||
    anomaly.consecutiveCount < number(row.confirmationCount || 2) ||
    anomaly.status !== "observed"
  )
    return false;
  await prisma.flowAnomaly.update({
    where: { id: anomaly.id },
    data: { status: "confirmed" },
  });
  if (row.notificationMode === "telegram") {
    const cfg = await getNotificationConfig(),
      recipients = row.telegramChatId
        ? [row.telegramChatId]
        : cfg.telegramChats,
      text = [
        row.customSeverity === "critical"
          ? "🚨 Regra NetFlow crítica"
          : "⚠️ Regra NetFlow",
        meta.title,
        `Equipamento: ${row.exporterName}`,
        `Origem: ${stripV4(row.sourceAddress) || "não identificada"}`,
        `Destino: ${stripV4(row.destinationAddress) || "não identificado"}`,
        `Protocolo/porta: ${protocolName(row.protocol)}${number(row.port) ? `/${row.port}` : ""}`,
        meta.description,
      ].join("\n");
    for (const recipient of recipients) {
      let status = "sent",
        error = null;
      try {
        await sendTelegramMessage(recipient, text, cfg.telegramToken);
      } catch (cause) {
        status = "failed";
        error = cause.message;
        logger.warn(
          `Notificação Telegram da regra NetFlow falhou: ${cause.message}`,
        );
      }
      await prisma.notificationLog
        .create({
          data: {
            event: "flow_custom_rule",
            channel: "telegram",
            recipient,
            status,
            error: error?.slice(0, 1000) || null,
            title: meta.title,
            message: text,
            priority: row.priority || row.customSeverity,
            resourceType: "flow_anomaly",
            resourceId: anomaly.id,
            dedupKey: `flow:${anomaly.id}:telegram:${recipient}`,
          },
        })
        .catch((cause) => {
          if (cause.code !== "P2002")
            logger.warn(`Falha ao registrar entrega NetFlow: ${cause.message}`);
        });
    }
  }
  return true;
}
export async function listFlowNotifications(limit = 100) {
  const tasks = await prisma.task.findMany({
      where: { source: "flow_inspector" },
      select: { id: true },
    }),
    taskIds = tasks.map((row) => row.id);
  return prisma.notificationLog.findMany({
    where: {
      OR: [{ resourceType: "flow_anomaly" }, { taskId: { in: taskIds } }],
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(300, Math.max(10, number(limit) || 100)),
  });
}
export async function retryFlowNotification(id, username) {
  const row = await prisma.notificationLog.findUnique({ where: { id } });
  if (!row)
    throw Object.assign(new Error("Notificação não encontrada"), {
      statusCode: 404,
    });
  const flowTask = row.taskId
    ? await prisma.task.findFirst({
        where: { id: row.taskId, source: "flow_inspector" },
        select: { id: true },
      })
    : null;
  if (row.resourceType !== "flow_anomaly" && !flowTask)
    throw Object.assign(
      new Error("Notificação não pertence ao inspetor de tráfego"),
      { statusCode: 403 },
    );
  return retryNotificationLog(id, username);
}
async function resolveMissingThreats(seen) {
  const active = await prisma.flowAnomaly.findMany({
    where: {
      status: { in: ["observed", "confirmed"] },
      type: { not: "exporter_offline" },
    },
  });
  for (const anomaly of active) {
    if (seen.has(anomaly.incidentKey)) continue;
    const recoveryCount = anomaly.recoveryCount + 1;
    if (recoveryCount < 2) {
      await prisma.flowAnomaly.update({
        where: { id: anomaly.id },
        data: { recoveryCount },
      });
      continue;
    }
    const now = new Date(),
      resolution =
        "Evento não foi detectado em duas coletas consecutivas; normalização confirmada automaticamente.";
    await prisma.flowAnomaly.update({
      where: { id: anomaly.id },
      data: { status: "resolved", recoveryCount, resolution },
    });
    if (anomaly.taskId) {
      const task = await prisma.task.findUnique({
        where: { id: anomaly.taskId },
      });
      if (task && openTaskStatuses.includes(task.status)) {
        const updated = await updateTask(task.id, {
          status: "resolved",
          resolvedAt: now,
          validatedAt: now,
          resolutionType: "flow_automatic",
          resolutionSummary: resolution,
        });
        await addTaskMessage(task.id, "system", resolution);
        await notifyTask(updated, "resolved", { message: resolution }).catch(
          () => {},
        );
      }
    }
  }
}
async function detectThreats() {
  const groups = await Promise.all(detectorQueries.map((sql) => query(sql))),
    rows = [...groups.flat(), ...(await customRuleRows())],
    inventory = await inventoryByAddress(
      rows.flatMap((row) => [row.sourceAddress, row.destinationAddress]),
    ),
    seen = new Set(),
    recurrenceConfig = await getFlowRecurrenceConfig();
  let stored = 0;
  for (const raw of rows) {
    const row = {
        ...raw,
        sourceAddress: stripV4(raw.sourceAddress),
        destinationAddress: stripV4(raw.destinationAddress),
        protocol: protocolName(raw.protocol),
        port: number(raw.port) || null,
        flows: number(raw.flows),
        packets: number(raw.packets),
        bytes: number(raw.bytes),
      },
      sourceIdentity = inventory.get(row.sourceAddress) || null,
      destinationIdentity = inventory.get(row.destinationAddress) || null,
      meta = threatMeta(row),
      incidentKey = `${row.exporterName}:${row.type}:${row.sourceAddress}:${row.destinationAddress}:${row.port || 0}`,
      evidence = JSON.stringify({
        ...raw,
        sourceIdentity,
        destinationIdentity,
      });
    seen.add(incidentKey);
    const suppressed = await prisma.flowAnomaly.findFirst({
      where: {
        incidentKey,
        classification: { in: ["false_positive", "legitimate"] },
        classifiedAt: { gte: new Date(Date.now() - 30 * 86400000) },
      },
    });
    if (suppressed) continue;
    const silence = await activeSilenceFor(row);
    if (silence) {
      const resolution = `Silenciado por janela de manutenção: ${silence.reason}`;
      const existingSilenced = await prisma.flowAnomaly.findFirst({
        where: {
          incidentKey,
          status: "suppressed",
          resolution,
          lastSeenAt: { gte: new Date(silence.startsAt) },
        },
        orderBy: { lastSeenAt: "desc" },
      });
      if (existingSilenced)
        await prisma.flowAnomaly.update({
          where: { id: existingSilenced.id },
          data: {
            lastSeenAt: new Date(),
            ...meta,
            flows: row.flows,
            packets: row.packets,
            bytes: row.bytes,
            evidence,
          },
        });
      else
        await prisma.flowAnomaly.create({
          data: {
            fingerprint: `${incidentKey}:silenced:${silence.id}`,
            incidentKey,
            exporterAddress: "",
            exporterName: row.exporterName,
            type: row.type,
            ...meta,
            sourceAddress: row.sourceAddress || null,
            destinationAddress: row.destinationAddress || null,
            protocol: row.protocol,
            port: row.port,
            flows: row.flows,
            packets: row.packets,
            bytes: row.bytes,
            evidence,
            status: "suppressed",
            resolution,
            firstSeenAt: new Date(),
            lastSeenAt: new Date(),
          },
        });
      stored++;
      continue;
    }
    const recurrenceMinutes = Math.max(
        5,
        number(row.recurrenceMinutes) || recurrenceConfig.minutes,
      ),
      recurrenceCutoff = new Date(Date.now() - recurrenceMinutes * 60000);
    const recurrenceSuppressed = await prisma.flowAnomaly.findFirst({
      where: {
        incidentKey,
        status: "suppressed",
        resolution: { startsWith: "Recorrência controlada:" },
        createdAt: { gte: recurrenceCutoff },
      },
      orderBy: { createdAt: "desc" },
    });
    if (recurrenceSuppressed) {
      await prisma.flowAnomaly.update({
        where: { id: recurrenceSuppressed.id },
        data: {
          lastSeenAt: new Date(),
          ...meta,
          flows: row.flows,
          packets: row.packets,
          bytes: row.bytes,
          evidence,
        },
      });
      stored++;
      continue;
    }
    let anomaly = await prisma.flowAnomaly.findFirst({
      where: { incidentKey, status: { in: ["observed", "confirmed"] } },
      orderBy: { lastSeenAt: "desc" },
    });
    if (anomaly) {
      anomaly = await prisma.flowAnomaly.update({
        where: { id: anomaly.id },
        data: {
          lastSeenAt: new Date(),
          recoveryCount: 0,
          consecutiveCount: { increment: 1 },
          ...meta,
          flows: row.flows,
          packets: row.packets,
          bytes: row.bytes,
          evidence,
        },
      });
    } else {
      anomaly = await prisma.flowAnomaly.create({
        data: {
          fingerprint: `${incidentKey}:${Date.now()}`,
          incidentKey,
          exporterAddress: "",
          exporterName: row.exporterName,
          type: row.type,
          ...meta,
          sourceAddress: row.sourceAddress || null,
          destinationAddress: row.destinationAddress || null,
          protocol: row.protocol,
          port: row.port,
          flows: row.flows,
          packets: row.packets,
          bytes: row.bytes,
          evidence,
          firstSeenAt: new Date(),
          lastSeenAt: new Date(),
        },
      });
    }
    if (
      anomaly.consecutiveCount >= number(raw.confirmationCount || 2) &&
      anomaly.status === "observed"
    ) {
      const previousAction = await prisma.flowAnomaly.findFirst({
        where: {
          id: { not: anomaly.id },
          incidentKey,
          status: { in: ["confirmed", "resolved"] },
          lastSeenAt: { gte: recurrenceCutoff },
        },
        orderBy: { lastSeenAt: "desc" },
      });
      if (previousAction) {
        await prisma.flowAnomaly.update({
          where: { id: anomaly.id },
          data: {
            status: "suppressed",
            resolution: `Recorrência controlada: nova ação suprimida por ${recurrenceMinutes} minutos após a ocorrência anterior.`,
          },
        });
        if (previousAction.taskId)
          await addTaskMessage(
            previousAction.taskId,
            "system",
            `Nova ocorrência equivalente registrada sem reabrir Task durante o intervalo de recorrência de ${recurrenceMinutes} minutos.`,
          ).catch(() => {});
        stored++;
        continue;
      }
    }
    if (await deliverCustomWithoutTask(anomaly, row, meta)) {
      stored++;
      continue;
    }
    if (
      anomaly.consecutiveCount >= number(raw.confirmationCount || 2) &&
      anomaly.status === "observed"
    ) {
      const device = await prisma.device.findFirst({
          where: {
            OR: [
              { name: { equals: row.exporterName } },
              { hostname: { equals: row.exporterName } },
            ],
            isActive: true,
          },
        }),
        identityText = (label, value) =>
          value
            ? `${label}: ${value.name}${value.type ? ` · ${value.type}` : ""}${value.owner ? ` · responsável ${value.owner}` : ""}${value.site ? ` · site ${value.site}` : ""}`
            : "",
        message = [
          meta.title,
          meta.description,
          `Origem: ${row.sourceAddress || "não identificada"}`,
          identityText("Identidade da origem", sourceIdentity),
          `Destino: ${row.destinationAddress || "múltiplos"}`,
          identityText("Identidade do destino", destinationIdentity),
          `Protocolo/porta: ${row.protocol}${row.port ? `/${row.port}` : ""}`,
          `Fluxos: ${integerText(row.flows)} · Pacotes: ${integerText(row.packets)} · Bytes: ${integerText(row.bytes)}`,
          `Confiança: ${meta.confidence}%`,
        ]
          .filter(Boolean)
          .join("\n"),
        task = await createTask({
          source: "flow_inspector",
          workType: "incident",
          deviceId: device?.id,
          priority:
            row.priority ||
            (meta.severity === "critical" ? "critical" : "high"),
          originalMessage: message,
          incident: {
            incidentKey: `flow:${anomaly.id}`,
            incidentOpenedAt: anomaly.firstSeenAt,
            lastSeenAt: new Date(),
          },
        });
      await addTaskMessage(
        task.id,
        "system",
        "Incidente confirmado após duas detecções consecutivas pelo inspetor de tráfego. Nenhuma mitigação foi executada.",
      );
      await notifyTask(task, "opened", {
        message,
        channelsOverride:
          row.notificationMode === "task"
            ? []
            : row.notificationMode === "task_telegram"
              ? ["telegram"]
              : null,
        recipientsOverride: row.telegramChatId ? [row.telegramChatId] : null,
      }).catch(() => {});
      anomaly = await prisma.flowAnomaly.update({
        where: { id: anomaly.id },
        data: { status: "confirmed", taskId: task.id },
      });
    }
    stored++;
  }
  await resolveMissingThreats(seen);
  return stored;
}

async function evaluateExporterHealth(activeNames) {
  const cfg = await getFlowExporterHealthConfig(),
    snapshots = await prisma.flowMetricSnapshot.findMany({
      orderBy: { collectedAt: "desc" },
      take: 10000,
    }),
    latest = new Map();
  for (const row of snapshots)
    if (!latest.has(row.exporterName)) latest.set(row.exporterName, row);
  let alerts = 0;
  for (const [exporterName, last] of latest) {
    const incidentKey = `${exporterName}:exporter_offline`,
      active = activeNames.has(exporterName),
      anomaly = await prisma.flowAnomaly.findFirst({
        where: { incidentKey, type: "exporter_offline", status: "confirmed" },
        orderBy: { createdAt: "desc" },
      });
    if (active) {
      if (anomaly) {
        const now = new Date(),
          resolution =
            "Exportador voltou a enviar NetFlow/IPFIX; recuperação confirmada automaticamente.";
        await prisma.flowAnomaly.update({
          where: { id: anomaly.id },
          data: { status: "resolved", resolution, lastSeenAt: now },
        });
        if (anomaly.taskId) {
          const task = await prisma.task.findUnique({
            where: { id: anomaly.taskId },
          });
          if (task && openTaskStatuses.includes(task.status)) {
            const updated = await updateTask(task.id, {
              status: "resolved",
              resolvedAt: now,
              validatedAt: now,
              resolutionType: "flow_exporter_recovered",
              resolutionSummary: resolution,
            });
            await addTaskMessage(task.id, "system", resolution);
            let evidence = {};
            try {
              evidence = JSON.parse(anomaly.evidence || "{}");
            } catch {}
            await notifyTask(updated, "resolved", {
              message: resolution,
              channelsOverride:
                evidence.notificationMode === "task_telegram"
                  ? ["telegram"]
                  : [],
            }).catch(() => {});
          }
        }
      }
      continue;
    }
    if (
      !cfg.enabled ||
      anomaly ||
      Date.now() - new Date(last.collectedAt).getTime() <
        cfg.timeoutMinutes * 60000
    )
      continue;
    const row = { exporterName, type: "exporter_offline" },
      silence = await activeSilenceFor(row);
    if (silence) continue;
    const description = `Nenhum fluxo recebido de ${exporterName} há mais de ${cfg.timeoutMinutes} minutos. Última coleta: ${new Date(last.collectedAt).toLocaleString("pt-BR")}.`,
      created = await prisma.flowAnomaly.create({
        data: {
          fingerprint: `${incidentKey}:${Date.now()}`,
          incidentKey,
          exporterAddress: last.exporterAddress || "",
          exporterName,
          type: "exporter_offline",
          severity: "critical",
          title: `Exportador NetFlow sem comunicação: ${exporterName}`,
          description,
          evidence: JSON.stringify({
            lastFlowAt: last.collectedAt,
            timeoutMinutes: cfg.timeoutMinutes,
            notificationMode: cfg.notificationMode,
          }),
          confidence: 98,
          status: "confirmed",
          firstSeenAt: new Date(last.collectedAt),
          lastSeenAt: new Date(),
        },
      });
    if (cfg.notificationMode !== "panel") {
      const device = await prisma.device.findFirst({
          where: {
            OR: [{ name: exporterName }, { hostname: exporterName }],
            isActive: true,
          },
        }),
        task = await createTask({
          source: "flow_inspector",
          workType: "incident",
          deviceId: device?.id,
          priority: "critical",
          originalMessage: description,
          incident: {
            incidentKey: `flow-exporter:${exporterName}`,
            incidentOpenedAt: new Date(),
            lastSeenAt: new Date(),
          },
        });
      await addTaskMessage(
        task.id,
        "system",
        "Alerta criado pelo monitor de saúde dos exportadores NetFlow/IPFIX.",
      );
      await notifyTask(task, "opened", {
        message: description,
        channelsOverride:
          cfg.notificationMode === "task_telegram" ? ["telegram"] : [],
      }).catch(() => {});
      await prisma.flowAnomaly.update({
        where: { id: created.id },
        data: { taskId: task.id },
      });
    }
    alerts++;
  }
  return alerts;
}

export async function classifyFlowAnomaly(
  id,
  { classification, resolution, username },
) {
  if (!["attack", "false_positive", "legitimate"].includes(classification))
    throw Object.assign(new Error("Classificação inválida"), {
      statusCode: 400,
    });
  const anomaly = await prisma.flowAnomaly.findUnique({ where: { id } });
  if (!anomaly)
    throw Object.assign(new Error("Anomalia não encontrada"), {
      statusCode: 404,
    });
  const now = new Date(),
    text =
      String(resolution || "")
        .trim()
        .slice(0, 1000) ||
      {
        attack: "Confirmado como ataque pelo operador.",
        false_positive: "Classificado como falso positivo.",
        legitimate: "Classificado como tráfego legítimo.",
      }[classification],
    status = classification === "attack" ? "confirmed" : "suppressed",
    updated = await prisma.flowAnomaly.update({
      where: { id },
      data: {
        classification,
        classifiedBy: username,
        classifiedAt: now,
        resolution: text,
        status,
      },
    });
  if (anomaly.taskId) {
    const task = await prisma.task.findUnique({
      where: { id: anomaly.taskId },
    });
    if (task) {
      await addTaskMessage(
        task.id,
        username,
        `Classificação do inspetor: ${classification}. ${text}`,
      );
      if (classification !== "attack" && openTaskStatuses.includes(task.status))
        await updateTask(task.id, {
          status: "resolved",
          resolvedAt: now,
          validatedAt: now,
          resolutionType: `flow_${classification}`,
          resolutionSummary: text,
        });
    }
  }
  return updated;
}

export async function collectFlowObservation() {
  const cfg = await config(),
    rows = await query(summarySql),
    result = { exporters: rows.length, snapshots: 0, anomalies: 0 };
  if (!cfg.learningStartedAt)
    await prisma.settings.upsert({
      where: { key: "flow_learning_started_at" },
      create: {
        key: "flow_learning_started_at",
        value: new Date().toISOString(),
      },
      update: {},
    });
  for (const raw of rows) {
    const row = {
        exporterAddress: stripV4(raw.exporterAddress),
        exporterName: raw.exporterName || stripV4(raw.exporterAddress),
        flows: number(raw.flows),
        bytes: number(raw.bytes),
        packets: number(raw.packets),
        uniqueSources: number(raw.uniqueSources),
        uniqueDestinations: number(raw.uniqueDestinations),
        topSource: stripV4(raw.topSource),
        topDestination: stripV4(raw.topDestination),
        topPort: number(raw.topPort) || null,
      },
      history = await prisma.flowMetricSnapshot.findMany({
        where: {
          exporterName: row.exporterName,
          collectedAt: { gte: new Date(Date.now() - 7 * 86400000) },
        },
        orderBy: { collectedAt: "desc" },
        take: 2016,
      }),
      percentile = (field, q = 0.95) => {
        const values = history
          .map((item) => number(item[field]))
          .sort((a, b) => a - b);
        return values.length
          ? values[
              Math.min(values.length - 1, Math.floor((values.length - 1) * q))
            ]
          : 0;
      },
      ratios = [
        percentile("bytes") ? row.bytes / percentile("bytes") : 1,
        percentile("packets") ? row.packets / percentile("packets") : 1,
        percentile("uniqueSources")
          ? row.uniqueSources / percentile("uniqueSources")
          : 1,
      ],
      score = Math.round(Math.max(...ratios) * 100) / 100,
      learning = history.length < 288;
    await prisma.flowMetricSnapshot.create({
      data: { ...row, anomalyScore: score, learning },
    });
    result.snapshots++;
    const findings = [];
    if (!learning && score >= 3)
      findings.push({
        type: "volume_deviation",
        severity: score >= 6 ? "critical" : "warning",
        confidence: 85,
        title: `Volume anormal em ${row.exporterName}`,
        description: `O tráfego ficou ${score.toFixed(1)} vezes acima do percentil 95 da linha de base recente.`,
      });
    if (row.packets >= 30_000_000)
      findings.push({
        type: "packet_flood",
        severity: "critical",
        confidence: 90,
        title: `Possível flood em ${row.exporterName}`,
        description: `Foram observados ${row.packets.toLocaleString("pt-BR")} pacotes em cinco minutos.`,
      });
    for (const finding of findings) {
      const bucket = Math.floor(Date.now() / 300000),
        fingerprint = `${row.exporterName}:${finding.type}:${bucket}`;
      await prisma.flowAnomaly.upsert({
        where: { fingerprint },
        create: {
          fingerprint,
          exporterAddress: row.exporterAddress,
          exporterName: row.exporterName,
          ...finding,
          evidence: JSON.stringify(row),
          firstSeenAt: new Date(),
          lastSeenAt: new Date(),
        },
        update: {
          lastSeenAt: new Date(),
          description: finding.description,
          evidence: JSON.stringify(row),
        },
      });
      result.anomalies++;
    }
  }
  result.anomalies += await detectThreats();
  result.anomalies += await evaluateExporterHealth(
    new Set(
      rows.map((row) => row.exporterName || stripV4(row.exporterAddress)),
    ),
  );
  await prisma.flowMetricSnapshot.deleteMany({
    where: { collectedAt: { lt: new Date(Date.now() - 30 * 86400000) } },
  });
  return result;
}

export async function flowInspectorDashboard() {
  const [live, topSources, topPorts, snapshots, anomalies] = await Promise.all([
      query(summarySql),
      query(
        `SELECT ExporterName exporterName, IPv6NumToString(SrcAddr) address, sum(Bytes) bytes, sum(Packets) packets, uniqExact(DstAddr) destinations, uniqExact(DstPort) ports FROM default.flows WHERE TimeReceived >= now() - INTERVAL 15 MINUTE GROUP BY ExporterName, SrcAddr ORDER BY ExporterName, bytes DESC LIMIT 10 BY ExporterName`,
      ),
      query(
        `SELECT ExporterName exporterName, DstPort port, sum(Bytes) bytes, sum(Packets) packets, count() flows FROM default.flows WHERE TimeReceived >= now() - INTERVAL 15 MINUTE GROUP BY ExporterName, DstPort ORDER BY ExporterName, bytes DESC LIMIT 10 BY ExporterName`,
      ),
      prisma.flowMetricSnapshot.findMany({
        orderBy: { collectedAt: "desc" },
        take: 4032,
      }),
      prisma.flowAnomaly.findMany({
        orderBy: { lastSeenAt: "desc" },
        take: 200,
      }),
    ]),
    requiredSamples = 288,
    learningByExporter = new Map(),
    inventory = await inventoryByAddress([
      ...topSources.map((row) => row.address),
      ...anomalies.flatMap((row) => [
        row.sourceAddress,
        row.destinationAddress,
      ]),
    ]);
  for (const row of snapshots) {
    const current = learningByExporter.get(row.exporterName) || {
      exporterName: row.exporterName,
      samples: 0,
      startedAt: row.collectedAt,
    };
    current.samples++;
    if (new Date(row.collectedAt) < new Date(current.startedAt))
      current.startedAt = row.collectedAt;
    learningByExporter.set(row.exporterName, current);
  }
  const learning = [
      ...new Set([
        ...live.map((row) => row.exporterName),
        ...learningByExporter.keys(),
      ]),
    ].map((exporterName) => {
      const current = learningByExporter.get(exporterName) || {
          samples: 0,
          startedAt: new Date(),
        },
        samples = Math.min(requiredSamples, current.samples),
        progress = Math.min(100, Math.round((samples / requiredSamples) * 100));
      return {
        exporterName,
        samples,
        requiredSamples,
        progress,
        ready: samples >= requiredSamples,
        startedAt: current.startedAt,
        endsAt: new Date(
          new Date(current.startedAt).getTime() + requiredSamples * 300000,
        ),
      };
    }),
    publicAnomalies = anomalies.map((row) => {
      let stored = {};
      try {
        stored = JSON.parse(row.evidence || "{}");
      } catch {}
      return {
        ...row,
        sourceIdentity:
          stored.sourceIdentity ||
          inventory.get(stripV4(row.sourceAddress)) ||
          null,
        destinationIdentity:
          stored.destinationIdentity ||
          inventory.get(stripV4(row.destinationAddress)) ||
          null,
      };
    });
  const healthConfig = await getFlowExporterHealthConfig(),
    latestByExporter = new Map();
  for (const row of snapshots)
    if (!latestByExporter.has(row.exporterName))
      latestByExporter.set(row.exporterName, row);
  const liveNames = new Set(live.map((row) => row.exporterName)),
    exporterHealth = [...latestByExporter.values()].map((row) => ({
      exporterName: row.exporterName,
      exporterAddress: row.exporterAddress,
      lastSeenAt: row.collectedAt,
      status: liveNames.has(row.exporterName)
        ? "online"
        : Date.now() - new Date(row.collectedAt).getTime() >=
            healthConfig.timeoutMinutes * 60000
          ? "offline"
          : "delayed",
    }));
  return {
    mode: "observation",
    learning,
    exporters: live.map((row) => ({
      ...row,
      exporterAddress: stripV4(row.exporterAddress),
    })),
    topSources: topSources.map((row) => ({
      ...row,
      address: stripV4(row.address),
      identity: inventory.get(stripV4(row.address)) || null,
    })),
    topPorts,
    snapshots,
    anomalies: publicAnomalies,
    exporterHealth,
    exporterHealthConfig: healthConfig,
    updatedAt: new Date(),
  };
}

export async function testFlowInspector() {
  const rows = await query(
    "SELECT now() time, count() flows FROM default.flows WHERE TimeReceived >= now() - INTERVAL 5 MINUTE",
  );
  return rows[0] || {};
}
export async function searchFlowTraffic(input = {}) {
  const minutes =
      { 15: 15, 60: 60, 360: 360, 1440: 1440 }[Number(input.minutes)] || 15,
    conditions = [`TimeReceived >= now() - INTERVAL ${minutes} MINUTE`],
    exporter = String(input.exporter || "").trim(),
    ip = String(input.ip || "").trim(),
    direction = String(input.direction || "").trim(),
    protocol = String(input.protocol || "").trim(),
    port = Math.max(0, Math.min(65535, Number(input.port) || 0));
  if (exporter) conditions.push(`ExporterName=${sqlText(exporter)}`);
  if (ip && /^[0-9a-fA-F:.]+$/.test(ip))
    conditions.push(
      `(IPv6NumToString(SrcAddr)=${sqlText(ip)} OR IPv6NumToString(DstAddr)=${sqlText(ip)} OR IPv6NumToString(SrcAddr)=${sqlText(`::ffff:${ip}`)} OR IPv6NumToString(DstAddr)=${sqlText(`::ffff:${ip}`)})`,
    );
  const protoNumber = { tcp: 6, udp: 17, icmp: 1, icmpv6: 58 }[
    protocol.toLowerCase()
  ];
  if (protoNumber) conditions.push(`Proto=${protoNumber}`);
  if (port) conditions.push(`(SrcPort=${port} OR DstPort=${port})`);
  if (["ingress", "egress"].includes(direction))
    conditions.push(`FlowDirection=${sqlText(direction)}`);
  let rows = await query(
      `SELECT ExporterName exporterName, IPv6NumToString(SrcAddr) sourceAddress, IPv6NumToString(DstAddr) destinationAddress, Proto protocol, SrcPort sourcePort, DstPort destinationPort, FlowDirection direction, sum(Bytes) bytes, sum(Packets) packets, count() flows, max(TimeReceived) lastSeen FROM default.flows WHERE ${conditions.join(" AND ")} GROUP BY ExporterName, SrcAddr, DstAddr, Proto, SrcPort, DstPort, FlowDirection ORDER BY bytes DESC LIMIT 100`,
    ),
    inventory = await inventoryByAddress(
      rows.flatMap((row) => [row.sourceAddress, row.destinationAddress]),
    );
  rows = await Promise.all(
    rows.map(async (row) => {
      const sourceAddress = stripV4(row.sourceAddress),
        destinationAddress = stripV4(row.destinationAddress),
        [sourceDomain, destinationDomain] = await Promise.all([
          reverseName(sourceAddress),
          reverseName(destinationAddress),
        ]);
      return {
        ...row,
        sourceAddress,
        destinationAddress,
        protocol: protocolName(row.protocol),
        sourceDomain,
        destinationDomain,
        sourceIdentity: inventory.get(sourceAddress) || null,
        destinationIdentity: inventory.get(destinationAddress) || null,
        domainConfidence:
          sourceDomain || destinationDomain ? "estimated" : "unknown",
      };
    }),
  );
  const domain = String(input.domain || "")
    .trim()
    .toLowerCase();
  if (domain)
    rows = rows.filter(
      (row) =>
        row.sourceDomain.toLowerCase().includes(domain) ||
        row.destinationDomain.toLowerCase().includes(domain),
    );
  return {
    rows,
    filters: {
      minutes,
      exporter,
      ip,
      protocol: protocol.toLowerCase(),
      port: port || null,
      direction,
      domain,
    },
    domainNotice:
      "Domínios são estimados por DNS reverso e podem não representar o domínio acessado.",
  };
}
export async function runFlowInspectorScheduler() {
  try {
    const result = await collectFlowObservation();
    await maybeRunFlowRetention();
    return result;
  } catch (error) {
    logger.error(`Flow inspector scheduler error: ${error.message}`);
    return { error: error.message };
  }
}
