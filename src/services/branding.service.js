import prisma from '../database/client.js';

export const BRANDING_DEFAULTS = {
  name: 'NOC Agent 35',
  subtitle: 'AI Monitoring',
  loginSubtitle: 'Sistema de Monitoramento NOC com IA',
  primaryColor: '#00d4ff',
  logo: null,
  favicon: null,
};

const KEYS = {
  branding_name: 'name', branding_subtitle: 'subtitle', branding_login_subtitle: 'loginSubtitle',
  branding_primary_color: 'primaryColor', branding_logo_data: 'logo', branding_favicon_data: 'favicon',
};

const imageInfo = (value, maxBytes) => {
  if (value === '' || value === null) return null;
  const match = String(value || '').match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw Object.assign(new Error('Imagem inválida. Use PNG, JPG ou WebP.'), { statusCode: 400 });
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > maxBytes) throw Object.assign(new Error(`Imagem excede o limite de ${Math.round(maxBytes / 1024)} KB.`), { statusCode: 400 });
  const valid = match[1] === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    : match[1] === 'image/jpeg' ? bytes[0] === 0xff && bytes[1] === 0xd8
      : bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
  if (!valid) throw Object.assign(new Error('O conteúdo do arquivo não corresponde ao formato informado.'), { statusCode: 400 });
  return value;
};

export function validateBranding(input = {}) {
  const name = String(input.name ?? BRANDING_DEFAULTS.name).trim();
  const subtitle = String(input.subtitle ?? BRANDING_DEFAULTS.subtitle).trim();
  const loginSubtitle = String(input.loginSubtitle ?? BRANDING_DEFAULTS.loginSubtitle).trim();
  const primaryColor = String(input.primaryColor ?? BRANDING_DEFAULTS.primaryColor).trim().toLowerCase();
  if (!name || name.length > 60) throw Object.assign(new Error('Nome deve possuir entre 1 e 60 caracteres.'), { statusCode: 400 });
  if (subtitle.length > 80 || loginSubtitle.length > 120) throw Object.assign(new Error('Subtítulo muito longo.'), { statusCode: 400 });
  if (!/^#[0-9a-f]{6}$/.test(primaryColor)) throw Object.assign(new Error('Cor principal inválida.'), { statusCode: 400 });
  return { name, subtitle, loginSubtitle, primaryColor, logo: imageInfo(input.logo, 1536 * 1024), favicon: imageInfo(input.favicon, 256 * 1024) };
}

export async function getBranding() {
  const rows = await prisma.settings.findMany({ where: { key: { in: Object.keys(KEYS) } } });
  const result = { ...BRANDING_DEFAULTS };
  rows.forEach(row => { result[KEYS[row.key]] = row.value || null; });
  return { ...BRANDING_DEFAULTS, ...result };
}

export async function saveBranding(input) {
  const branding = validateBranding(input);
  const values = Object.fromEntries(Object.entries(KEYS).map(([key, field]) => [key, branding[field] || '']));
  await prisma.$transaction(Object.entries(values).map(([key, value]) => prisma.settings.upsert({
    where: { key }, update: { value, encrypted: false }, create: { key, value, encrypted: false },
  })));
  return branding;
}
