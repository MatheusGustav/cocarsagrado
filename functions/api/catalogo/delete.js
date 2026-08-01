/* ============================================================
   POST /api/catalogo/delete  — remove foto do catálogo do R2
   Body JSON: { key }    Binding R2 necessário: CATALOGO
   Auth: JWT do admin validado pela RPC is_admin() (e-mail + 2º fator).
   ============================================================ */

const SUPABASE_URL = 'https://demxedudbislzausvhwx.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_rfGhG8zjFnRgwzIBEN2Glw_vCWMBqeG';

/* Admin de verdade = o que public.is_admin() disser: e-mail da lista E sessão
   aal2 (senha + MFA). Token ausente, inválido ou erro de rede → false. */
async function ehAdmin(request) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return false;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/is_admin`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
      },
      body: '{}',
    });
    if (!res.ok) return false;
    return (await res.json()) === true;
  } catch {
    return false;
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequestPost({ request, env }) {
  if (!(await ehAdmin(request))) return json({ error: 'Não autorizado.' }, 401);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'JSON inválido.' }, 400);
  }
  const key = (body?.key || '').replace(/^\/+/, '');
  // Só remove chaves do próprio R2 (uuid.ext). URLs antigas do Supabase são ignoradas.
  if (!key || key.includes('/')) return json({ ok: true, skipped: true });

  await env.CATALOGO.delete(key);
  return json({ ok: true });
}
