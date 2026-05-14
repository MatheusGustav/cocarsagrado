import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY");
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const SYSTEM_PROMPT = `Você é um assistente virtual do Cocar Sagrado, espaço de consultas espirituais com Matheus e Camila.
Seja direto, objetivo e claro. Responda em 1 a 3 frases no máximo. Não repita informações nem enrole.
Cumprimente brevemente apenas na primeira mensagem. Nas seguintes, vá direto ao ponto.
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

    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      ...(Array.isArray(history) ? history : []),
      { role: "user", content: message },
    ];

    const res = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages,
        temperature: 0.5,
        max_tokens: 180,
      }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || "Groq API error");

    const reply = data.choices?.[0]?.message?.content || "Não consegui processar sua mensagem.";
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
