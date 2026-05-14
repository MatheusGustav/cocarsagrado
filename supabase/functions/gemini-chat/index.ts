import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const SYSTEM_PROMPT = `Você é um assistente virtual do Cocar Sagrado, espaço de consultas espirituais com Matheus e Camila.
Responda dúvidas sobre os serviços do catálogo de forma amigável, acolhedora e concisa.
Não invente informações. Se não souber algo, oriente o cliente a entrar em contato diretamente.
Para agendar, o cliente deve clicar no botão "Agendar" de cada serviço no site.

SERVIÇOS — MATHEUS:
- Conselho (R$20): Orientação geral sobre os caminhos do consulente, com aprofundamento breve. Pode focar em área específica da vida.
- Amarração de Igbo / Pergunta Avulsa (R$30 = 1 pergunta · R$50 = 2 · R$70 = 3): Consulta no jogo de búzios com perguntas específicas.
- Combo + 10 (R$150): Consulta feita por mensagem. Leitura especial com agenda exclusiva.
- Consulta Ao Vivo (R$200): Consulta completa por videochamada. Leitura especial com agenda exclusiva.
- Confirmação de Orixás (R$50): Identifica e confirma os orixás regentes do consulente.
- Cabala de Odu (R$50): Leitura baseada na cabala dos odus do jogo de búzios.
- Confirmação de Exu (R$70): Identifica e confirma o Exu do consulente.

SERVIÇOS — CAMILA:
- Mesa Cigana Avulsa (R$30 = 1 pergunta · R$50 = 2 · R$70 = 3): Leitura de tarot cigano com perguntas específicas.
- Mesa Cigana Completa (R$150): Leitura completa do tarot cigano.
- Águas de Oxum (R$50): Ritual de limpeza e conexão com a energia de Oxum.
- Rosa de Vênus (R$55): Leitura especial com a energia de Vênus.
- Leitura dos Mentores (R$50): Conexão e mensagens de guias e mentores espirituais.
- Mesa Mediúnica (R$70): Leitura mediúnica completa.
- Mesa Radiônica (R$222): Trabalho radiônico completo de harmonização e cura.
- Registros Akáshicos (R$188): Acesso e leitura dos registros akáshicos da alma.
- Theta Healing (R$150): Sessão de cura quântica com a técnica Theta Healing.`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const { message, history } = await req.json();
    if (!message?.trim()) {
      return new Response(JSON.stringify({ error: "message required" }), { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });
    }

    const contents = [
      ...(Array.isArray(history) ? history : []),
      { role: "user", parts: [{ text: message }] },
    ];

    const res = await fetch(GEMINI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents,
        generationConfig: { temperature: 0.7, maxOutputTokens: 400 },
      }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || "Gemini API error");

    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || "Não consegui processar sua mensagem.";
    return new Response(JSON.stringify({ reply }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
