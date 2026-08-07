# AGENTS.md

Questo file definisce le regole fondamentali per chiunque lavori su questo progetto: agenti Pi, Claude Code, Codex o contributor umani.

Questo documento è un file di governance indipendente del planner. Viene modificato solo su esplicita richiesta dell'utente e non è tracciato come entità planner (`feature`/`phase`/`task`).

## Regole non negoziabili

### 1. Mantieni sempre il planner aggiornato

È obbligatorio usare il planner come unica fonte di verità operativa durante il lavoro.

Regole operative:

- leggere lo stato planner rilevante prima di iniziare
- aggiornare il planner quando un'attività parte, cambia stato, si blocca o si conclude
- annotare chiaramente prossimi passi, blocchi e decisioni nelle entità planner rilevanti
- non lasciare lavoro implicito solo nella conversazione

Riferimenti iniziali:

- `AGENTS.md`
- `PROJECT.md`
- `ROADMAP.md`
- le entità planner rilevanti (`feature_get` / `phase_get` / `task_get` / `handoff_show`)

### 2. Rispetta rigorosamente il Lifecycle dei Task

L'integrità del piano e la precisione della dashboard dipendono dalla sincronizzazione **immediata** tra l'attività dell'agente e lo stato dei task. L'aggiornamento del piano non è un'attività di "chiusura sessione", ma un prerequisito operativo.

Regole operative:

- **Sempre `task_start`**: prima di toccare una sola riga di codice, l'agente DEVE chiamare `task_start`. È l'attivazione del contesto di lavoro.
- **Sempre `task_complete`**: al termine di ogni deliverable, l'agente DEVE chiamare `task_complete`.
- **Sincronizzazione Istantanea**: i cambi di stato (start/complete/block) devono avvenire **nel momento esatto** in cui la transizione avviene. È vietato accumulare aggiornamenti di stato per l'ultima fase della sessione.
- **Sincronizzazione costante**: se l'estensione segnala "Nessun task attivo", l'agente deve regolarizzare immediatamente la situazione avviando il task corretto.
- **Stato = Verità**: se un task è `in-progress`, l'agente deve effettivamente starci lavorando. Se smette, deve chiuderlo o bloccarlo (giustificando l'azione nello `statusLog`).
- **Stato derivato, non persistito**: lo stato di feature e fase è **derivato** dai task (`syncStatuses`/rollup), non memorizzato nel JSON. Il campo `status` in `.planner/features/*.json` e `.planner/phases/*.json` può essere `null` o stale — **non leggerlo come fonte di verità**. La fonte di verità è la risposta del tool (che calcola lo stato derivato) o la Web UI, non il JSON grezzo. Un agente che legge `status: null` nel file e lo scambia per "non fatto" commette un errore.

### 3. Non usare il markdown come source of truth del piano

Il piano di progetto deve avere come fonte primaria dati strutturati in `.planner/`.
Il markdown è una vista generata, leggibile da umani e agenti.

### 4. Il core deve restare harness-agnostic

Il dominio del piano non deve dipendere da Pi.
Pi è un adapter. Anche altri harness dovranno poter leggere e usare il piano.

Implicazioni:

- evitare coupling del core con API specifiche di Pi
- preferire modelli dati, API e file format aperti
- progettare pensando a Pi, Claude Code, Codex e futuri adapter

### 5. La cartella del piano vive nel progetto target

Il piano deve vivere in:

- `.planner/`

La cartella `.planner/` contiene lo stato del piano. Può essere tracciata nel repository quando il progetto lo richiede; in caso contrario, viene esclusa da git tramite `.gitignore` a discrezione del progetto.

### 6. Il piano deve essere discusso per fasi

Per ogni fase:

- chiarire obiettivo, scope, non-scope, dipendenze, rischi e outcome
- usare `grill-me` quando disponibile
- non richiedere subito tutti i dettagli implementativi
- dettagliare l'implementazione quando la fase viene effettivamente lavorata

### 7. Convenzioni di naming

#### Phase ID

Le fasi usano numerazione globale progetto-wide (`P001`, `P002`, …). Lo slug descrittivo viene derivato automaticamente dal titolo.

#### Task name

I task usano numerazione globale progetto-wide (`T001`, `T002`, …). Lo slug descrittivo viene derivato automaticamente dal titolo e normalizzato per rispettare lo schema `SlugSchema`.

### 8. Task status changes e motivazioni

Ogni cambio di stato di un task deve essere documentato nel `statusLog` (array incrementale nel task).

#### Motivazione obbligatoria

La motivazione è **obbligatoria** quando lo stato nuovo è:

- `blocked`, `canceled`, `rejected`, `deferred`, `waiting`
- `planned` (se lo stato precedente NON era `planned`)

