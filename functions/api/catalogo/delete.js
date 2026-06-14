/* ============================================================
   POST /api/catalogo/delete  — remove foto do catálogo do R2
   Body JSON: { key }    Binding R2 necessário: CATALOGO
   Auth: valida o JWT do admin (Supabase) e checa o e-mail.
   ============================================================ */

const SUPABASE_URL = 'https://demxedudbislzausvhwx.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_rfGhG8zjFnRgwzIBEN2Glw_vCWMBqeG';
const ADMIN_EMAILS = ['cocarsagrado@gmail.com'];   // espelha public.is_admin()

async function exigirAdmin(request) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return null;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY },
  });
  if (!res.ok) return null;
  const user = await res.json();
  const email = (user?.email || '').toLowerCase();
  return ADMIN_EMAILS.includes(email) ? email : null;
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequestPost({ request, env }) {
  const admin = await exigirAdmin(request);
  if (!admin) return json({ error: 'Não autorizado.' }, 401);

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
