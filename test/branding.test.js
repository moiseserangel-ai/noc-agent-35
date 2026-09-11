import test from 'node:test';
import assert from 'node:assert/strict';
import { validateBranding } from '../src/services/branding.service.js';

const png = `data:image/png;base64,${Buffer.from([137,80,78,71,13,10,26,10,0]).toString('base64')}`;
test('valida identidade e imagem PNG', () => {
  const value = validateBranding({ name:'Meu NOC',subtitle:'Operações',loginSubtitle:'Bem-vindo',primaryColor:'#12abef',logo:png,favicon:null });
  assert.equal(value.name, 'Meu NOC'); assert.equal(value.primaryColor, '#12abef'); assert.equal(value.logo, png);
});
test('rejeita cor e conteúdo de imagem inválidos', () => {
  assert.throws(()=>validateBranding({name:'NOC',primaryColor:'blue'}),/Cor principal/);
  assert.throws(()=>validateBranding({name:'NOC',primaryColor:'#000000',logo:'data:image/png;base64,AAAA'}),/conteúdo/);
});
