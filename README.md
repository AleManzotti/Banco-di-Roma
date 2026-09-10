# SGE — Sistema de Gestão de Crédito

Sistema de gestão de clientes, contratos de empréstimo, parcelas, contas a receber e pagamentos.

## Como rodar

Precisa do Node.js instalado (versão 18 ou superior). Se não tiver: https://nodejs.org

No terminal, dentro desta pasta:

```bash
npm install
npm run dev
```

O navegador abre em http://localhost:5173

## Comandos

| Comando | O que faz |
| --- | --- |
| `npm run dev` | Roda em modo desenvolvimento, com recarga automática ao salvar |
| `npm run build` | Gera a versão de produção na pasta `dist` |
| `npm run preview` | Serve a pasta `dist` para conferir antes de publicar |

## Estrutura

```
src/
  App.jsx      todo o sistema (telas, cálculos, estado)
  main.jsx     ponto de entrada do React
  index.css    Tailwind
index.html     página base
```

## Onde ficam os dados

Hoje tudo roda no navegador e é salvo no `localStorage`, na chave `sge-dados-v1`.
Isso significa: os dados são só daquele navegador, naquele computador, e somem se
o usuário limpar os dados do site.

Para virar sistema de verdade (vários usuários, login, dados no servidor) o próximo
passo é criar um backend com banco relacional. As tabelas estão descritas na
especificação: `users`, `customers`, `customer_contacts`, `contracts`,
`installments`, `payments`, `audit_logs`.

Para zerar e voltar aos dados de demonstração, use o link no rodapé do menu lateral,
ou apague a chave `sge-dados-v1` no DevTools (F12 → Application → Local Storage).

## Regras de negócio já implementadas

- Cálculo de empréstimo pela Tabela Price, nos dois sentidos:
  - informando o valor da parcela, calcula a quantidade de parcelas
  - informando a quantidade de parcelas, calcula o valor da parcela
- Geração automática do carnê de parcelas, com juros sobre o saldo devedor
  e ajuste do resíduo de arredondamento na última parcela
- Situação da parcela calculada na hora: Aberto, Vence hoje, Vencido, Parcial, Pago
- Situação do contrato automática: Em andamento enquanto houver saldo, Quitado ao final
- Pagamento parcial, com atualização de saldo da parcela e do contrato
- Validação de CPF e CNPJ por dígito verificador
- Histórico de auditoria por contrato
