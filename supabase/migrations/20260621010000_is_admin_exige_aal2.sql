-- ============================================================
-- is_admin() passa a exigir AAL2 (MFA completo).
--
-- Antes: is_admin() checava só o e-mail. A trava de MFA existia
-- apenas na tela do painel — quem tivesse a senha podia bater na
-- API REST direto (sessão aal1, sem 2º fator) e o is_admin()
-- liberava tudo. Agora o RLS só reconhece admin se a sessão
-- estiver elevada a aal2 (senha + TOTP verificado).
--
-- IMPORTANTE: aplique SÓ depois de inscrever o TOTP no /admin e
-- confirmar que loga até o painel (aal2). Senão o painel fica sem
-- ler/gravar dados até o MFA ser concluído (o login/enroll seguem
-- funcionando, pois não dependem de is_admin()).
-- ============================================================

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT auth.email() IN (
           'cocarsagrado@gmail.com'
           -- adicione o e-mail da Camila aqui quando a conta dela existir
         )
     AND COALESCE(auth.jwt() ->> 'aal', 'aal1') = 'aal2';
$$;
