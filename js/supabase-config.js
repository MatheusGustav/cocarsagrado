// ⚠️ SUBSTITUA os valores abaixo com as credenciais do seu projeto Supabase
// Painel → Settings → API

const SUPABASE_CONFIG = {
  url: 'https://demxedudbislzausvhwx.supabase.co',
  anonKey: 'sb_publishable_rfGhG8zjFnRgwzIBEN2Glw_vCWMBqeG'
};

if (window.supabase && typeof window.supabase.createClient === 'function') {
  window.supabase = window.supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey);
} else {
  console.error('Supabase SDK não carregado. Verifique a conexão com a CDN.');
}

async function testarConexao() {
  try {
    const { error } = await supabase.from('tipos_leitura').select('id').limit(1);
    if (error) throw error;
    console.log('✅ Supabase conectado!');
    return true;
  } catch (err) {
    console.error('❌ Erro Supabase:', err.message);
    return false;
  }
}
  
testarConexao();
