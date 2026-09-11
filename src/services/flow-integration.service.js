import { spawn } from "node:child_process";
import prisma from "../database/client.js";
import { decrypt, encrypt } from "../utils/crypto.js";

const keys = [
  "flow_inspector_url",
  "flow_inspector_user",
  "flow_inspector_password",
];
async function values() {
  const rows = await prisma.settings.findMany({ where: { key: { in: keys } } });
  return Object.fromEntries(
    rows.map((row) => [
      row.key,
      row.encrypted ? decrypt(row.value) : row.value,
    ]),
  );
}
async function connection(overrides = {}) {
  const data = await values();
  return {
    url: String(overrides.url || data.flow_inspector_url || "").replace(
      /\/$/,
      "",
    ),
    user: String(overrides.user || data.flow_inspector_user || ""),
    password: String(overrides.password || data.flow_inspector_password || ""),
  };
}
export async function getFlowIntegration() {
  const cfg = await connection();
  return {
    url: cfg.url,
    user: cfg.user,
    passwordConfigured: !!cfg.password,
    collectorAddress: new URL(cfg.url).hostname,
    collectorPort: 2055,
  };
}
export async function testFlowIntegration(input = {}) {
  const cfg = await connection(input),
    response = await fetch(`${cfg.url}/?default_format=JSONEachRow`, {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(`${cfg.user}:${cfg.password}`).toString("base64")}`,
        "content-type": "text/plain",
      },
      body: "SELECT now() time, count() flows FROM default.flows WHERE TimeReceived >= now() - INTERVAL 5 MINUTE",
      signal: AbortSignal.timeout(15000),
    }),
    body = await response.text();
  if (!response.ok)
    throw Object.assign(
      new Error(`ClickHouse HTTP ${response.status}: ${body.slice(0, 180)}`),
      { statusCode: 400 },
    );
  return JSON.parse(body.trim().split("\n")[0] || "{}");
}
async function save(key, value, sensitive = false) {
  await prisma.settings.upsert({
    where: { key },
    update: { value: sensitive ? encrypt(value) : value, encrypted: sensitive },
    create: {
      key,
      value: sensitive ? encrypt(value) : value,
      encrypted: sensitive,
    },
  });
}
export async function saveFlowIntegration(input) {
  const current = await connection(),
    url = String(input.url || current.url)
      .trim()
      .replace(/\/$/, ""),
    user = String(input.user || current.user).trim();
  new URL(url);
  await testFlowIntegration({ url, user, password: current.password });
  await Promise.all([
    save("flow_inspector_url", url),
    save("flow_inspector_user", user),
  ]);
  return getFlowIntegration();
}
function remoteRotate(password) {
  return new Promise((resolve, reject) => {
    const child = spawn(
        "/usr/bin/ssh",
        [
          "-i",
          "/opt/noc-agent/secrets/flow-rotate",
          "-o",
          "UserKnownHostsFile=/opt/noc-agent/secrets/known_hosts",
          "-o",
          "BatchMode=yes",
          "-o",
          "StrictHostKeyChecking=yes",
          "root@192.168.250.66",
        ],
        { stdio: ["pipe", "pipe", "pipe"] },
      ),
      stdout = [],
      stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve(Buffer.concat(stdout).toString())
        : reject(
            new Error(
              Buffer.concat(stderr).toString().trim() ||
                `Falha na rotação remota (${code})`,
            ),
          ),
    );
    child.stdin.end(`${password}\n`);
  });
}
export async function rotateFlowPassword(password) {
  const value = String(password || "");
  if (value.length < 16 || value.length > 128)
    throw Object.assign(
      new Error("A nova senha deve possuir entre 16 e 128 caracteres"),
      { statusCode: 400 },
    );
  await remoteRotate(value);
  const cfg = await connection({ password: value });
  try {
    await testFlowIntegration(cfg);
  } catch (error) {
    throw Object.assign(
      new Error(
        `Senha alterada no coletor, mas a validação falhou: ${error.message}`,
      ),
      { statusCode: 502 },
    );
  }
  await save("flow_inspector_password", value, true);
  return { passwordConfigured: true };
}
