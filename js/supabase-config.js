// ⚠️ SUBSTITUA os valores abaixo com as credenciais do seu projeto Supabase
// Painel → Settings → API

const SUPABASE_CONFIG = {
  url: 'https://demxedudbislzausvhwx.supabase.co',
  anonKey: 'sb_publishable_rfGhG8zjFnRgwzIBEN2Glw_vCWMBqeG'
};

const MP_PUBLIC_KEY = 'APP_USR-6ad0afb6-926f-48fe-a092-53c4b32105a4';

if (window.supabase && typeof window.supabase.createClient === 'function') {
  window.supabase = window.supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey);
} else {
  console.error('Supabase SDK não carregado. Verifique a conexão com a CDN.');
}

