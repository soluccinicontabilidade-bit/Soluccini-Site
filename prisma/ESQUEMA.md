# Esquema do banco: fases 1 e 2

Arquivos:

- `schema.prisma`: tabelas, campos, índices e chaves.
- `sql/regras.sql`: regras que o Prisma não expressa. Entram na primeira migração, logo depois do DDL gerado.
- `migrations/20261121000000_inicial/`: primeira migração (extensão citext, DDL do Prisma e as regras). Aplicar com `prisma migrate deploy`. Mudanças futuras nas regras entram em novas migrações; `sql/regras.sql` fica como referência legível.
- `sql/teste_regras.sh`: 27 cenários (o que deve passar e o que deve ser recusado), rodados contra PostgreSQL 16.

## Decisões principais

| Tema | Decisão |
|---|---|
| Carteiras | Um cliente pode estar em várias carteiras (ex.: BPO e IRPF). |
| Código do cliente | Sequencial por escritório (1, 2, 3...), atribuído pelo banco. |
| Pessoa x Cliente | `Pessoa` é qualquer PF ou PJ conhecida. `Cliente` é o contrato de serviço com uma Pessoa. Assim o sócio PF existe (e terá IRPF) mesmo sem contrato próprio. |
| Sócios | `VinculoSocietario` liga PJ a PF com tipo, participação (em pontos-base: 10000 = 100%) e vigência. |
| Dinheiro | `BigInt` em centavos. |
| CPF/CNPJ | Cifrado na aplicação, com hash HMAC para busca e unicidade, e os 4 últimos dígitos para exibir mascarado. |
| Honorários | Cada reajuste é uma nova linha em `ValorHonorario`; nada é sobrescrito. |
| Documentos | `Documento` (o item) + `VersaoDocumento` (cada envio, com SHA-256). |
| Plano de contas | Modelo do escritório (sem cliente) copiado para cada cliente. Só conta analítica e ativa recebe partida. Campo para código referencial da RFB, sem inventar tabela. |
| Lançamento | Número sequencial por cliente, sem buracos. Correção em período fechado só por estorno. `chave_origem` impede duplicar lançamentos automáticos. |
| Importação de planilhas | Clientes, plano de contas e saldos iniciais: valida, mostra o resumo e só grava depois de confirmado. O mesmo arquivo não é aplicado duas vezes. |
| Fechamento | Aberto, em conferência, fechado. Em conferência já trava lançamentos; para corrigir, o período volta para aberto. Toda mudança gera `TransicaoPeriodo`. Até a fase 4, conta bancária pode ser justificada (`JustificativaFechamento`). |

## O que o banco garante sozinho (testado)

1. Débitos = créditos em cada lançamento, conferido no commit, com pelo menos duas partidas e valores positivos.
2. Partida só em conta analítica e ativa do plano do próprio cliente.
3. Data do lançamento dentro da competência do período.
4. Ajuste, provisão e estorno exigem justificativa.
5. Período em conferência ou fechado não aceita incluir, alterar ou excluir lançamentos e partidas.
6. Reabrir período fechado: só o perfil contador (nem o administrador), com justificativa registrada.
7. Isolamento entre escritórios por Row Level Security: sem `app.escritorio_id` nenhuma linha aparece, e não é possível gravar em outro escritório.
8. Auditoria automática nas tabelas sensíveis (sem senhas nem dados cifrados) e imutável, inclusive para o superusuário.
9. O papel da aplicação não consegue excluir lançamentos (exclusão só lógica) nem alterar a auditoria.

## Fica na aplicação (com testes automáticos)

- Restrição por carteira (analista só vê seus clientes) e por cliente (cliente só vê os próprios dados).
- Validação de dígitos de CPF e CNPJ, 2FA, limite de tentativas.
- Conferir se todas as contas bancárias estão conciliadas ou justificadas antes de fechar (as contas entram na fase 3).

## Respostas confirmadas

1. Cliente em mais de uma carteira: sim.
2. Em conferência aceita lançamentos: não.
3. Quem reabre período fechado: só o contador.
4. Código do cliente: sequencial.
