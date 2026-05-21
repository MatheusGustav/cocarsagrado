-- ============================================================
-- Migration: Restaura descrições originais do HTML hardcoded
-- (mantém <br> literal — renderizado como quebra pelo JS)
-- ============================================================

update public.tipos_leitura set descricao = 'Conselho geral em relação aos caminhos do consulente com aprofundamento breve. <br> é possivel pedir enfoque em alguma area especifica da vida nesta leitura.'
  where slug = 'conselho';

update public.tipos_leitura set descricao = 'Perguntas de sim ou não com direcionamento detalhado do que deve ser feito, levando em conta os pormenores da situação em que o consulente se encontra. <br> É um jogo que deve ser procurado para o auxílio em tomada de decisões.'
  where grupo_slug = 'amarracao';

update public.tipos_leitura set descricao = 'Leitura feita com aprofundamento máximo nas questões apresentadas pelo consulente. <br> Importante dizer que nesta modalidade o consulente pode passar as questões através de ligação por áudio.'
  where slug = 'combo-10';

update public.tipos_leitura set descricao = 'Sessão ao vivo por videochamada com duração de uma hora. Espaço aberto para que o consulente traga todas as questões que desejar explorar em tempo real.'
  where slug = 'consulta-ao-vivo';

update public.tipos_leitura set descricao = 'Identificação de seus orixás + explicação detalhada sobre os conceitos e como cada orixá age em sua vida.'
  where slug = 'confirmacao-orixas';

update public.tipos_leitura set descricao = 'Leitura cabalística dos odus vão falar sobre sua personalidade, pontos de atenção na area da saude, por onde ganha na vida, por onde perde, quais condutas evitar, quizilias e assim por diante.'
  where slug = 'cabala-odu';

update public.tipos_leitura set descricao = 'Confirmação de Exu ou pombagira, com orientação detalhada por escrito atraves de documento + audio explicativo. Atenção: caso a entidade não queira responder o valor é extronado.'
  where slug = 'confirmacao-exu';

update public.tipos_leitura set descricao = 'Consulta pelo baralho cigano, com respostas e orientação para determinadas questões de sua vida'
  where grupo_slug = 'mesa-cigana-avulsa';

update public.tipos_leitura set descricao = 'Consulta feita através do baralho cigano te orientando em todos as áreas da sua vida.'
  where slug = 'mesa-cigana-completa';

update public.tipos_leitura set descricao = 'Leitura com enfoque completo no amoroso. São vistos: pensamentos, sentimentos, intenções e caminhos.'
  where slug = 'aguas-oxum';

update public.tipos_leitura set descricao = 'Leitura com enfoque no autoconhecimento. São vistos: caminhos de forma ampla e como melhora-los'
  where slug = 'rosa-venus';

update public.tipos_leitura set descricao = 'Descrição do guia mais próximo de você e dos seus caminhos com mensagens dele(a).'
  where slug = 'leitura-mentores';

update public.tipos_leitura set descricao = 'Leitura do seu campo espiritual, apontando todas suas mediunidade e parapsiquismos com conselhos em relação aos cuidados necessarios'
  where slug = 'mesa-mediunica';

update public.tipos_leitura set descricao = 'Leitura do seu campo espiritual completa. Utilização de ressonâncias para fins de equilibrio dos campos sutis. Esta leitura conta com documento com orientações por escrito + audio explicativo.'
  where slug = 'mesa-radionica';

update public.tipos_leitura set descricao = 'Leitura de vidas passadas, missão de alma, leitura de futuro e mais. <br> Imersão em seus registros e orientações a respeito do que é visto.'
  where slug = 'registros-akashicos';

update public.tipos_leitura set descricao = 'Técnica de meditação profunda para reprogramar crenças limitantes e acessar o estado theta de cura.'
  where slug = 'theta-healing';