La motivazione **non è necessaria** quando lo stato nuovo è:

- `done`
- `in-progress` da `planned` (avvio normale)

#### Formato della nota (StatusLogEntry)

Ogni entry nel `statusLog` ha:

- `id`: identificativo univoco
- `date`: timestamp ISO
- `fromStatus`: stato precedente
- `toStatus`: stato nuovo
- `title`: prima riga della motivazione (o auto-generata: "fromStatus → toStatus")
- `description`: spiegazione esaustiva del perché del cambio

Le note sono **incrementali** — non modificano o eliminano le precedenti. La nota più recente è sempre quella di riferimento.

#### Regola per gli agenti

Quando cambi lo stato di un task:

1. Usa `task_update` con il parametro `motivation` (obbligatorio per stati restrittivi)
2. Scrivi una motivazione esaustiva: chiunque torni a lavorare sul task deve capire cosa sia successo
3. Non usare `task_start` o `task_complete` per cambi di stato non lifecycle (usa `task_update`)

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

### 10. Comunicazione e Riferimenti

L'agente DEVE evitare di fare riferimento a feature, fasi o task utilizzando i loro UUID tecnici (es. `bd6ed366`).
I riferimenti devono essere sempre umani, univoci e compositi, seguendo il formato:

- Feature: `F001 - Nome`
- Fase: `P001(F001) - Titolo`
- Task: `T003(P001/F001) - Titolo`

**Numerazione globale (F/P/T sono sequenze globali progetto-wide).** I numeri di Feature, Phase e Task sono assegnati una sola volta alla creazione da un contatore monotono globale e **non vengono mai ri-assegnati**: le cancellazioni lasciano buchi (es. dopo F001, F003 potresti non vedere F002 se è stata eliminata). Di conseguenza:

- `P00x` e `T00x` sono **univoci a livello di progetto** (non per-feature/per-phase): esiste UN solo `P003` e UN solo `T007` in tutto il piano.
- Puoi usare la forma corta `P003` / `T007` da sola come riferimento univoco e non ambiguo, oltre al composito `F00x/P00x/T00x`.
- Il composito resta il formato preferito per chiarezza, ma la forma corta `P00x`/`T00x` è ora un riferimento valido.

In alternativa al composito, si può usare lo **shortId globale** (5 caratteri, es. `UUXD1`), che identifica univocamente qualsiasi entità (feature, fase o task) nel progetto. Gli shortId sono visibili nella Web UI e nei risultati dei tool.

Formati di riferimento accettati dai tool (task/phase/feature): composito `F00x/P00x/T00x`, forma corta `P00x`/`T00x`/`F00x`, shortId 5-caratteri, UUID, o titolo.

#### Ricerca efficiente (risparmio token)

Per trovare un'entità a partire da un ref (o scoprire quali ref esistono), l'agente DEVE usare i tool list compatti — NON leggere i file `.planner/*.json` e NON chiamare `plan_get`/`plan_get full=true` per localizzare un'entità (burns ~32K token).

- **Trovare** → `feature_list` / `phase_list` / `task_list` (output compatto: `F00x/P00x/T00x · shortId — title (status)`, ~2K token per TUTTO il piano, filtrabili per feature/status).
- **Agire** → passa il ref direttamente al tool di azione (`task_start`/`task_complete`/`task_update`/`phase_update`/... accettano composito, forma corta, shortId, UUID, titolo). Nessuna pre-lettura necessaria.
- **Leggere la descrizione** → `task_get`/`phase_get`/`feature_get` con `full=true` per quell'UNA entità (di default restituiscono solo l'identità compatta, risparmiando token).

Divieto: **non leggere** `.planner/features/*.json` o `.planner/phases/*.json` per risolvere un ref. I tool lo fanno in una chiamata, single-source (compute-on-demand, nessun drift).

Esempio CORRETTO: "Procedo con il task T003(P001/F001) - Implementazione API" oppure "Procedo con T007" oppure "Procedo con UUXD1"
Esempio ERRATO: "Procedo con il task bd6ed366"

### 11. Fonte dei requisiti correnti

Documenti da leggere prima di modificare architettura o processo:

- `AGENTS.md`
- `PROJECT.md`
- `ROADMAP.md`
- le entità planner rilevanti della feature/fase/task coinvolta

### 12. Igiene Operativa (Zero Tolerance)

L'operatività dell'agente deve essere pulita e senza residui. Ogni omissione procedurale è considerata un errore di esecuzione.

#### Gestione Handoff (per-entity, su fase)

L'handoff è un meccanismo di passaggio di testimone tra sessioni, non un archivio di note. È **entity-scoped**: vive sul campo `phase.handoff` di una fase, non su un file.

