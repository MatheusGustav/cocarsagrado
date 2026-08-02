/* ============================================================
   COCAR SAGRADO — Admin: Cabala de Odu (embutido no card)
   Só nas leituras do Matheus: o card aberto ganha o botão
   "Gerar cabala", que desenha a cruz calculada da data de
   nascimento do cliente (soma dos algarismos; reduz somando
   os algarismos sempre que passar de 16; os lados somam os
   odus já reduzidos). Clique num ponto mostra o resumo.
   Integração (admin-system.js): _cabalaMontarCard(slot, ag).
   ============================================================ */

const CABALA_TERAPEUTA = 'matheus';

// ---- os 16 odus: nome, título e resumo (uso interno do painel) ----
const CABALA_ODUS = {
  1: {
    nome: 'Okànrán-Meji', titulo: 'O Fogo que Move e Destrói',
    resumo: 'Regido por Exu, elemento fogo; governa a voz e tudo que a produz. No positivo: o poder da palavra que abre caminhos, viradas rápidas, intuição afiada e mão forte pra magia. No negativo: temperamento explosivo, inveja e inimigos ocultos, quedas repentinas e autossabotagem. Trabalha melhor por conta própria; o desafio é domar o próprio fogo.',
  },
  2: {
    nome: 'Ejiokô-Meji', titulo: 'A Incerteza e a Indecisão',
    resumo: 'Ligado a Ibeji, elemento terra; energia do que ainda está se formando — daí a dúvida constante. No positivo: união, casamento, parcerias, boas notícias, gravidez e veia artística. No negativo: melancolia, inveja alheia, risco de perder tudo e atraso de vida. Regra de ouro: discrição total — não contar planos nem ganhos. Cuidado com comida e bebida enfeitiçadas; pontos fracos: fígado e vesícula.',
  },
  3: {
    nome: 'Etaogundá-Meji', titulo: 'A Perseverança e a Obstinação',
    resumo: 'Regido por Obaluaiê com Ogum; luta, cortes e justiça — vitória só pelo esforço. No positivo: superação de inimigos e obstáculos, herança, construção, autoridade e respeito. No negativo: brigas, traições, acidentes e envolvimento com polícia/justiça. Proibido álcool; não portar armas. Aprender a ceder — não dá pra viver no olho por olho.',
  },
  4: {
    nome: 'Iorossun-Meji', titulo: 'O Destino Firme, a Cólera e a Resistência',
    resumo: 'Regido por Iemanjá; caminhos pesados, mas prósperos — sofre pra andar, chega longe. Caráter firme, autoridade natural, renasce das piores situações. No negativo: cólera, calúnias, acidentes, ligação com Eguns e miséria súbita. Corpo: coração, circulação, cabeça e ventre. Evitar guardar mágoa e explosões; aqui o espiritual e o material andam amarrados.',
  },
  5: {
    nome: 'Oxê-Meji', titulo: 'O Brilho e a Fama',
    resumo: 'Regido por Oxum, elemento água; beleza, magnetismo, sensibilidade e fertilidade em tudo. No positivo: transformação profunda, prosperidade súbita, cura e encantamento natural. No negativo: instabilidade emocional, ilusões amorosas, vaidade e ataques espirituais; a emoção vira doença no ventre e nos hormônios. Tratar o emocional antes de qualquer coisa; banhos de Oxum.',
  },
  6: {
    nome: 'Obará-Meji', titulo: 'O Brilho, o Destaque e a Prosperidade',
    resumo: 'Regido por Xangô com Oxum e Iansã; fogo, liderança e o dom de virar a mesa. No positivo: vitórias súbitas, reconhecimento, oratória e realização rápida quando foca. No negativo: orgulho, explosão verbal, ego e projetos abandonados no meio. Corpo: coração, pressão e garganta — a boca é o portal. Medicina: respirar antes de responder e concluir o que começa.',
  },
  7: {
    nome: 'Odi-Meji', titulo: 'O Mistério, a Profundidade e o Renascimento',
    resumo: 'Regido por Obaluaiê, elemento terra; mistério, profundidade e portas que só abrem com maturidade. No positivo: prosperidade construída com persistência, resiliência rara, intuição que lê pessoas e ambientes. No negativo: estagnação, desconfiança, isolamento e rancor guardado. Corpo: ossos, dentes, rins e coluna. Trabalho de vida: perdão, falar mais e não sumir do mundo.',
  },
  8: {
    nome: 'Ejionilê-Meji', titulo: 'A Impaciência e a Agitação',
    resumo: 'Regido por Oxaguiã; ar com fogo dentro — o mais dinâmico dos odus. Mente veloz, criatividade, vitória rápida e força de recomeço, como o sol que nasce todo dia. No negativo: confusão mental, explosões, decisões precipitadas e estagnação por excesso de energia. Corpo: pulmões, coluna e sistema nervoso. Nunca decidir com raiva; canalizar o fogo no corpo (exercício, arte).',
  },
  9: {
    nome: 'Osá-Meji', titulo: 'O Movimento, a Magia e a Desconcentração',
    resumo: 'Regido por Iansã, elemento água; movimento, magia e intuição que percebe antes de acontecer. No positivo: carisma, liderança protetora, cura emocional e proteção das forças femininas ancestrais. No negativo: teimosia, autoritarismo, falsas amizades, dívidas e questões com Egungun. Corpo: sangue, coração e circulação. Cuidado inegociável: frequentar templo espiritual.',
  },
  10: {
    nome: 'Ofún-Meji', titulo: 'O Mistério, a Longevidade e os Segredos da Vida e da Morte',
    resumo: 'Regido por Oxalufã, elemento ar; alma antiga, longevidade e os segredos da vida e da morte. Honesto, leal, com prosperidade tardia porém sólida. No negativo: rancor silencioso, avareza e tristeza mascarada de serenidade — adoece por dentro, sem alarde. Corpo: cabeça, pressão e abdome; atenção a cirurgias. Preferir roupa clara; nunca provocar quem é deste odu.',
  },
  11: {
    nome: 'Owarin-Meji', titulo: 'A Ansiedade, Intensidade, Sedução e Risco',
    resumo: 'Regido por Iansã com Exu; intensidade, sedução e risco — força extrema que exige controle. No positivo: coragem, prosperidade cedo, mediunidade e vitória sobre inimigos ocultos. No negativo: ansiedade extrema, vícios, atração por perigo e perdas rápidas; quando a saúde falha, falha depressa. Corpo: abdome, digestivo e reprodutor. Regra única: calma, disciplina e ritual constante.',
  },
  12: {
    nome: 'Ejiloseborá-Meji', titulo: 'A Justiça, o Discernimento e o Confronto entre Forças',
    resumo: 'Regido por Xangô; o odu da justiça — tudo o que se faz volta com peso. No positivo: vitória em situações difíceis, ética, estratégia e crescimento depois das crises. No negativo: brigas desnecessárias, ciúme, problemas judiciais e rancor acumulado. Corpo: músculos, nervos e circulação — tensão, insônia e dor de cabeça. Escolher as batalhas; justiça sem consciência vira punição.',
  },
  13: {
    nome: 'Ejioligibán-Meji (Oyèkú)', titulo: 'A Tranquilidade, a Concentração e o Fim Necessário',
    resumo: 'Regido por Nanã com Obaluaê; terra profunda, o princípio do encerramento — todo fim é portal. No positivo: força silenciosa, renasce de grandes perdas, encerra ciclos tóxicos sem volta. No negativo: isolamento extremo, apego ao passado, luto constante e vulnerabilidade a Egum. Corpo: pernas, coluna e digestivo; estados depressivos. Soltar também é poder — não fazer da dor uma identidade.',
  },
  14: {
    nome: 'Iká-Meji', titulo: 'O Conhecimento, a Sabedoria e a Prova Constante',
    resumo: 'Regido por Oxumarê, elemento água; sabedoria conquistada na prova que se repete. No positivo: reinvenção depois das quedas, inteligência estratégica, magnetismo e prosperidade. No negativo: impulsividade extrema, vinganças, perda rápida de dinheiro e inimigos ocultos. Corpo: tórax, articulações, fígado e pele — males que vão e voltam. Não repetir erro consciente; quem troca de pele sobrevive.',
  },
  15: {
    nome: 'Ogbeogundá-Meji', titulo: 'A Guerra Interna, o Conflito entre Impulso e Consciência',
    resumo: 'Regido por Obá com Ewá; a guerra interna entre impulso e consciência — odu da prova. No positivo: coragem nos momentos críticos, espírito protetor, luta por justiça. No negativo: cólera, ciúmes, brigas em casa e no trabalho, arrependimento depois. Corpo: audição (a marca é não ouvir conselhos), nervos e inflamações. Pensar antes de agir; com discernimento, a guerra vira justiça.',
  },
  16: {
    nome: 'Aláfia-Onan', titulo: 'A Paz, a Verdade e o Equilíbrio do Ser',
    resumo: 'Regido por Ifá (Orunmilá), elemento água; a paz verdadeira — domínio sobre os instintos, não passividade. No positivo: diplomacia, sabedoria, palavra que convence e sorte em acordos. No negativo: indecisão, dupla palavra, prometer demais e se anular pra agradar. Corpo: saúde geral; estresse prolongado vira apatia. Aprender a dizer não e sustentar escolhas; branco aos domingos.',
  },
};

