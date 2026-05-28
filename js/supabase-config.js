// ⚠️ SUBSTITUA os valores abaixo com as credenciais do seu projeto Supabase
// Painel → Settings → API

const SUPABASE_CONFIG = {
  url: 'https://demxedudbislzausvhwx.supabase.co',
  anonKey: 'sb_publishable_rfGhG8zjFnRgwzIBEN2Glw_vCWMBqeG'
};

const PIX_CHAVE  = 'cocarsagrado@gmail.com';
const PIX_NOME   = 'Cocar Sagrado';
const PIX_CIDADE = 'Guarapari';

if (window.supabase && typeof window.supabase.createClient === 'function') {
  window.supabase = window.supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey);
} else {
  console.error('Supabase SDK não carregado. Verifique a conexão com a CDN.');
}

