# Checklist di progetto

## Regola
Questa checklist deve essere aggiornata durante il lavoro, non solo a fine attività.

## Stato attuale

### Fatto
- [x] Consolidati requisiti, decisioni e architettura in `PROJECT.md`
- [x] Definita roadmap iniziale in `ROADMAP.md`
- [x] Creato `AGENTS.md` con le regole fondamentali del progetto
- [x] Creato monorepo pnpm (`packages/plan-core`, `plan-server`, `plan-web`, `pi-adapter`)
- [x] Configurazione TypeScript condivisa, build pulita (`tsc -b`)

### Fatto — plan-core (v2 con Features)
- [x] Schema Zod: FeatureSchema, FeaturesDocumentSchema
- [x] PhaseSchema: aggiunto featureId opzionale
- [x] PlanWorkspaceSchema: include features
- [x] Naming: createFeatureId(num, name)
- [x] PlanStore: loadFeatures, saveFeatures, features.json persistente
- [x] PlanRenderer: sezione features in PLAN.md + renderFeature()
- [x] Markdown generato sotto `generated/features/*.md`

### Fatto — plan-server (v2 con Features)
- [x] Endpoint CRUD: GET/POST /features, GET/PUT/DELETE /features/:id
- [x] GET /phases?featureId= per filtrare fasi per feature
- [x] POST /phases accetta featureId e aggiorna automaticamente phaseIds della feature
- [x] WebSocket: nuovo evento `features-updated`

### Fatto — pi-adapter
- [x] Comandi `planner` gerarchici (`/planner init|show|phase|task|discuss|web`)
- [x] Comandi flat tab-completable (`/planner-phase-add`, `/planner-task-add`, ecc.)
- [x] CRUD completo via comando:
  - [x] phase add / delete (con conferma) / update (tutti i campi)
  - [x] task add / delete (con conferma) / update
- [x] Scelta interattiva di fase e task (liste numerate)
- [x] Server lifecycle (start/stop, restore da stato persistito, `quiet` mode)
- [x] Context injection (`plan-context`) all'avvio conversazione
- [x] Cleanup su `session_shutdown`

### Fatto — integrazione
- [x] Test end-to-end (init, fasi, task, markdown, REST, WebSocket)
- [x] Build TypeScript pulita

### Fatto — plan-web-ui (raffinamenti liste)
- [x] Rimossa la subtitle inutile `features → phases → tasks` dalla top nav
- [x] Aggiunti filtri `nome + stato` per liste features/phases/tasks
- [x] Ogni row ora mostra numero dei children e riassunto dei loro stati
- [x] `Input` e `Select` ora fanno merge corretto di `className`

### Fatto — progetto/dashboard
- [x] Aggiunto `project.description` allo schema progetto con default retrocompatibile
- [x] Dashboard aggiornata con card descrizione progetto editabile
- [x] Aggiunta rotta `/project/edit` per modificare la descrizione del progetto
- [x] Renderer markdown aggiornato per includere la descrizione progetto

> Nota: il package originario `plan-web-v2` è stato rimosso e sostituito da `plan-web-ui`.

### Fatto — bootstrap/discuss planner
- [x] `planner-init` ora raccoglie titolo + short description
- [x] `planner-init` avvia automaticamente il bootstrap `project discuss`
- [x] Aggiunti comandi flat visibili con autosuggest: `planner-project-discuss`, `planner-phase-discuss`, `planner-task-discuss`
- [x] `planner-project-discuss` supporta bootstrap/re-discuss con codebase hints, Q&A e approvazione prima del salvataggio
- [x] `planner-phase-add` ora può collegare la fase a una feature e avviare subito `phase discuss`
- [x] `planner-task-add` ora può avviare subito `task discuss`
- [x] `planner-task-discuss` può inizializzare descrizione e checklist del task

