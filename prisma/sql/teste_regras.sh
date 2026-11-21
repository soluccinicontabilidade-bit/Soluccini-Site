#!/bin/bash
# Uso: PGTEST="-h localhost -p 5432 -d banco_de_teste" prisma/sql/teste_regras.sh
# Banco vazio com: CREATE EXTENSION citext; DDL do Prisma; prisma/sql/regras.sql.
H="${PGTEST:--h localhost -p 5432 -d pd}"
psql $H -U postgres -q -c "do \$\$begin if not exists(select 1 from pg_roles where rolname='tester') then create role tester login in role app; end if; end\$\$"
E1=11111111-1111-1111-1111-111111111111; E2=22222222-2222-2222-2222-222222222222
U=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa
ctx() { echo "set local app.escritorio_id='$1'; set local app.usuario_id='$U'; set local app.perfil='${2:-ANALISTA_BPO}'; set local app.origem='teste';"; }
run() { # nome esperado(ok|erro) sql
  out=$(psql $H -U tester -q -v ON_ERROR_STOP=1 -c "begin; $3 commit;" 2>&1); rc=$?
  if [[ $2 == ok && $rc == 0 ]] || [[ $2 == erro && $rc != 0 ]]; then r=PASSOU; else r=FALHOU; fi
  printf '%-7s %-62s %s\n' "$r" "$1" "$(echo "$out" | grep -o 'ERROR:.*' | head -1 | cut -c1-90)"
}
# Seed como dono (sem RLS forçado para o superusuário)
psql $H -U postgres -q -v ON_ERROR_STOP=1 <<SQL
insert into escritorio(id,nome,cnpj_cifrado,cnpj_hash,cnpj_final,atualizado_em) values
 ('$E1','Soluccini','\x00','h1','0001',now()),('$E2','Outro','\x00','h2','0002',now());
SQL
B="$(ctx $E1)"
run "Cria pessoa PJ e cliente (código automático)" ok "$B
 insert into pessoa(id,escritorio_id,tipo,documento_cifrado,documento_hash,documento_final,nome,regime_tributario,atualizado_em)
  values ('b0000000-0000-0000-0000-000000000001','$E1','PJ','\x00','d1','0001','Padaria','SIMPLES_NACIONAL',now());
 insert into cliente(id,escritorio_id,pessoa_id,inicio_servico,atualizado_em)
  values ('c0000000-0000-0000-0000-000000000001','$E1','b0000000-0000-0000-0000-000000000001','2026-01-01',now());
 insert into plano_de_contas(id,escritorio_id,cliente_id,nome) values ('d0000000-0000-0000-0000-000000000001','$E1','c0000000-0000-0000-0000-000000000001','Plano Padaria');
 insert into conta_contabil(id,escritorio_id,plano_id,codigo,nome,grupo,natureza,nivel,analitica) values
  ('e0000000-0000-0000-0000-000000000001','$E1','d0000000-0000-0000-0000-000000000001','1','Ativo','ATIVO','DEVEDORA',1,false),
  ('e0000000-0000-0000-0000-000000000002','$E1','d0000000-0000-0000-0000-000000000001','1.1.01','Banco','ATIVO','DEVEDORA',3,true),
  ('e0000000-0000-0000-0000-000000000003','$E1','d0000000-0000-0000-0000-000000000001','3.1.01','Receita de vendas','RECEITA','CREDORA',3,true);
 insert into periodo_contabil(id,escritorio_id,cliente_id,competencia,atualizado_em) values
  ('f0000000-0000-0000-0000-000000000001','$E1','c0000000-0000-0000-0000-000000000001','2026-03-01',now());"