// ---- o que cada ponto da cruz representa ----
const CABALA_PONTOS = {
  nascimento: { rotulo: 'Nascimento',    sig: 'essência, missão de vida e espiritual' },
  cabeca:     { rotulo: 'Cabeça',        sig: 'pensamento, intelecto, raciocínio e leitura do mundo' },
  pes:        { rotulo: 'Pés',           sig: 'vida profissional, acadêmica, caminhos e decisões materiais' },
  direito:    { rotulo: 'Lado Direito',  sig: 'dons, forças, virtudes e proteção espiritual' },
  esquerdo:   { rotulo: 'Lado Esquerdo', sig: 'desafios, provações e vulnerabilidades' },
  centro:     { rotulo: 'Centro',        sig: 'alma, inconsciente, força interna — o que move e paralisa' },
};

// ---- cálculo ----
// Reduz somando os algarismos enquanto passar de 16.
function _cabReduz(n) {
  while (n > 16) n = String(n).split('').reduce((s, d) => s + Number(d), 0);
  return n;
}

// nasc no formato do banco (YYYY-MM-DD). Colunas com o ano completo em
// duas linhas (19|98): esquerda = cabeça, direita = pés. Lados e centro
// somam os odus já reduzidos.
function _cabCalcular(nasc) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(nasc || ''));
  if (!m) return null;
  const [a1, a2, a3, a4] = m[1].split('').map(Number);
  const [m1, m2]         = m[2].split('').map(Number);
  const [d1, d2]         = m[3].split('').map(Number);

  const nascimento = _cabReduz(d1 + d2 + m1 + m2 + a1 + a2 + a3 + a4);
  const cabeca     = _cabReduz(d1 + m1 + a1 + a3);
  const pes        = _cabReduz(d2 + m2 + a2 + a4);
  const direito    = _cabReduz(cabeca + pes);
  const esquerdo   = _cabReduz(cabeca + pes + direito);
  const centro     = _cabReduz(cabeca + pes + direito + esquerdo);
  return { nascimento, cabeca, pes, direito, esquerdo, centro };
}