### In corso
- [ ] Runtime validation post-restart / Claude Code hook validation del nuovo modello `Edit|Write + bypass`. Vedi `BACKLOG.md`.
- [x] Fix critico blocco Pi: `migrateToUuids`/`syncStatuses`/`ensureStructureOrdering`/`repair` con `autoSync=true` su planner con tante fasi provocavano esplosione O(N²) di scritture (timeout/hang). Introdotto guard `batchInProgress` + helper `runAsBatch` che sospende autoSync durante i batch.
- [x] Preparato il monorepo al publish npm: package pubblici/privati coerenti, metadata, `files`, `publishConfig.access`, script di release, LICENSE/README package-level e validazione con `pack --dry-run`.
- [ ] Memoria progetto / handoff automatico / porte web per progetto (handoff fatto — vedi `BACKLOG.md`)
- [ ] Rivedere generazione markdown con dati reali
- [x] Web UI: scegliere local/LAN a start e mostrare URL LAN nella dashboard
- [x] Fix race `phase_create` auto-numbering per la stessa feature quando chiamato in parallelo

> Il backlog canonico e persistente ora vive in `BACKLOG.md`. Questa checklist traccia la sessione corrente.

### Fatto — multi-agent / Claude Code planning
- [x] Aggiornato `docs/multi-agent-strategy.md` con Claude Code Phase 1, naming pubblico `planner-*`, Pi grouped UX, feature pubbliche e requirements interni.
- [x] Raggruppata la UX Pi sotto `/planner`: menu su invio, autocomplete custom per `/planner`, subcommand feature list/add/update/delete e azioni repair/load/disable raggiungibili da `/planner`; rimossi i flat slash commands `planner-*` dalla registrazione Pi globale.
- [x] Creato `packages/plan-mcp` per Claude Code Phase 1: server MCP stdio con 29 tool pubblici `planner-*`, build TypeScript pulita, smoke test MCP `listTools` OK e guida `docs/setup-claude-code.md`.
- [x] Rimosso supporto legacy `.plan`: agent-plan ora usa solo `.planner/`; eliminati fallback/migrazione da `pi-adapter` e `plan-server` CLI. `.plan/` resta solo ignorato nello scanner per non leggere dati di altri tool.
- [x] Creato package CLI `agent-plan` con comandi `mcp`, `init`, `setup claude-code`; setup genera/aggiorna project `.mcp.json`, supporta `--local`, smoke test CLI OK e `pnpm check` passa.
- [x] Corretto setup Claude Code: usa project-scoped `.mcp.json` invece di `.claude/settings.json`; aggiornati CLI/docs/strategy e rigenerato `.mcp.json` in `~/projects/tests`.
- [x] Aggiunto slash command Claude Code `/planner`: il setup genera `.claude/commands/planner.md` come router verso i tool MCP `planner-*`; rigenerato in `~/projects/tests`.
- [x] Completato router `/planner` Claude con `init`, `load`, `reload`, `disable`, `web status|start|stop`; rigenerato in `~/projects/tests` e `pnpm check` passa.
- [x] Scritto `README.md` completo in inglese con installazione, setup Claude Code user/project, init esplicito `.planner/`, MCP tools, Pi usage, CLI, troubleshooting e principi di design.
- [x] Allineato `agent-plan setup claude-code`: non inizializza più `.planner/`; aggiunto setup user-scope `--user`; project setup genera solo `.mcp.json` e `.claude/commands/planner.md`.
- [x] Implementato P0-1 task lifecycle guard: lifecycle tools `task_start`/`task_complete`, blocco `task_update` verso `in-progress`/`done`, e backlog aggiornato a implementato/pending runtime validation.
- [x] Rifinito il guard harness-agnostic: Pi e Claude Code bloccano solo `edit/write` (bash resta libero), con bypass temporaneo condiviso via `resume.json` (`guardBypassUntil`) e comandi/tool dedicati (`/planner bypass`, `planner-authorize-bypass`, ecc.).
- [x] Migliorata ergonomia Pi: prompt auto-enable/web abbreviati a `y/n/a/e`, startup resume summary con URL dashboard web, cache del context block tra turni e cleanup async degli orphan `.bak`/`*.tmp.*`.
- [x] Validazione locale del batch: `pnpm build`, `pnpm check`, `git diff --check`, smoke MCP `listTools` = 32, smoke guard Claude (`Edit` deny senza task, `Bash` allow, bypass allow) OK.
- [x] Aggiunto al `BACKLOG.md` il piano deferred per integrazione Zed: MCP context server, setup CLI, usage docs, profilo agent, skill/extension opzionale e limiti del task guard.
- [x] Sistemato e validato `/planner export` e `/planner export-full`: Pi ora esporta direttamente senza HTTP/503, MCP non usa più `require` ESM, Markdown export è più robusto, `pnpm build`, `pnpm check`, `git diff --check`, CLI export e smoke MCP passano.
- [x] Abbreviati i prompt Pi `y/n/always` in `y/n/(a)lways`; l'alias `a` era già supportato.
- [x] Completata export UX: `export`/`export-full` compaiono nel menu Pi `/planner`, Web UI ha dropdown `Export` con download Summary/Full.
- [x] Pulizia inconsistenze docs: README allineato (30 tool MCP, CLI export, `/planner export`); BACKLOG P2-4 riframato (README esiste, va mantenuto in sync); CHECKLIST rimossa la sezione morta `plan-web-v2`; autocomplete subcommand Pi segnato come completato.

