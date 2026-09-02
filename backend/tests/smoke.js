/*
 * Testes de fumaça / regressão da API do PetFeeder.
 *
 * Exigem o servidor rodando. Em outro terminal:
 *   cd backend && npm run dev
 * Depois:
 *   npm test
 *
 * Aponte para outro host com:  BASE_URL=http://meu-host:3000 npm test
 */
const WebSocket = require('ws');

const BASE = process.env.BASE_URL || 'http://localhost:3000';
let pass = 0, fail = 0;
const ok = (cond, label) => {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.log('  ❌', label); }
};
const section = (t) => console.log(`\n--- ${t} ---`);

async function j(method, path, body, headers = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try { data = await res.json(); } catch { /* resposta sem corpo JSON */ }
  return { status: res.status, data };
}

(async () => {
  const t = Date.now().toString(36);
  const email = `u1${t}@pf.dev`;
  const email2 = `u2${t}@pf.dev`;
  const DEV_A = 'PF_A' + t.slice(-5).toUpperCase();
  const DEV_B = 'PF_B' + t.slice(-5).toUpperCase();
  const DEV_C = 'PF_C' + t.slice(-5).toUpperCase();

  let r = await j('GET', '/health');
  if (r.status !== 200) {
    console.error(`\n❌ Servidor não respondeu em ${BASE}. Suba com "npm run dev" antes de rodar os testes.\n`);
    process.exit(1);
  }

  section('Entradas inválidas não podem derrubar o processo');
  r = await j('POST', '/api/auth/register', { name: 'X', email: `bad${t}@pf.dev`, password: 123 });
  ok(r.status === 400, 'register com password não-string -> 400');
  r = await j('POST', '/api/auth/login', { email: `bad${t}@pf.dev`, password: 123 });
  ok(r.status === 400, 'login com password não-string -> 400');
  r = await j('POST', '/api/devices/auto-register', { deviceId: 12345, email });
  ok(r.status === 400, 'auto-register com deviceId não-string -> 400');
  r = await j('GET', '/health');
  ok(r.status === 200, 'servidor continua vivo após entradas inválidas');

  section('Contas');
  r = await j('POST', '/api/auth/register', { name: 'User1', email, password: 'senha123' });
  ok(r.data?.success, 'registro do usuário 1');
  const token = r.data.data.accessToken;
  const auth = { Authorization: `Bearer ${token}` };

  r = await j('POST', '/api/auth/register', { name: 'User2', email: email2, password: 'senha123' });
  ok(r.data?.success, 'registro do usuário 2');
  const auth2 = { Authorization: `Bearer ${r.data.data.accessToken}` };

  section('Autenticação de dispositivo (X-Device-Secret)');
  r = await j('POST', '/api/devices/link', { deviceId: DEV_A, name: 'Alim A' }, auth);
  ok(r.data?.success && r.data.data.device_secret, 'vincular dispositivo devolve device_secret');
  const secretA = r.data.data.device_secret;
  const devAId = r.data.data.id;

  r = await j('POST', '/api/devices/link', { deviceId: DEV_B, name: 'Alim B' }, auth);
  const secretB = r.data.data.device_secret;
  const devBId = r.data.data.id;

  r = await j('GET', `/api/devices/${DEV_A}/schedules`);
  ok(r.status === 401, 'rota do ESP32 sem segredo -> 401');
  r = await j('GET', `/api/devices/${DEV_A}/schedules`, undefined, { 'X-Device-Secret': secretA });
  ok(r.status === 200, 'rota do ESP32 com segredo -> 200');
  r = await j('GET', `/api/devices/${DEV_A}/schedules`, undefined, { 'X-Device-Secret': secretB });
  ok(r.status === 401, 'segredo de outro dispositivo -> 401');

  r = await j('POST', '/api/devices/link', { deviceId: DEV_C, name: 'Alim C' }, auth2);
  const devCId = r.data.data.id;

  section('Isolamento entre contas');
  r = await j('POST', '/api/pets', { deviceId: devAId, name: 'Rex', type: 'dog', compartment: 1, dailyAmount: 100 }, auth);
  ok(r.data?.success, 'criar pet no dispositivo A');
  const petA = r.data.data.id;
  r = await j('POST', '/api/pets', { deviceId: devBId, name: 'Mia', type: 'cat', compartment: 1, dailyAmount: 50 }, auth);
  const petB = r.data.data.id;

  r = await j('PUT', `/api/pets/${petA}`, { deviceId: devCId }, auth);
  ok(r.status === 404, 'apontar pet para dispositivo de outra conta -> 404');
  r = await j('GET', `/api/devices/${DEV_C}/status`, undefined, auth);
  ok(r.status === 404, 'status de dispositivo de outra conta -> 404');

  section('Horários: isolamento por dispositivo e id estável');
  const dias = { monday: true, tuesday: true, wednesday: true, thursday: true, friday: true, saturday: true, sunday: true };
  r = await j('POST', '/api/schedules', { petId: petA, hour: 8, minute: 0, amount: 100, days: dias }, auth);
  ok(r.data?.success, 'horário 08:00 para o pet A');
  r = await j('POST', '/api/schedules', { petId: petB, hour: 8, minute: 0, amount: 50, days: dias }, auth);
  ok(r.data?.success, 'horário 08:00 para o pet B (mesmo minuto, outro dispositivo)');

  r = await j('GET', `/api/devices/${DEV_A}/schedules`, undefined, { 'X-Device-Secret': secretA });
  const schedA = r.data?.data || [];
  ok(schedA.length === 1, `dispositivo A recebe apenas o próprio horário (recebeu ${schedA.length})`);
  ok(schedA[0]?.pet === 'Rex', 'e é o horário do pet correto');
  ok(Number.isInteger(schedA[0]?.id), 'payload traz o id do horário (chave da trava anti-reexecução)');

  r = await j('GET', `/api/devices/${DEV_B}/schedules`, undefined, { 'X-Device-Secret': secretB });
  const schedB = r.data?.data || [];
  ok(schedB.length === 1 && schedB[0].pet === 'Mia', 'dispositivo B recebe apenas o próprio horário');
  ok(schedA[0]?.id !== schedB[0]?.id, 'ids distintos: um pet não anula a marcação do outro');

  section('Validação e edição de horários');
  r = await j('POST', '/api/schedules', { petId: petA, hour: 99, minute: 0, amount: 100, days: dias }, auth);
  ok(r.status === 400, 'hora fora da faixa -> 400');
  r = await j('POST', '/api/schedules', { petId: petA, hour: 9, minute: 0, amount: 100, days: {} }, auth);
  ok(r.status === 400, 'nenhum dia da semana marcado -> 400');

  r = await j('GET', '/api/schedules', undefined, auth);
  const sid = r.data.data.find((s) => s.pet_name === 'Rex').id;
  r = await j('PUT', `/api/schedules/${sid}`, {
    hour: 9, minute: 30, amount: 50,
    monday: true, tuesday: false, wednesday: false, thursday: false, friday: false, saturday: false, sunday: false,
  }, auth);
  ok(r.data?.success, 'editar horário com dias no formato do modal');
  r = await j('GET', '/api/schedules', undefined, auth);
  const upd = r.data.data.find((s) => s.id === sid);
  ok(upd?.hour === 9 && upd?.minute === 30, 'hora e minuto atualizados');
  ok(upd?.monday === true && upd?.tuesday === false && upd?.sunday === false, 'dias da semana realmente atualizados');

  section('Registro de alimentação');
  r = await j('POST', '/api/feed/log', { device_id: 'PF_NAOEXISTE1', size: 'medium' });
  ok(r.status === 404 || r.status === 401, 'feed/log de dispositivo inexistente -> erro (não 200)');
  r = await j('POST', '/api/feed/log', { device_id: DEV_A, size: 'medium', trigger: 'scheduled', pet_name: 'Rex' }, { 'X-Device-Secret': secretA });
  ok(r.data?.success, 'feed/log válido -> 200');
  r = await j('GET', '/api/feed/history', undefined, auth);
  ok(r.data?.data?.length >= 1, 'alimentação aparece no histórico');
  r = await j('POST', '/api/feed/log', { device_id: DEV_A, size: 'small', pet_name: 'PetInexistente' }, { 'X-Device-Secret': secretA });
  ok(r.data?.success, 'feed/log com pet renomeado usa o pet do dispositivo');

  section('Comandos e tempo real');
  // Esvazia a fila: criar/editar horários já enfileirou comandos "sync".
  for (let i = 0; i < 12; i++) {
    const c = await j('GET', `/api/devices/${DEV_A}/commands`, undefined, { 'X-Device-Secret': secretA });
    if (!c.data?.command) break;
  }
  r = await j('POST', '/api/feed/now', { deviceId: devAId, petId: petA, amount: 100 }, auth);
  ok(r.data?.success, 'alimentar agora');
  r = await j('GET', `/api/devices/${DEV_A}/commands`, undefined, { 'X-Device-Secret': secretA });
  ok(r.data?.command === 'feed', 'ESP32 recebe o comando feed');

  r = await j('POST', `/api/devices/${devAId}/restart`, undefined, auth);
  ok(r.data?.success, 'reiniciar enfileira comando');
  let gotRestart = false;
  for (let i = 0; i < 8 && !gotRestart; i++) {
    const c = await j('GET', `/api/devices/${DEV_A}/commands`, undefined, { 'X-Device-Secret': secretA });
    if (c.data?.command === 'restart') gotRestart = true;
  }
  ok(gotRestart, 'ESP32 recebe o comando restart');

  await new Promise((resolve) => {
    const ws = new WebSocket(BASE.replace(/^http/, 'ws') + '/ws');
    const timer = setTimeout(() => { ok(false, 'WebSocket (timeout)'); try { ws.close(); } catch {} resolve(); }, 8000);
    ws.on('open', () => ws.send(JSON.stringify({ type: 'authenticate', token })));
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw);
      if (msg.type === 'authenticated') {
        ok(true, 'WebSocket autentica');
        j('POST', `/api/devices/${DEV_A}/status`, { food_level: 77, mode: 'active' }, { 'X-Device-Secret': secretA });
      } else if (msg.type === 'device_status') {
        ok(msg.data.food_level === 77, 'WebSocket entrega device_status em tempo real');
        clearTimeout(timer); ws.close(); resolve();
      }
    });
    ws.on('error', () => { ok(false, 'WebSocket: erro de conexão'); clearTimeout(timer); resolve(); });
  });

  section('Sessão');
  r = await j('POST', '/api/auth/logout', undefined, auth);
  ok(r.data?.success, 'logout');
  r = await j('GET', '/api/auth/me', undefined, auth);
  ok(r.status === 401, 'token revogado após logout');

  console.log(`\n${fail === 0 ? '✅' : '❌'} RESULTADO: ${pass} passaram, ${fail} falharam\n`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error('\n❌ Erro inesperado nos testes:', e);
  process.exit(1);
});