// ---- desenho da cruz ----
function _cabPontoSvg(id, num, x, y, labelY) {
  const p = CABALA_PONTOS[id];
  const odu = CABALA_ODUS[num];
  return `
    <g class="cab-ponto" data-ponto="${id}">
      <title>${p.rotulo} — ${num}${odu ? ' · ' + odu.nome : ''}</title>
      <circle class="cab-hit" cx="${x}" cy="${y - 7}" r="26"></circle>
      <text class="cab-num" x="${x}" y="${y}" text-anchor="middle">${num}</text>
      <text class="cab-rotulo" x="${x}" y="${labelY}" text-anchor="middle">${p.rotulo.toLowerCase()}</text>
    </g>`;
}

function _cabCruzSvg(cab) {
  return `
  <svg class="cabala-cruz" viewBox="0 0 320 250" role="img" aria-label="Cabala de odu">
    <line x1="160" y1="55"  x2="160" y2="195"></line>
    <line x1="60"  y1="125" x2="260" y2="125"></line>
    <line x1="152" y1="117" x2="104" y2="74"></line>
    ${_cabPontoSvg('nascimento', cab.nascimento, 88, 62, 40)}
    ${_cabPontoSvg('cabeca',     cab.cabeca,    160, 42, 22)}
    ${_cabPontoSvg('pes',        cab.pes,       160, 218, 236)}
    ${_cabPontoSvg('direito',    cab.direito,   287, 131, 149)}
    ${_cabPontoSvg('esquerdo',   cab.esquerdo,   33, 131, 149)}
    <circle class="cab-centro-circulo" cx="160" cy="125" r="17"></circle>
    ${_cabPontoSvg('centro',     cab.centro,    160, 132, 158)}
  </svg>`;
}

