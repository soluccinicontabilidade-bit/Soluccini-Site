# SOLUCCINI. Sistema de gestão

Sistema web do escritório: clientes PF e PJ, documentos, BPO financeiro, contabilidade e IRPF.
Interface em português, com prioridade para o celular, seguindo o Brandbook SOLUCCINI v1.0.

## Situação por fase

| Fase | Conteúdo | Situação |
|---|---|---|
| 1 | Acesso com 2FA, perfis, escritório, clientes, sócios, contratos, documentos, carteiras, importação de clientes | **Pronta** |
| 2 | Plano de contas, partidas dobradas, relatórios contábeis e fechamento | **Pronta** |
| 3 | Financeiro BPO e extratos OFX | A fazer |
| 4 | Conciliação bancária e ligação com a contabilidade | A fazer |
| 5 | IRPF | A fazer |
| 6 | Portal do cliente e painel | A fazer |
| 7 | Cobrança (boleto/Pix) e assinatura | A fazer |

## Contabilidade (fase 2)

- **Plano de contas:** modelo padrão do escritório (ponto de partida, a revisar pelo contador; sem
  códigos referenciais inventados), copiado para cada cliente e editável. Também importa de planilha.
  Contas marcadas como *caixa e equivalentes* alimentam o fluxo de caixa e o fechamento.
- **Lançamentos:** partidas dobradas com várias linhas; débitos e créditos conferidos na tela e no banco.
  Edição só com o mês aberto; depois disso, estorno (lançamento invertido, ligado ao original).
- **Saldos iniciais:** por planilha (conta, débito, crédito); só entram se fecharem.
- **Mês:** aberto → em conferência (travado) → fechado pelo contador, em ordem cronológica. Até a
  conciliação bancária (fase 4), cada conta de caixa com saldo precisa de justificativa para fechar.
  Reabertura só pelo contador, do mês mais recente para o mais antigo, com motivo.
- **Apuração do resultado** do exercício contra uma conta do patrimônio líquido.
- **Relatórios:** diário, razão, balancete, balanço, DRE e fluxo de caixa (método direto, com rateio
  proporcional das contrapartidas), em tela e em PDF, XLSX e CSV com cabeçalho do cliente e do período.
  Cada exportação fica registrada no histórico do cliente.
- **Perfis:** analista de BPO lança e envia para conferência; só o contador fecha e reabre;
  plano de contas e importações com administrador e contador.

## Rodar localmente

Requer Node 22 e Docker.

```bash
cp .env.example .env                      # gere CHAVE_CIFRA e CHAVE_INDICE com: openssl rand -base64 32
docker compose up -d                      # PostgreSQL 16 e armazenamento S3 local
npm install
npm run db:migrate                        # aplica as migrações com o usuário dono
npm run db:seed                           # escritório de demonstração; mostra as senhas no terminal
npm run dev                               # http://localhost:3000
```

No primeiro acesso, cada pessoa lê um QR code com um aplicativo autenticador (Google
Authenticator, Microsoft Authenticator etc.) e guarda 10 códigos de recuperação.

## Testes

```bash
npm run lint                                                       # checagem de tipos
TEST_DATABASE_URL=postgresql://app_user:...@localhost:5432/soluccini_teste npm test
E2E_URL=http://localhost:3000 E2E_SENHA=... npm run test:e2e      # navegador, com o banco de demonstração
PGTEST="-h localhost -p 5432 -d banco_vazio" prisma/sql/teste_regras.sh   # regras contábeis no banco
```

O banco de teste precisa das migrações aplicadas. Sem `TEST_DATABASE_URL`, os testes de integração são pulados.

## Segurança e LGPD

- **Isolamento entre escritórios no próprio banco** (Row Level Security). A aplicação conecta com um
  usuário sem privilégios. Sem o escritório definido na transação, nenhuma linha aparece.
- **Dentro do escritório:** analista vê só a própria carteira; administrador e contador veem tudo.
- **Senhas:** argon2id. Bloqueio de 15 minutos após 5 tentativas. Sessão de 12 h, encerrada após 2 h sem uso.
- **2FA obrigatório** (TOTP) para todos. O administrador pode redefinir senha e 2FA de quem perdeu o celular.
- **CPF/CNPJ cifrados** (AES-256-GCM), buscáveis por índice cego. Na tela aparecem mascarados; ver o número
  completo fica registrado na linha do tempo do cliente.
- **Documentos cifrados** antes de ir para o armazenamento, com SHA-256 por versão. Cada download é registrado.
- **Auditoria automática e imutável** de toda alteração (quem, quando, antes e depois), sem senhas nem dados cifrados.
- **Exclusão sempre lógica** em dados financeiros e documentos.

## Estrutura

```
prisma/schema.prisma          tabelas
prisma/migrations/            migrações (regras do banco incluídas)
prisma/seed.ts                dados de demonstração
src/lib/                      regras de negócio (sem dependência do Next.js, testáveis)
src/app/(publico)/            entrada, 2FA
src/app/(interno)/            painel, clientes, importação, carteiras, equipe, conta
public/marca/                 logotipo e símbolo extraídos do brandbook
tests/                        unidade, integração (PostgreSQL) e ponta a ponta (Playwright)
```

## Pendências conhecidas da fase 1

- Envio de e-mail ainda não existe: a senha temporária aparece na tela para o administrador entregar.
- Se a gravação no banco falhar depois do upload, o arquivo cifrado fica órfão no armazenamento (não é
  acessível). Uma rotina de limpeza entra junto com as filas de tarefas.
- Limite de tentativas é por usuário; limite por IP fica para o proxy/hospedagem.
- A importação de clientes roda na hora (adequado para até 2.000 linhas); as filas entram com os extratos (fase 3).
- O código do aplicativo autenticador pode ser reaproveitado dentro da mesma janela de 30 segundos
  (sem bloqueio de reuso); entra no reforço de segurança da fase 6.
- O fluxo de caixa agrupa por conta de contrapartida; separar em atividades operacionais, de investimento
  e de financiamento depende de uma classificação a definir com o contador.
- Os testes de ponta a ponta usam o banco de demonstração (`npm run db:seed`).
