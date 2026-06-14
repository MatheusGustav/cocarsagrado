/* ============================================================
   POST /api/catalogo/upload  — upload de foto do catálogo p/ R2
   Cloudflare Pages Function. Binding R2 necessário: CATALOGO
   Auth: valida o JWT do admin (Supabase) e checa o e-mail.
   Retorna { url, key }.
   ============================================================ */

const SUPABASE_URL = 'https://demxedudbislzausvhwx.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_rfGhG8zjFnRgwzIBEN2Glw_vCWMBqeG';
const ADMIN_EMAILS = ['matheusgustav.dev@gmail.com'];
const PUBLIC_BASE = 'https://cdn.cocarsagrado.com.br';
const MAX_BYTES = 5 * 1024 * 1024;

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

  let form;
  try {
    form = await request.formData();
  } catch {
    return json({ error: 'Form inválido.' }, 400);
  }
  const file = form.get('file');
  if (!file || typeof file === 'string') return json({ error: 'Arquivo ausente.' }, 400);
  if (!file.type?.startsWith('image/')) return json({ error: 'Precisa ser imagem.' }, 400);
  if (file.size > MAX_BYTES) return json({ error: 'Imagem muito grande (máx 5MB).' }, 400);

  const ext = (file.name?.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const key = `${crypto.randomUUID()}.${ext}`;

  await env.CATALOGO.put(key, file.stream(), {
    httpMetadata: {
      contentType: file.type,
      cacheControl: 'public, max-age=31536000, immutable',
    },
  });

  return json({ url: `${PUBLIC_BASE}/${key}`, key });
}
