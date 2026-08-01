/* ============================================================
   POST /api/catalogo/upload  — upload de foto do catálogo p/ R2
   Cloudflare Pages Function. Binding R2 necessário: CATALOGO
   Auth: JWT do admin validado pela RPC is_admin() (e-mail + 2º fator).
   Retorna { url, key }.
   ============================================================ */

const SUPABASE_URL = 'https://demxedudbislzausvhwx.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_rfGhG8zjFnRgwzIBEN2Glw_vCWMBqeG';
const PUBLIC_BASE = 'https://cdn.cocarsagrado.com.br';
const MAX_BYTES = 5 * 1024 * 1024;

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

/* Assinatura nos primeiros bytes — o file.type/file.name do cliente é ignorado
   (podia dizer "image/png" e mandar SVG, que é script rodando no domínio). */
const ASSINATURAS = [
  {
    ext: 'webp', mime: 'image/webp',
    casa: b => b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
               b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50,
  },
  {
    ext: 'jpg', mime: 'image/jpeg',
    casa: b => b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF,
  },
  {
    ext: 'png', mime: 'image/png',
    casa: b => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47 &&
               b[4] === 0x0D && b[5] === 0x0A && b[6] === 0x1A && b[7] === 0x0A,
  },
];

function detectarImagem(bytes) {
  if (bytes.length < 12) return null;
  return ASSINATURAS.find(a => a.casa(bytes)) || null;
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequestPost({ request, env }) {
  if (!(await ehAdmin(request))) return json({ error: 'Não autorizado.' }, 401);

  let form;
  try {
    form = await request.formData();
  } catch {
    return json({ error: 'Form inválido.' }, 400);
  }
  const file = form.get('file');
  if (!file || typeof file === 'string') return json({ error: 'Arquivo ausente.' }, 400);
  if (file.size > MAX_BYTES) return json({ error: 'Imagem muito grande (máx 5MB).' }, 400);

  // Teto de tamanho conferido antes de trazer o arquivo pra memória.
  const bytes = new Uint8Array(await file.arrayBuffer());
  const tipo = detectarImagem(bytes);
  if (!tipo) return json({ error: 'Precisa ser imagem JPEG, PNG ou WebP.' }, 400);

  // Extensão e contentType saem da assinatura, não do que o cliente mandou.
  const key = `${crypto.randomUUID()}.${tipo.ext}`;

  await env.CATALOGO.put(key, bytes, {
    httpMetadata: {
      contentType: tipo.mime,
      cacheControl: 'public, max-age=31536000, immutable',
    },
  });

  return json({ url: `${PUBLIC_BASE}/${key}`, key });
}