L="insert into lancamento_contabil(id,escritorio_id,cliente_id,periodo_id,data,historico,origem,criado_por_id) values"
PT="insert into partida(id,escritorio_id,lancamento_id,conta_id,tipo,valor_centavos,ordem) values"
C1=c0000000-0000-0000-0000-000000000001; P1=f0000000-0000-0000-0000-000000000001
BANCO=e0000000-0000-0000-0000-000000000002; REC=e0000000-0000-0000-0000-000000000003; SINT=e0000000-0000-0000-0000-000000000001
run "Lançamento equilibrado (D 150,00 = C 150,00)" ok "$B $L ('10000000-0000-0000-0000-000000000001','$E1','$C1','$P1','2026-03-10','Venda','MANUAL','$U');
 $PT (gen_random_uuid(),'$E1','10000000-0000-0000-0000-000000000001','$BANCO','DEBITO',15000,1),(gen_random_uuid(),'$E1','10000000-0000-0000-0000-000000000001','$REC','CREDITO',15000,2);"
run "Lançamento desequilibrado (D 150,00 x C 149,99) é recusado" erro "$B $L ('10000000-0000-0000-0000-000000000002','$E1','$C1','$P1','2026-03-11','x','MANUAL','$U');
 $PT (gen_random_uuid(),'$E1','10000000-0000-0000-0000-000000000002','$BANCO','DEBITO',15000,1),(gen_random_uuid(),'$E1','10000000-0000-0000-0000-000000000002','$REC','CREDITO',14999,2);"
run "Lançamento sem partidas é recusado" erro "$B $L ('10000000-0000-0000-0000-000000000003','$E1','$C1','$P1','2026-03-11','x','MANUAL','$U');"
run "Partida em conta sintética é recusada" erro "$B $L ('10000000-0000-0000-0000-000000000004','$E1','$C1','$P1','2026-03-11','x','MANUAL','$U');
 $PT (gen_random_uuid(),'$E1','10000000-0000-0000-0000-000000000004','$SINT','DEBITO',100,1),(gen_random_uuid(),'$E1','10000000-0000-0000-0000-000000000004','$REC','CREDITO',100,2);"
run "Valor zero ou negativo é recusado" erro "$B $L ('10000000-0000-0000-0000-000000000005','$E1','$C1','$P1','2026-03-11','x','MANUAL','$U');
 $PT (gen_random_uuid(),'$E1','10000000-0000-0000-0000-000000000005','$BANCO','DEBITO',-100,1),(gen_random_uuid(),'$E1','10000000-0000-0000-0000-000000000005','$REC','CREDITO',-100,2);"
run "Data fora da competência (abril em período de março)" erro "$B $L ('10000000-0000-0000-0000-000000000006','$E1','$C1','$P1','2026-04-01','x','MANUAL','$U');"
run "Ajuste sem justificativa é recusado" erro "$B $L ('10000000-0000-0000-0000-000000000007','$E1','$C1','$P1','2026-03-11','x','AJUSTE','$U');"
run "Alterar partida desequilibrando lançamento existente" erro "$B update partida set valor_centavos=1 where lancamento_id='10000000-0000-0000-0000-000000000001' and tipo='DEBITO';"
run "Fechar período sem registro de transição é recusado" erro "$(ctx $E1 CONTADOR) update periodo_contabil set situacao='FECHADO' where id='$P1';"
run "Fechar período com transição registrada" ok "$(ctx $E1 CONTADOR) insert into transicao_periodo(id,escritorio_id,periodo_id,de,para,usuario_id) values (gen_random_uuid(),'$E1','$P1','ABERTO','FECHADO','$U');
 update periodo_contabil set situacao='FECHADO' where id='$P1';"
run "Novo lançamento em período fechado é recusado" erro "$B $L ('10000000-0000-0000-0000-000000000008','$E1','$C1','$P1','2026-03-12','x','MANUAL','$U');"
run "Editar partida em período fechado é recusado" erro "$B update partida set historico_complementar='x' where lancamento_id='10000000-0000-0000-0000-000000000001';"
run "Analista não reabre período fechado" erro "$B insert into transicao_periodo(id,escritorio_id,periodo_id,de,para,justificativa,usuario_id) values (gen_random_uuid(),'$E1','$P1','FECHADO','ABERTO','erro','$U');
 update periodo_contabil set situacao='ABERTO' where id='$P1';"
run "Contador não reabre sem justificativa" erro "$(ctx $E1 CONTADOR) insert into transicao_periodo(id,escritorio_id,periodo_id,de,para,usuario_id) values (gen_random_uuid(),'$E1','$P1','FECHADO','ABERTO','$U');
 update periodo_contabil set situacao='ABERTO' where id='$P1';"