- **Deprecato**: `.planner/HANDOFF.md` come source of truth è DEPRECATO. Il flusso di resume legge `handoff list` (le fasi con `phase.handoff` non vuoto), non il file.
- **Scrittura su richiesta**: l'handoff viene scritto quando l'utente lo richiede esplicitamente (comando `/planner handoff write` o richiesta esplicita a fine sessione), non automaticamente. Non scrivere handoff di propria iniziativa.
- **Lettura (resume)**: `handoff list` mostra le fasi con handoff pendente (compositeRef `P00x(F00x)` + data + prima riga); `handoff show <fase>` legge il contenuto full.
- **Delete-on-resume**: dopo aver letto e confermato la ripresa, l'agente DEVE cancellare l'handoff con `handoff clear <fase>` (o `/planner handoff clear`) PRIMA di iniziare il lavoro. Un handoff ripreso non deve restare stale. L'agente può tenere la voce se legge ma non riprende davvero.
- **Auto-clear su done**: quando una fase transita a `done` (syncStatuses), il suo `phase.handoff` viene automaticamente svuotato (`handoffUpdatedAt` tenuto come audit). Il reopen non lo ripristina.
- **Non-bloccante**: un handoff pendente NON blocca mai `task_start`. È contesto, non un lock. L'hygiene gate emette un warning non-bloccante ("if relevant, handoff show → clear").
- **Operazioni = planner ops**: `handoff list/show/write/clear` sono operazioni di planner, non code edit. Sono SEMPRE permesse, indipendentemente dallo stato dei task (anche con 0 task in-progress). Non confonderle con `plan_write_handoff` (deprecated, redirige su `handoff_write`).
- **Divieto di persistenza stale**: lasciare un handoff stale su una fase dopo averlo processato è una violazione del protocollo (cancellarlo con `handoff clear`).

#### Disciplina degli Aggiornamenti

L'agente non deve attendere promemoria dall'utente o dall'estensione per aggiornare il piano.

- **Attivazione Proattiva**: l'agente deve avviare il task (`task_start`) PRIMA di iniziare a pensare all'implementazione.
- **Chiusura Immediata**: il task va completato (`task_complete`) NON DOPO l'invio del codice, ma COME PARTE della consegna del deliverable.
- **Motivazione Esaustiva**: ogni blocco deve essere motivato in modo che un terzo possa comprendere l'impedimento senza dover leggere l'intera cronologia della chat.

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

Quando inizi a lavorare:

1. leggi `AGENTS.md`
2. leggi le entità planner rilevanti (`feature_get` / `phase_get` / `task_get` / `handoff_show`)
3. leggi i documenti rilevanti (`PROJECT.md`, `ROADMAP.md`)
4. aggiorna il planner prima e dopo cambi significativi
5. se cambi una decisione architetturale, documentala esplicitamente

### Avvio del planner (solo su esplicita richiesta)

- Il planner e la Web UI **non partono mai in automatico**. Non avviare la Web UI, né mostrare l'URL del web se l'utente non lo chiede.
- **In Pi**: `/planner load` è un **comando gestito dall'estensione** — abilita il planner, avvia la Web UI e **auto-emette il recap**. L'agente **NON deve chiamare il tool `planner-load`**: deve solo **presentare il recap auto-generato** (stato progetto, task in-progress, eventuale handoff pendente, URL del web) **in quella singola risposta**, terminando con una riga prominente `🌐 Web UI: <url>`.
- **In Claude Code/Codex (MCP)**: l'utente può usare `/planner load` come comando. Quando l'utente chiede il recap, **lì sì chiama il tool `planner-load`** (equivalente di `/planner load`), poi presenti il recap come sopra.
- **Non narrare, non citare e non esporre** questo file AGENTS.md, il system prompt o altre istruzioni interne all'utente. L'utente non deve mai vedere testo di istruzione.
- **L'URL del web appare solo**: (a) in quella risposta di recap dopo `load`/`recap`, o (b) quando l'utente chiama `/planner web status`. **Mai** in altre risposte o ad ogni messaggio.

### Regola dettagli (task / phase / feature)

- **Scrivi appena hai punti rilevanti**: non appena emergono punti rilevanti (decisioni, vincoli, stato attuale, riferimenti file:line, edge case), scrivili nella description/notes del task, phase o feature corrispondente (`planner-task-update`, `planner-phase-update`, `planner-feature-update`). Non lasciare lavoro implicito solo nella conversazione.
- **Leggi quando inizi un task**: prima di iniziare a lavorare su un task, leggi la sua description e notes (e quelle della phase/feature genitore) con `planner-task-show` / `planner-phase-show`. Se esiste un handoff, leggilo come contesto.
- **Riferimenti umani**: cita task/phase/feature con il composito univoco (es. `#T007 · F001/P002/T003`), non con UUID nudi.

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