### Fatto — planner discuss / decision persistence / dashboard
- [x] Checklist task: checkbox persistenti, sempre visibili, collegati al task, senza redirect alla route `/toggle`
- [x] Header con task `in-progress` alimentato dal root loader
- [x] Rimossa duplicazione goal/description nel layout principale
- [x] Aggiunto accordion "AI Consolidated Context" in dashboard
- [x] Aggiunto campo strutturato `acceptedDecisions` su project/feature/phase/task
- [x] Resa visibile la lista `acceptedDecisions` in dashboard, feature detail, phase detail e task detail
- [x] Renderer markdown aggiornato per includere accepted decisions e dettagli operativi persistiti
- [x] Ridotta la confusione con GSD nei flussi planner discuss tramite regole/prompt espliciti

### Fatto — stabilità package NPM + startup dedup + handoff ricco (sessione 2026-07-10)
- [x] **Fix bloccante NPM freeze**: `@hono/node-server` era in `devDependencies` di `plan-server` ma importato a runtime da `serve.ts`; spostato in `dependencies`. Senza di esso l'estensione non si caricava affatto da NPM (import di `serve.js` falliva → `session_start` non partiva → nessun prompt + Pi bloccato). Riprodotto e confermato.
- [x] **Dedup startup**: `session_start` eseguiva `migrateToUuids`/`syncStatuses`/`ensureProjectLanguagePreferences` che `before_agent_start` rifaceva al primo turno (migrate x2, syncStatuses x2 nello stesso session_start). Ora `session_start` usa `maybeHealStatuses` (idempotente, guard `healedStatusRoots`) e setta `plannerHeavyInitDone = true` prima del resume-trigger, così `before_agent_start` salta l'heavy init ridondante.
- [x] **Handoff ricco**: aggiunto parametro `extraSections: Array<{heading, body}>` al tool `plan_write_handoff`; le sezioni vengono iniettate tra "What was being done" e "How to resume" per catturare decisioni di design, architettura (con file:line), mode flow, plugin contract, data mapping, known gap. Aggiunta anche sezione auto-derivata "Current Task Statuses" con tutti i task della fase corrente.
- [x] Version bump: `plan-server` 0.2.3 → 0.2.4 (fix dep), `pi-adapter` 0.2.3 → 0.2.6 (supersede 0.2.5 rotta su npm + include i fix). `plan-core` invariato a 0.2.3.
- [x] Validazione: `pnpm -r build` ok, `pnpm check` ok, `git diff --check` ok, test funzionale ordinamento sezioni handoff ok.
- [x] **Root-cause freeze NPM (sessione 10/07 continuazione)**: il freeze NON era il missing dep (quello era un blocker separato, fixato). La causa reale è `ctx.ui.input()` in `session_start`: quando l'estensione è caricata da pacchetto NPM installato, il prompt non viene mai renderizzato e la `await` non risolve mai → `session_start` bloccata per sempre → Pi congelato (input non recapitato alla chat). Dimostrato per esclusione: tutte le operazioni sui dati `.planner` (exists, loadProject, migrateToUuids 98ms, syncStatuses 80ms, loadHandoff) completano in millisecondi in uno script standalone → il solo await che può bloccare è `ctx.ui.input()`.
- [x] **Fix 0.2.7**: aggiunto `safeInput(ctx, prompt)` che fa `Promise.race` tra `ctx.ui.input()` e un timeout di 20s. Al timeout, il sentinel `"__PLANNER_PROMPT_TIMEOUT__"` cade nel ramo `else` esistente → planner disabilitato per la sessione + notify con istruzioni (`/planner load` per abilitare). Così `session_start` non può bloccare Pi permanentemente, preservando il prompt interattivo dove funziona.
- [x] **Sblocco immediato heca**: impostato `plannerAutoEnable: true` + `plannerAutoStartWeb: true` in `heca/.planner/project.json` → entrambi i prompt saltati (auto-enable + auto-start-web) → nessuna `ctx.ui.input()` in `session_start` → Pi si sblocca con planner **abilitato**. (Poi reverted `plannerAutoEnable` a false in 0.2.8 per ripristinare la domanda.)
- [x] **Fix 0.2.8 (UX + robustezza)**: l'utente ha segnalato che auto-enable skippava del tutto la domanda. Sostituito `ctx.ui.input()` (testo libero, 4-way) con `ctx.ui.select()` menu a 4 voci (Yes/Always/No/Never) per entrambi i gating (enable + web). UX migliore per una scelta fissa E usa un componente UI diverso (select vs input) che potrebbe renderizzare dove `input()` non lo faceva. Aggiunto `safeSelect(ctx, title, options)` con guard `ctx.hasUI` + race con timeout 20s (safety net). Reverted heca `plannerAutoEnable: false` così la domanda viene posta via menu.

