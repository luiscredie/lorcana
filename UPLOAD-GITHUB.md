# Como aplicar esta atualização no GitHub

Este pacote contém somente os 10 arquivos criados ou alterados pelo commit
local `f8aa152` (`Isolate Lorcana data per user`). Ele não remove nem substitui
as imagens e os demais arquivos que já existem no repositório.

## Opção recomendada: branch e Pull Request

1. Extraia o ZIP no computador.
2. No GitHub, abra `luiscredie/lorcana` e crie uma branch chamada
   `account-isolation`.
3. Na nova branch, envie o conteúdo da pasta extraída para a raiz do
   repositório. Preserve o caminho `functions/sync.js`.
4. Use a mensagem de commit `Isolate Lorcana data per user`.
5. Abra um Pull Request de `account-isolation` para `main`.
6. Confira se o PR contém exatamente estes arquivos:

   - `ROADMAP-account-isolation.md`
   - `SETUP-sync.md`
   - `card-catalog-master.json`
   - `cloudflare-worker.js`
   - `collection.json`
   - `functions/sync.js`
   - `import-collection.mjs`
   - `index.html`
   - `simulator.html`
   - `validate-site.mjs`

7. Faça o merge após a revisão. O GitHub Pages poderá então publicar a `main`.

## Cloudflare Worker

O merge no GitHub não atualiza automaticamente o Worker. Depois do merge:

1. Copie o conteúdo completo de `cloudflare-worker.js` para o Worker atual.
2. Configure `GH_TOKEN`, `SESSION_SECRET` e `USERS` ou `USERS_KV`.
3. Faça o deploy do Worker.
4. Teste pelo menos duas contas diferentes e confirme que coleção, decks e
   games não aparecem na outra conta.

As instruções completas, incluindo formato das contas, permissões e limite de
privacidade do repositório público, estão em `SETUP-sync.md`.

## Validação local opcional

Com Node.js instalado, execute na raiz do projeto:

```bash
node validate-site.mjs
```

O resultado esperado começa com `"status": "PASS"`.