run "Contador reabre com justificativa" ok "$(ctx $E1 CONTADOR) insert into transicao_periodo(id,escritorio_id,periodo_id,de,para,justificativa,usuario_id) values (gen_random_uuid(),'$E1','$P1','FECHADO','ABERTO','NF lançada em duplicidade','$U');
 update periodo_contabil set situacao='ABERTO' where id='$P1';"
run "Mover período para em conferência" ok "$B insert into transicao_periodo(id,escritorio_id,periodo_id,de,para,justificativa,usuario_id) values (gen_random_uuid(),'$E1','$P1','ABERTO','EM_CONFERENCIA',null,'$U');
 update periodo_contabil set situacao='EM_CONFERENCIA' where id='$P1';"
run "Novo lançamento em conferência é recusado" erro "$B $L ('10000000-0000-0000-0000-000000000009','$E1','$C1','$P1','2026-03-12','x','MANUAL','$U');"
run "Editar partida em conferência é recusado" erro "$B update partida set historico_complementar='x' where lancamento_id='10000000-0000-0000-0000-000000000001';"
run "Contador fecha período em conferência" ok "$(ctx $E1 CONTADOR) insert into transicao_periodo(id,escritorio_id,periodo_id,de,para,justificativa,usuario_id) values (gen_random_uuid(),'$E1','$P1','EM_CONFERENCIA','FECHADO',null,'$U');
 update periodo_contabil set situacao='FECHADO' where id='$P1';"
run "Administrador não reabre período fechado" erro "$(ctx $E1 ADMINISTRADOR) insert into transicao_periodo(id,escritorio_id,periodo_id,de,para,justificativa,usuario_id) values (gen_random_uuid(),'$E1','$P1','FECHADO','ABERTO','correção','$U');
 update periodo_contabil set situacao='ABERTO' where id='$P1';"
run "Cliente em duas carteiras (BPO e IRPF)" ok "$(ctx $E1 ADMINISTRADOR)
 insert into usuario(id,escritorio_id,nome,email,senha_hash,perfil,atualizado_em) values ('$U','$E1','Ana','ana@x.com','h','ANALISTA_BPO',now());
 insert into carteira(id,escritorio_id,nome,responsavel_id) values ('a1000000-0000-0000-0000-000000000001','$E1','BPO','$U'),('a1000000-0000-0000-0000-000000000002','$E1','IRPF','$U');
 insert into carteira_cliente(carteira_id,cliente_id,escritorio_id) values ('a1000000-0000-0000-0000-000000000001','$C1','$E1'),('a1000000-0000-0000-0000-000000000002','$C1','$E1');"
run "Escritório 2 não enxerga dados do escritório 1 (RLS)" erro "$(ctx $E2) do \$\$begin if (select count(*) from lancamento_contabil)>0 or (select count(*) from cliente)>0 then raise exception 'vazou'; end if; raise exception 'nada visível (esperado)'; end\$\$;"
run "Escritório 2 não grava com escritorio_id do 1 (RLS)" erro "$(ctx $E2) insert into etiqueta(id,escritorio_id,nome,cor) values (gen_random_uuid(),'$E1','x','#000000');"
run "Sem app.escritorio_id não aparece nenhuma linha" erro "do \$\$begin if (select count(*) from cliente)>0 then raise exception 'vazou'; end if; raise exception 'nada visível (esperado)'; end\$\$;"
run "App não exclui lançamento (exclusão só lógica)" erro "$B delete from lancamento_contabil where id='10000000-0000-0000-0000-000000000001';"
run "App não altera auditoria" erro "$B update registro_auditoria set operacao='X';"
psql $H -U postgres -At -c "select 'auditoria: '||count(*)||' registros; numero do lançamento: '||(select numero from lancamento_contabil limit 1)||'; código do cliente: '||(select codigo from cliente limit 1) from registro_auditoria"
out=$(psql $H -U postgres -c "delete from registro_auditoria" 2>&1); echo "Superusuário apagando auditoria: $(echo $out | grep -o 'ERROR:.*' | cut -c1-70)"