function _cabMostrarResumo(bloco, cab, pontoId) {
  const num = cab[pontoId];
  const p   = CABALA_PONTOS[pontoId];
  const odu = CABALA_ODUS[num];
  const box = bloco.querySelector('.cabala-resumo');
  box.hidden = false;
  box.innerHTML = `
    <div class="cabala-resumo-ponto">${p.rotulo} · <span>${p.sig}</span></div>
    <div class="cabala-resumo-odu">${num}${odu ? ` — ${odu.nome}: <em>${odu.titulo}</em>` : ' — sem odu correspondente'}</div>
    ${odu ? `<p>${odu.resumo}</p>` : ''}`;
  bloco.querySelectorAll('.cab-ponto').forEach(g =>
    g.classList.toggle('ativo', g.dataset.ponto === pontoId));
}

function _cabGerar(bloco, cab) {
  bloco.innerHTML = `
    <div class="aud-bloco-label"><svg class="ico" aria-hidden="true"><use href="#ico-mais"></use></svg> Cabala de odu <span class="cabala-dica">toque num ponto da cruz</span></div>
    ${_cabCruzSvg(cab)}
    <div class="cabala-resumo" hidden></div>`;
  bloco.querySelectorAll('.cab-ponto').forEach(g => {
    g.addEventListener('click', () => _cabMostrarResumo(bloco, cab, g.dataset.ponto));
  });
}

// ---- integração com o card (chamado pelo admin-system.js) ----
window._cabalaMontarCard = function (slot, ag) {
  if (!slot || !ag || ag.terapeuta !== CABALA_TERAPEUTA) return;
  const cab = _cabCalcular(ag.cliente_nascimento);
  if (!cab) return;

  const bloco = document.createElement('div');
  bloco.className = 'cabala-bloco';
  bloco.innerHTML = `
    <button class="ag-btn ag-btn-outline ag-btn-sm" type="button" title="Gerar cabala de odu do nascimento do cliente">
      <svg class="ico" aria-hidden="true"><use href="#ico-mais"></use></svg> Gerar cabala
    </button>`;
  bloco.querySelector('button').addEventListener('click', () => _cabGerar(bloco, cab));
  slot.appendChild(bloco);
};
