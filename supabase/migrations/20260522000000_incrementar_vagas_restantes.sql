-- ============================================================
-- Função para devolver vaga em disponibilidade_especial
-- (usada quando admin cancela ou apaga um agendamento especial)
-- ============================================================
create or replace function public.incrementar_vagas_restantes(
  p_profissional text,
  p_data date
)
returns void as $$
begin
  update public.disponibilidade_especial
  set vagas_restantes = least(vagas_restantes + 1, vagas_total)
  where profissional = p_profissional
    and data = p_data;
end;
$$ language plpgsql;

grant execute on function public.incrementar_vagas_restantes to anon;
