import crypto from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const encodeBase32 = buffer => {
  let bits = ''; for (const byte of buffer) bits += byte.toString(2).padStart(8, '0');
  let output = ''; for (let i = 0; i < bits.length; i += 5) output += ALPHABET[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)];
  return output;
};
const decodeBase32 = text => {
  let bits = ''; for (const char of String(text).replace(/=|\s/g, '').toUpperCase()) { const index = ALPHABET.indexOf(char); if (index < 0) throw new Error('Segredo 2FA inválido'); bits += index.toString(2).padStart(5, '0'); }
  const bytes=[]; for(let i=0;i+8<=bits.length;i+=8)bytes.push(parseInt(bits.slice(i,i+8),2)); return Buffer.from(bytes);
};

export const generateTotpSecret = () => encodeBase32(crypto.randomBytes(20));
export function totpCode(secret, timestamp = Date.now()) {
  const counter = Math.floor(timestamp / 30000); const buffer=Buffer.alloc(8); buffer.writeBigUInt64BE(BigInt(counter));
  const digest=crypto.createHmac('sha1',decodeBase32(secret)).update(buffer).digest(); const offset=digest[digest.length-1]&15;
  return String((digest.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,'0');
}
export function verifyTotp(secret, code) {
  const supplied=String(code||'').replace(/\s/g,''); if(!/^\d{6}$/.test(supplied))return false;
  return [-1,0,1].some(window => { const expected=Buffer.from(totpCode(secret,Date.now()+window*30000)); const actual=Buffer.from(supplied); return expected.length===actual.length&&crypto.timingSafeEqual(expected,actual); });
}
export const totpUri = (secret, username) => `otpauth://totp/${encodeURIComponent(`NOC Agent:${username}`)}?secret=${secret}&issuer=${encodeURIComponent('NOC Agent 35')}&algorithm=SHA1&digits=6&period=30`;
