-- Fase 2: contas de caixa e equivalentes.
ALTER TABLE "conta_contabil" ADD COLUMN "disponivel" BOOLEAN NOT NULL DEFAULT false;

-- Só conta do grupo ATIVO pode ser disponível.
ALTER TABLE "conta_contabil"
  ADD CONSTRAINT conta_disponivel_no_ativo CHECK (NOT disponivel OR grupo = 'ATIVO');

-- A conta-pai precisa ser sintética, do mesmo plano e do mesmo grupo.
CREATE OR REPLACE FUNCTION trg_conta_hierarquia() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE pai record;
BEGIN
  IF NEW.pai_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO pai FROM conta_contabil WHERE id = NEW.pai_id;
  IF pai.plano_id <> NEW.plano_id OR pai.analitica OR pai.grupo <> NEW.grupo THEN
    RAISE EXCEPTION 'A conta-pai % precisa ser sintética, do mesmo plano e do mesmo grupo', pai.codigo
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER conta_hierarquia BEFORE INSERT OR UPDATE ON conta_contabil
  FOR EACH ROW EXECUTE FUNCTION trg_conta_hierarquia();

-- Conta que já recebeu partidas não pode virar sintética nem mudar de grupo.
CREATE OR REPLACE FUNCTION trg_conta_com_partidas() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.analitica IS DISTINCT FROM OLD.analitica OR NEW.grupo IS DISTINCT FROM OLD.grupo)
     AND EXISTS (SELECT 1 FROM partida WHERE conta_id = OLD.id) THEN
    RAISE EXCEPTION 'A conta % já tem lançamentos: não pode mudar de tipo nem de grupo', OLD.codigo
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER conta_com_partidas BEFORE UPDATE ON conta_contabil
  FOR EACH ROW EXECUTE FUNCTION trg_conta_com_partidas();
