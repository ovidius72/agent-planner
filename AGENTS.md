# AGENTS.md

Questo file definisce le regole di **sviluppo** dell'estensione Agent Plan (il prodotto): agenti Pi, Claude Code, Codex o contributor umani che lavorano SUL codice di agent-plan.

Le **regole di comportamento del planner** (valide in *ogni* progetto che usa l'estensione: Pi, MCP / Claude Code / Codex, futuri harness) NON vivono qui. Sono caricate dal planner all'avvio da `.planner/rules.json` (o dal set canonico in `packages/plan-core/src/planner-rules.ts`) e mostrate nel recap. Sono statiche (nessun timestamp) così non divergono tra worktree/branch. AGENTS.md non deve duplicarle.

Questo documento è un file di governance indipendente del planner. Viene modificato solo su esplicita richiesta dell'utente e non è tracciato come entità planner (`feature`/`phase`/`task`).

## Regole non negoziabili

### 4. Il core deve restare harness-agnostic

Il dominio del piano non deve dipendere da Pi.
Pi è un adapter. Anche altri harness dovranno poter leggere e usare il piano.

Implicazioni:

- evitare coupling del core con API specifiche di Pi
- preferire modelli dati, API e file format aperti
- progettare pensando a Pi, Claude Code, Codex e futuri adapter

### 9. Stack deciso finora

Direzione corrente:

- frontend: React + TypeScript
- backend locale: Hono su Node.js
- comunicazione real-time: WebSocket
- validazione: Zod
- bundling: Vite
- package manager: pnpm (workspace monorepo)
- runtime: Node.js ≥25
- architettura: platform core + adapter Pi + MCP server
- persistenza planner: file JSON in `.planner/`

### 11. Fonte dei requisiti correnti

Documenti da leggere prima di modificare architettura o processo:

- `AGENTS.md`
- `PROJECT.md`
- `ROADMAP.md`
- le entità planner rilevanti della feature/fase/task coinvolta

### 13. Branching & Release

Il progetto segue un flusso a più rami:

- **`develop`**: ramo di integrazione per il lavoro quotidiano.
- **`main`**: ramo di release; riceve modifiche esclusivamente tramite PR di release.
- **`next`**: ramo **sperimentale** e **long-running** dedicato a sviluppi di prova, esperimenti e iterazioni non ancora stabilizzate. Resta attivo fintantoché ci sono attività sperimentali in corso.

Regole operative:

- **Branch di partenza**: il branch di partenza è indicato dallo sviluppatore.
  - Feature stabili: `git switch develop && git pull && git switch -c feature/<nome>`
  - Feature sperimentali: `git switch next && git pull && git switch -c feature/<nome>`
- **PR verso il branch corretto**: il lavoro quotidiano si integra con PR verso il branch indicato dallo sviluppatore (`develop` o `next`). È vietato pushare direttamente su `main`, `develop`, `next` o qualsiasi altro branch senza PR.
- **Approvazione obbligatoria per commit e PR**: `git commit`, `git push`, merge, release, publish, install globale, pulizia di `node_modules`/lockfile e ogni altra operazione che modifichi il repository o l'ambiente devono essere **espressamente richiesti e approvati dall'utente** prima di essere eseguiti. Non eseguire mai commit o PR di propria iniziativa.
- **`main` è solo release**: `main` riceve modifiche **esclusivamente** via PR di release (`release/v<versione>` create dallo script `release`). Il merge della PR di release su `main` è l'atto di release.
- **Pubblicazione automatica**: il workflow `.github/workflows/publish.yml` pubblica su npm **solo** al merge di una PR su `main` (trigger `push: branches:[main, next]`). Il merge su `develop` **non** pubblica (è staging).
- **Versioning unificato per core**: i package core (`@agent-plan/core`, `@agent-plan/mcp`, `@agent-plan/server`, `agent-plan`) condividono **una sola versione** per release, gestita dallo script `pnpm release`.
- **Versioning indipendente per pi-adapter**: `@agent-plan/pi-adapter` può essere bumpato indipendentemente tramite `pnpm release:bump:adapter`.
- **Script `release`**: `pnpm release [-- patch|minor|major|X.Y.Z]` (default `patch`) fa tutto — verifica pre-flight (clean tree, su `develop` aggiornato), calcola la versione unificata (`bump(max(versioni correnti), livello)` con guardia anti-downgrade), crea branch `release/v<versione>` da `develop`, bumpa i package core, `pnpm install` + build + check (con rollback su fallimento), commit, push, apre PR **verso `main`**. Anteprima con `pnpm release -- --dry-run`.
- **Script `release:bump:adapter`**: `pnpm release:bump:adapter [-- patch|minor|major|X.Y.Z]` bumpa `@agent-plan/pi-adapter` in modo indipendente con guardia anti-downgrade.
- **Dopo la release**: una volta mergiata la PR su `main` (pubblicazione automatica), sincronizzare `develop`: `git switch develop && git pull && git merge origin/main && git push`.
- **Branch di prova/esperimento**: le iterazioni su fix non ancora verificate (probe, esperimenti, tentativi A/B) vanno su un branch `experiment/*` o `wip/*` — **mai committare prove direttamente su `next` o `develop`**. Si mergea su `next`/`develop` solo quando la fix è verificata funzionante (build + check verdi + comportamento confermato). Questo tiene pulito il canale di prerelease/staging.
- **Validazione CI**: `.github/workflows/ci.yml` esegue `build + check` su `develop` e su ogni PR. Il codice deve essere verde prima del merge.
- **Branch di default**: `develop` è il default branch su GitHub, quindi le nuove PR (feature) puntano a `develop`. Le PR di release puntano a `main`.

### 14. AGENTS.md modification policy

`AGENTS.md` è un file di governance del progetto indipendente dal planner.

- Non viene tracciato come `feature`/`phase`/`task`.
- Viene modificato **solo su esplicita richiesta dell'utente**.
- L'agente non aggiorna `AGENTS.md` di propria iniziativa, anche se rileva inconsistenze o gap.
- Se l'utente chiede una modifica, l'agente deve comunque seguire il Pre-flight Protocol e attendere conferma prima di committare.

### 15. Vietato usare GSD in questo progetto

In questo progetto il planner Agent Plan è l'unica fonte di verità operativa. L'uso di skill o workflow GSD (`gsd-*`) è **vietato** perché potrebbe creare conflitti tra il planner locale e eventuali sistemi di pianificazione alternativi, duplicare task o disallineare lo stato.

Regole:

- non attivare skill GSD (`gsd-discuss-phase`, `gsd-plan-phase`, `gsd-execute-phase`, ecc.)
- non usare workflow GSD
- non reinterpretare comandi `/planner * discuss` come workflow GSD
- usare esclusivamente il modello dati `.planner/`, i tool del planner e le regole di Agent Plan

## Comportamento atteso dagli agenti

Quando lavori sullo sviluppo di agent-plan:

1. leggi `AGENTS.md`

### Pre-flight Protocol (Mandatory)

Prima di eseguire qualsiasi azione che modifichi codice, configurazione, piano, repository o ambiente — inclusi ma non limitati a:

- iniziare una nuova fase, feature o task
- modificare file esistenti (refactor, hotfix, tuning, fix di bug)
- creare nuovi file o package
- eseguire `git commit`, `git push`, merge, rebase
- aprire una PR verso qualsiasi branch
- rilasciare, pubblicare o installare pacchetti
- modificare `.gitignore`, CI, workflow, script di release
- pulire `node_modules`, lockfile o build artifacts
- cambiare dipendenze

l'agente deve:

1. **Dichiarare l'intento**: "Sto per [azione specifica]."
2. **Specificare i mezzi**: "Per farlo, userò [strumento A, tool B, o modifica al file C]."
3. **Richiedere approvazione**: "Procedo?"

L'agente deve attendere la conferma esplicita dell'utente prima di eseguire la modifica.

### Planner Discuss Mode (Mandatory)

Quando l'utente usa i flussi `planner project/phase/task/feature discuss`, l'agente deve restare nel dominio **Agent Plan**.

Regole:

- non attivare workflow, skill o comandi GSD
- non reinterpretare `discuss` come workflow GSD
- non proporre milestone/phase orchestration GSD se l'utente sta lavorando nel planner locale
- usare solo il modello dati `.planner/`, le regole del planner e le domande utili alla discovery

## Regola finale

Se svolgi lavoro senza aggiornare il planner, stai violando il processo del progetto.