### Prossimi passi
- [ ] Web UI: pagina requirements (vedi `BACKLOG.md` P2-3)
- [ ] Manutenere README + guida d'uso in sync (vedi `BACKLOG.md` P2-4)
- [x] **0.2.9 — Redesign avvio (no prompt bloccanti)**: confermato che NESSUN `ctx.ui.*` (`input` E `select`) renderizza in `session_start` per estensioni NPM ESM installate → il prompt bloccante è inevitabilmente rotto. Rimossi TUTTI i prompt di `session_start`. Nuovo comportamento:
  - `session_start`: planner sempre **DISABLED** all'avvio + notify non-bloccante "Run /planner load". Nessun freeze, nessun timeout, avvio istantaneo.
  - `/planner load`: abilita planner + avvia web UI (sempre **LAN**, nessuna domanda visibility) + triggera il resume summary che mostra indirizzo+porta.
  - `/planner stop` (alias `/planner disable`): disabilita planner + spegne web UI.
  - `/planner web start`: sempre LAN di default.
  - Rimosso "always"/"never": eliminati i campi `plannerAutoEnable`/`plannerNeverAsk`/`plannerAutoStartWeb`/`plannerNeverStartWeb` dallo schema (`plan-core` 0.2.5) e tutte le reference. Ad ogni riavvio si dà `/planner load`.
  - Rimosse helper `safeInput`/`safeSelect`/`PROMPT_TIMEOUT_MS` (non più necessarie).
- [ ] **Pubblicare 0.2.9 + 0.2.5**: `pnpm --filter @agent-plan/core publish --access public --no-git-checks` poi `pnpm --filter @agent-plan/pi-adapter publish --access public --no-git-checks`; poi `pi install npm:@agent-plan/pi-adapter` (update); avviare Pi in heca → avvio istantaneo + notify → dare `/planner load` → planner attivo + web LAN + resume con indirizzo.
- [ ] Aprire issue Pi: `ctx.ui.input()`/`ctx.ui.select()` non renderizzano in `session_start` per estensioni caricate da `node_modules` ESM (funzionano in dev/source). Workaround attuale: nessun prompt in `session_start`, abilitazione via slash command.
- [x] Introdotta numerazione progressiva persistente `001/002/...` per feature/fase/task e usato quell'ordine in WorkTree + resume.
- [x] Corretto startup resume: link dashboard esplicitato nel protocollo/summary; handoff e resume target trattati come suggerimenti da validare, non come focus corrente implicito.
- [x] README/docs riallineati alle ultime feature: guard+bypass, housekeeping `.planner/.gitignore`, numerazione persistente `F001/P001/T001`, Work Tree order, runtime notes, semantics corrette di handoff/resume.
- [x] Autocomplete subcommand in Pi (completato)

### Note operative
- La checklist va tenuta viva e aggiornata con stati, blocchi e completamenti.
- Il core del piano deve restare harness-agnostic.
- I dati del piano vivono in `.planner/` dentro il progetto target.
