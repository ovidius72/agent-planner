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

### Fatto — refactor Dashboard Web UI (sessione 2026-07-10)
- [x] **Work Tree: feature `done` collapsed di default**: in modalità `"all"` (default all'avvio) le feature con `status === "done"` non vengono più auto-espande. L'utente può espanderle manualmente col chevron (passa in modalità `"smart"` per quel nodo).
- [x] **Refactor `routes/dashboard/route.tsx`** (da ~800 righe a 60): il componente monolitico è stato scomposto in moduli/hook/componenti dedicati, preserving behavior (build + `pnpm check` puliti, pipeline `build:pi-adapter` verde con `web-ui-dist` popolato):
  - `lib/dashboard-storage.ts` — helper localStorage puri (`dashboardStorageKey`, `readStoredArray`, `writeStoredArray`, `readStoredBoolean`).
  - `lib/dashboard-tree.ts` — `buildWorkTree` + tipi `WorkTreeFeature`/`WorkTreePhase` + `countTasks`/`countDoneTasks`/`formatSequence` + `PlannerWsMessage`.
  - `lib/dashboard-filters.ts` — `toggleStatus`/`matchesStatus` + liste `all*StatusValues`.
  - `hooks/use-dashboard-tree.ts` — hook che racchiude TUTTO lo state del Work Tree: tree, espansione (mode + per-node), filtri status, hide-done/planned, active-only, highlight recenti via WS, persistenza localStorage. Include il fix done-collapsed.
  - `components/dashboard/stat-cards.tsx` — le 4 stat card (compute interna).
  - `components/dashboard/ai-consolidated-context.tsx` — card collapsible context (scope/rules/decisions).
  - `components/dashboard/latest-completed-tasks.tsx` — sezione ultimi task completati.
  - `components/dashboard/work-tree-rows.tsx` — `FeatureTreeRow`/`PhaseTreeRow`/`TaskTreeRow` presentazionali (estratto il JSX triplamente annidato).
  - `components/dashboard/work-tree.tsx` — `WorkTree` che consuma `useDashboardTree` + renderizza filter bar + tree + fallback active tasks + repair.
  - `routes/dashboard/route.tsx` — orchestratore snello (Project Goal + composizione 4 sezioni).
- [ ] **Pubblicare 0.2.13**: `pnpm release:publish:adapter` (rebuilda web-ui in `web-ui-dist` + pubblica; include anche il fix `message_end` URL-append). Serve OTP. Poi `pi install npm:@agent-plan/pi-adapter` + riavvio + `/planner load`.

### Fatto — parità comandi Claude Code + workflow publish (sessione 2026-07-13)
- [x] **Hint comandi Claude Code completo**: il template canonico `plannerCommandTemplate()` in `packages/agent-plan/src/index.ts` aveva un `argument-hint` ristretto (solo `init|show|export|export-full|reload|web status|feature list|feature add|phase add|task start|task complete|handoff prepare`). La tabella di routing verso i tool MCP era già completa (~30 tool), ma i comandi mancavano dall'autocomplete → il planner sembrava "limitato" in Claude Code. Hint ora completo e raggruppato: `init | show | reload | load | disable | repair | export [--full] | web <status|start|stop> | feature <list|add|show|update|delete> | phase <add|show|discuss|update|delete> | task <add|show|discuss|update|delete|start|complete> | handoff <prepare|show|write|clear> | project <discuss|language> | bypass | clear-bypass` (inclusi `load`/`disable`).
- [x] **Distribuito, non hand-maintained**: la fix è nella sorgente unica del CLI `agent-plan` che `agent-plan setup claude-code` scrive in `~/.claude/commands/planner.md` (o `.claude/commands/` di progetto). Aggiornando qui, ogni nuova installazione ottiene la superficie completa. Applicato in locale con `node packages/agent-plan/dist/index.js setup claude-code --user --force` (riscritto `~/.claude/commands/planner.md`).
- [x] **`agent-plan` 0.2.7 → 0.2.8**: bump chirurgico del solo CLI (versioni divergenti tra gruppi: il `release:bump` core avrebbe saltato agent-plan per il guard anti-downgrade). Build pulita, `dist` porta l'hint nuovo, `npm pack --dry-run` verificato (0.2.8 tgz). Da pubblicare.
- [x] **Workflow GitHub Actions `.github/workflows/publish.yml`**: su ogni push su `main` (+ `workflow_dispatch`) esegue `pnpm install --frozen-lockfile` → `pnpm build && pnpm check` → `pnpm build:pi-adapter` → pubblica i 5 package pubblicabili (`core`, `mcp`, `server`, `agent-plan`, `pi-adapter`) con guard idempotente (`npm view <name>@<version>` → skip se già su npm). Usa `pnpm publish` per risolvere i range `workspace:*`. Necessita secret `NPM_TOKEN` (token npm Automation/Granular con permesso publish, bypassa OTP in CI). YAML validato.

### Fatto — Node 25 + CI action upgrades (sessione 2026-07-13)
- [x] **Workflow CI su Node 25 + azioni Node 24**: bump `actions/checkout@v4 → @v5` e `actions/setup-node@v4 → @v5` (entrambe ora girano sul runtime interno Node 24, silenziando il warning di deprecazione Node 20 di GitHub). `pnpm/action-setup@v4` mantenuto (nessuna release Node 24 ancora taggata dal team pnpm; commento nel workflow a documentare). `node-version: '22' → '25'` nel job.
- [x] **Root `engines.node >= 25`** + **`@types/node ^22 → ^25`** (risolta 25.9.5) per allineare tipi e contratto al runtime di sviluppo.
- [x] **`.nvmrc` = `25.4.0`** creato, così `fnm`/`nvm` allineano i collaboratori al runtime del progetto.
- [x] **Guard secret esplicito** nel workflow: se `NPM_TOKEN` manca, exit 1 con messaggio chiaro invece del criptico 404 npm.
- [x] Validazione: `pnpm install` (lockfile aggiornato), `pnpm build`, `pnpm check` verdi; YAML workflow validato.
- [x] **Conferma pubblicazione CI**: primo run su `main` ha pubblicato tutti i 5 package pubblicabili (core/mcp/server/agent-plan/pi-adapter), verificato sync 5/5 tra locale e npm.
- [x] **Nuovo flusso di lavoro**: da oggi integrazione via feature branch + PR a `main` (modello `develop` → PR `main`). Il trigger `push: branches:[main]` pubblica automaticamente al merge della PR.

### Fatto — Fix: Web UI address solo sul recap iniziale (sessione 2026-07-13)
- [x] **Root cause**: l'indirizzo Web UI veniva accodato a OGNI messaggio dell'agente perché la logica di azzeramento dei flag (`startupResumeSummaryPending`/`startupResumePromptPending`) e l'iniezione del `startupResumeProtocol` stavano **dentro il ramo cache-miss** di `before_agent_start`, DOPO l'early-return della cache fast-path. Sui turni normali (cache valida) quelle righe non giravano mai → `startupResumeSummaryPending` restava `true` fino al timeout di 60s → URL su ogni risposta.
- [x] **Fix** (`packages/pi-adapter/src/index.ts`):
  - gestione del ciclo di vita dei flag (`isRecapTurn`, consumo di `promptPending`, azzeramento di `summaryPending` sui turni non-recap) spostata **PRIMA** della cache fast-path → gira su ogni turno, cache-hit inclusi.
  - `/planner load` imposta `contextBlockDirty = true` così la turnata di recap ricostruisce il context (slow path) e inietta il protocollo fresco.
  - `startupResumeProtocol` rimosso dal `contextBlock` (non più cotto in cache, che altrimenti sarebbe persistito su ogni turno) e accodato dinamicamente al `return` solo sul turno di recap.
- [x] Build + typecheck puliti; `dist` verificato (clearing a riga 3438, cache early-return a 3445, ordine corretto).
- [ ] **Da fare al release**: bump pi-adapter a `0.2.14` (`pnpm release:bump:adapter`) prima della PR `develop → main` per pubblicare la fix.

### Fatto — planner-web management in plan-mcp (sessione 2026-07-13)
- [x] **Problema**: in Claude Code (integrazione via `plan-mcp` MCP stdio) il tool `planner-web` era uno stub che restituiva solo testo guida ("MCP stdio package does not manage the web server yet"). Nessuna gestione effettiva del web server, a differenza del Pi adapter (`/planner web status`).
- [x] **Fix** (`packages/plan-mcp/src/index.ts` + `package.json`):
  - aggiunta dipendenza workspace `@agent-plan/server`.
  - import di `serve()`/`ServeHandle` da `@agent-plan/server` (stessa API di plan-server CLI e Pi adapter).
  - variabile di modulo `webHandle` (in-process, vive finché il processo MCP è attivo).
  - implementati i 3 action: **start** (`serve({planRoot, host:"0.0.0.0", port:0, quiet:true})` → LAN + porta dinamica OS-assegnata), **status** (URL/port/mode o "not running"), **stop** (`handle.close()`).
  - plan-root riusa `AGENT_PLAN_ROOT || cwd()/.planner` (coerente con gli altri tool).
- [x] Scelte di design (approvate): **in-process** come Pi, **LAN** (`0.0.0.0`), **porta dinamica** (zero conflitti con plan-server CLI/Pi).
- [x] Build + typecheck puliti; smoke test `serve({port:0,host:"0.0.0.0"})` verificato (porta dinamica `51262`, `localUrl`+`lanUrl` corretti, mode `lan`, HTTP risponde, close pulita).
- [ ] **Da fare al release**: bump `@agent-plan/mcp` prima della PR `develop → main` per pubblicare.

### Fatto — Responsive Web UI mobile (sessione 2026-07-13)
- [x] **Problema**: su mobile il sito era inguardabile: (1) header `sticky` semitrasparente (`bg/90`) faceva vedere il contenuto sotto scrollando; (2) nomi task lunghi non andavano a capo → overflow che rompeva il layout; (3) bottoni header (Live/Dashboard/Features/Export) si affollavano e andavano a capo male; (4) testo e filtri troppo piccoli.
- [x] **Fix** (`packages/plan-web-ui/src`):
  - **Header**: `top-nav.tsx` root `bg-[var(--surface)]/90` → `/95` + `backdrop-saturate-150` (mantiene `backdrop-blur-xl`). Sfondo blur opaco, niente bleed.
  - **Work Tree ridisegnato** (`work-tree-rows.tsx` + nuovo `EntityPathBadge` in `badges.tsx`): identificatore unificato `F00x[/P00x][/T00x]` in un singolo badge con segmenti colorati per gruppo (feature=viola, phase=ciano, task=verde). Il titolo ora sta **sotto** il badge e wrappa (`break-words [overflow-wrap:anywhere]`) invece di overfloware. Rimossi i glyph ASCII dell'albero (└─├─│); indentazione + chevron conservano la gerarchia.
  - **Header mobile compatto** (`top-nav.tsx`): etichette Live/nav/Export nascoste sotto `sm` (`hidden sm:inline`) → su mobile solo icone, una riga ordinata; padding `px-3 sm:px-4`.
  - **Leggibilità mobile**: `base.css` media query `max-width:640px { :root { font-size: 106.25% } }` (scale rem-based text). Filtri (`list-filters.tsx`): tap target `min-h-10` → `min-h-11`, padding `p-3 sm:p-4`, results label `text-xs` → `text-sm`.
- [x] Build + typecheck puliti; `web-ui-dist` del pi-adapter ricostruito e servito contiene le nuove regole (`entity-path-badge` + media query).
- [x] **Responsive mobile + layout detail (round 2)** — overflow azzerato ovunque (dashboard + feature/phase/task-detail = 0px a 390px):
  - **Fix sistemica grid overflow** (`base.css`): regola globale `.grid > * { min-width: 0 }` — i grid-item hanno `min-width:auto` di default e non shrinkano, causando overflow con token lunghi. Una regola risolve ~40 container `grid` nudi in tutta l'app.
  - **Markdown overflow-proof** (`formatted-text.tsx` + `base.css`): container `FormattedText` ora `formatted-text grid grid-cols-1` + regola `.formatted-text p/li/blockquote/a/code { overflow-wrap: anywhere }` → URL/path/codice lunghi non overflowano mai (Project Goal, description, notes, decisions).
  - **Work Tree mobile ridisegnato** (`work-tree-rows.tsx`): layout a **colonna** su mobile nell'ordine **badge numerico → status → titolo fluido** (desktop: titolo a sinistra che cresce, status a destra). Indent ridotti su mobile (`ml-1.5 pl-3`, ~18px/livello, vs `ml-4 pl-4` desktop) per non rubare spazio; rimosso il gutter waste dei task (dot in-progress inline nel badge). Badge F/P/T ora **click-to-copy** (`CopyableBadge` in `badges.tsx` + stili `.copyable-id` in `base.css`, fallback execCommand per http LAN).
  - **Header detail ridisegnato** (`feature/phase/task-detail/route.tsx`): riga badge (**numero + parent + status**) in alto, **titolo su riga propria sotto** (più grande su desktop `sm:text-3xl`), invece di titolo+status in linea.
  - **Latest completed tasks** (`latest-completed-tasks.tsx`): ristrutturato a colonna (badge+status, titolo fluido, riga parent truncate) con catena `min-w-0`.
  - **App-shell in-progress bar** (`app-shell.tsx`): fix catena `min-w-0 flex-1` così il `truncate` del titolo shrinka davvero (era la causa dei 604px di overflow sulla home).
  - **Dashboard** (`route.tsx`): page grid + card → `grid-cols-1`.
- [ ] **Da fare al release**: bump pi-adapter a `0.2.14` (`pnpm release:bump:adapter`) prima della PR `develop → main`.

### Prossimi passi
- [ ] **Configurare secret `NPM_TOKEN`** nel repo GitHub (Automation/Granular token) e pushare il workflow + le modifiche su `main` per attivare la publish automatica (pubblica agent-plan 0.2.8 e gli altri 0.2.8 se non ancora su npm).
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
- [x] **F001 — Plugin Claude Code + struttura multi-plugin (0.1.0 scaffold)**: creata struttura `plugins/` (separata da `packages/`, D1) con `claude-code/`, `codex/` (placeholder), `_shared/` (template single-source-of-truth, D2). Plugin Claude Code completo: `.claude-plugin/plugin.json`, `.mcp.json` (`npx -y @agent-plan/mcp`, D3), `skills/planner/SKILL.md` (routing derivato da `_shared/`), `hooks/hooks.json` SessionStart non-bloccante (D7), `scripts/notify-session-start.sh`. Marketplace **a radice repo** `.claude-plugin/marketplace.json` (correzione vs. pianificato: i docs richiedono `.claude-plugin/` alla root) → source `./plugins/claude-code`, `defaultEnabled:false` (D4), canale 2 self-hosted nessuna approvazione (D8). `scripts/sync-plugins.cjs` con `--check` per CI drift guard + script pnpm `plugins:sync`/`plugins:check`. `claude plugin validate ./plugins/claude-code` ✔. Decisioni D1–D10 + F002-D1 documentate in `plugins/DECISIONS.md`.
- [x] **F002 — Tool web lifecycle esposti all'agente (pi-adapter 0.2.14)**: registrati 3 agent tool in `packages/pi-adapter/src/index.ts` (`planner-web`, `planner-load`, `planner-stop`) che wrappano le stesse funzioni interne degli slash command (`startServer`/`stopServer`/`buildStartupResumeSummary`). Parità con `@agent-plan/mcp` (`planner-web` PR #11). Motivo: i comandi `/planner *` non vengono intercettati quando il planner è disabilitato (default), quindi né utente né agente potevano avviare il web; ora l'agente Pi può gestire il web direttamente via tool. Smoke test verificato: start su porta dinamica LAN, status, load con recap+URL, stop. Build + `pnpm check` puliti.

### Note operative
- La checklist va tenuta viva e aggiornata con stati, blocchi e completamenti.
- Il core del piano deve restare harness-agnostic.
- I dati del piano vivono in `.planner/` dentro il progetto target.

- [x] **MCP parity (Claude Code/Codex)** — `planner-load` reale + recap + web UI bundle (`fix/mcp-parity-recap-web-ui`):
  - **Web UI bundle in `@agent-plan/server`**: `serve()` ora defaulta `staticDir` alla UI bundle (`../web-ui-dist` relativo a `dist/serve.js`) quando il caller non la passa. `scripts/copy-web-ui.sh` copia la dist Vite anche in `packages/plan-server/web-ui-dist`; `plan-server` package `files` include `web-ui-dist/**`. Risultato: `planner-web start` (MCP) e `plan-server` CLI servono **UI + API** out-of-the-box (prima solo API → Claude vedeva niente UI). `staticDir: ""` per forzare API-only.
  - **`planner-load` reale (plan-mcp)**: non più stub. Avvia il web su LAN (0.0.0.0:0) + ritorna un **recap consolidato** (stato progetto, task in-progress con focus, eventuale handoff pendente incluso nel risultato, URL web). Una chiamata = parity con `/planner load` di Pi. Helper `ensureWebStarted()` (condiviso con `planner-web`) + `buildRecapText()`.
  - **Template `setup claude-code`**: `/planner load` istruisce l'agente a presentare il recap, processare l'handoff incluso (poi `planner-handoff-clear`), e terminare con `🌐 Web UI: <url>`. Aggiunto `/planner recap` (alias di load).
  - **AGENTS.md**: nuova regola "avvia la sessione del planner" (chiama `planner-load`/`/planner load`/`recap` a inizio lavoro + presenta recap + URL + consuma handoff) + "Regola dettagli" (scrivi su task/phase/feature appena hai punti rilevanti; leggi description/notes quando inizi un task; riferimenti con composito `#T007 · F001/P002/T003`, non UUID nudi).
  - Smoke test: `serve()` default serve UI (GET / → 200 HTML) + API su /api/health; `buildRecapText` su heca → Heca F10/P77/T294, 1 in-progress con focus corretto, nextSteps, no handoff.
  - **Limiti residui MCP**: nessun auto-trigger (no hook session_start in MCP) → dipende dall'agente che chiama il tool, reso "automatico" via AGENTS.md + template; nessun URL appended a ogni messaggio (no message_end hook) → URL solo nel recap e in `planner-web status`.

### Fatto — F004 Entity-scoped handoff + per-feature file storage (sessione 2026-07-15/16)
- [x] **Feature F004 completa (6 fasi)**: storage un file per feature (P001) + handoff per-entity su fase `phase.handoff` (P002) + tool adapter entity + deprecation file-based (P003) + resume flow entity + delete-on-resume + auto-clear-on-done (P004) + Web UI viewer/badge/API/WS (P005). `.planner/HANDOFF.md` deprecato; handoff scrive/legge/cancella su `phase.handoff` via `handoff list/show/write/clear`.
- [x] AGENTS.md §11 riscritta entity-scoped (delete-on-resume, auto-clear-on-done, comandi `handoff`, operazioni = planner ops non-bloccanti).
- [x] Test core 29/29 verdi (per-feature storage + phase-handoff + findPhaseByRef + resume-flow); smoke API + Puppeteer @390px verdi.

### Fatto — Refactor A: storage un file per feature (per-feature storage) (sessione 2026-07-15)
- [x] **P001 storage refactor completato** (feature F004 — Entity-scoped handoff + per-feature file storage). Persistenza feature migrata da unico `features.json` a un file per feature `features/<id>.json`.
- [x] **plan-core** (`packages/plan-core/src/plan-store.ts`): aggiunti `featuresDir()`/`featurePath(id)` + `withFeaturesLock` (sentinel = path della dir, serializza le mutation RMW) + `migrateLegacy()` (idempotente + crash-safe: legge legacy `features.json`, scrive `features/<id>.json`, unlink legacy). `loadFeatures()` riscritta: readdir `features/` + read per-file (FeatureSchema, skip invalid con warn), fallback legacy quando `features/` non ha `.json`. `saveFeatures()` = `withFeaturesLock(migrate + saveRaw)` + orphan reconcile (unlink file non più nel doc). Nuovo `saveFeature(feature)` granulare. `updateFeatures()` = `withFeaturesLock(migrate + load + updater + saveRaw)`, signature preservata (~20 caller). `withWriteLock` non è rientrante → split public (con lock) vs `saveFeaturesRaw` (senza lock) per evitare deadlock. `ensureStructureOrdering` ora usa `loadFeatures()`; `init` crea `features/`.
- [x] **pi-adapter hint**: `filesTouched` `".planner/features.json"` → `".planner/features/"` (display-only, nessuna logica dipendente).
- [x] **Test permanenti (node:test, zero nuove dipendenze)**: `packages/plan-core/test/per-feature-storage.test.mjs` (7 test: legacy load, migrazione + rimozione legacy, reload con ID preservation, orphan reconcile, saveFeature granulare, migrateLegacy idempotente+crash-safe, fresh-project empty→per-file). Script `"test": "tsc -p tsconfig.json && node --test \"test/**/*.test.mjs\""` in `packages/plan-core/package.json`. 7/7 pass.
- [x] Validazione: `pnpm check` (tsc -b) pulito; `pnpm -r build` pulito; 7/7 test pass; migrazione real-data (4 feature di agent-plan su copia temp) OK con ID preservation.
- [ ] **Da fare al release**: bump `@agent-plan/core` (persistenza cambiata) e `@agent-plan/pi-adapter` (hint) prima della PR `develop → main`. La migrazione del `.planner` live avviene automaticamente al primo write dopo l'update dell'estensione alla nuova core.

### Fatto — P002 Handoff field su Phase + PlanStore ops (sessione 2026-07-15)
- [x] **P002 storage refactor completato** (feature F004, fase P002 — core-only, harness-agnostic). Aggiunto campo handoff entity-scoped sulla Fase + operazioni CRUD core.
- [x] **schema** (`packages/plan-core/src/schema.ts:211-212`): `PhaseSchema` += `handoff: z.string().default("")` + `handoffUpdatedAt: z.string().default("")`. Backfill automatico via zod default sui phase file esistenti (nessuna migrazione esplicita). Type `Phase` (`z.infer`) auto-aggiornato.
- [x] **naming** (`packages/plan-core/src/naming.ts`): aggiunto `formatPhaseRef(phaseNumber, featureNumber?)` → `P00x` o `P00x(F00x)` (riuso `formatThreeDigitNumber`). Helper harness-agnostic per il composite ref.
- [x] **PlanStore ops** (`packages/plan-core/src/plan-store.ts`): `PhaseHandoffSummary` interface (export) + helper `handoffFirstLine()` (prima riga non-vuota, header `#` stripped, ~80 char). 4 op: `getPhaseHandoff(id)` (loadPhase.handoff), `setPhaseHandoff(id,text)` + `clearPhaseHandoff(id)` (via `updatePhase` → `atomicUpdateJson` per-file lock + `maybeAutoSync`; clear **lascia** `handoffUpdatedAt` come audit trail), `listHandoffs()` (loadAllPhases + loadFeatures per mappa featureId→number, filtra non-vuoti, sort `handoffUpdatedAt` desc, ritorna `{phaseId, compositeRef, updatedAt, firstLine}`).
- [x] **Export** (`packages/plan-core/src/index.ts`): export `type PhaseHandoffSummary` dal barrel (le 4 op sono metodi su `PlanStore`, già esportato).
- [x] **Compat adapter/server**: aggiunti `handoff:"", handoffUpdatedAt:""` ai 4 literal `Phase` di `phase_create` (plan-mcp, plan-server, pi-adapter ×2) perché lo zod `.default()` rende il campo obbligatorio nel tipo output `z.infer`.
- [x] **Test** (`packages/plan-core/test/phase-handoff.test.mjs`, 8 test node:test): default backfill, set→get round-trip, clear→list exclude, sort desc, multiple coexist con compositeRef `P001`/`P002(F001)` + firstLine header-strip, clear preserva audit, set/get su phase mancante → throw.
- [x] Validazione: `pnpm -r build` pulito; `pnpm check` pulito; **15/15 test pass** (7 storage + 8 handoff); smoke ops OK.
- [ ] **Da fare al release**: bump `@agent-plan/core` (schema+ops) prima della PR `develop → main`. P003 (tool handoff negli adapter + deprecation file-based) consumerà queste op.

### Fatto — P003 Tool handoff negli adapter + deprecation file-based (sessione 2026-07-15)
- [x] **P003 completato** (feature F004, fase P003). Tool handoff entity-scoped esposti in pi-adapter e plan-mcp; path file-based deprecato (redirect dei vecchi tool con warn).
- [x] **T004 `findPhaseByRef` core** (`packages/plan-core/src/refs.ts`): risolutore harness-agnostic `findPhaseByRef(phases, features, ref)` — UUID / `P00x` / `P00x(F00x)` (valida parent feature) / fallback title. Export dal barrel. Test `phase-ref.test.mjs` (8 casi). 23/23 test verdi.
- [x] **T001 pi-adapter** (`packages/pi-adapter/src/index.ts`): import `findPhaseByRef`+`formatPhaseRef`; helper `resolvePhaseForHandoff` (ref o fase in-progress corrente → Phase + compositeRef); 4 tool `handoff_list/show/write/clear` (consumano ops P2); comando `/planner handoff` esteso con `list` + phaseRef opzionale (show/write/clear entity-scoped); `prepare` lasciato legacy. Completions + SUB_HELP + tool-list aggiornati.
- [x] **T002 plan-mcp** (`packages/plan-mcp/src/index.ts`): rimosso `findPhaseByRef` locale (title/UUID), importato quello core; migrati 5 call-site phase-tool a 3-arg (bonus: `P00x` funziona anche nei phase-tool MCP); 4 tool `planner-handoff-list/show/write/clear` (rimpiazzato i 3 file-based, aggiunto list); `planner-handoff-prepare` lasciato legacy.
- [x] **T003 deprecation file-based**: `plan_write_handoff`/`plan_get_handoff`/`plan_delete_handoff` (pi-adapter) → redirect entity-scoped con warn di deprecation (`buildHandoffMarkdown` tenuto come helper, scrive su `phase.handoff`); `planner-handoff-prepare` (mcp) → istruzioni entity-scoped; hygiene notices (pi-adapter ×2, mcp ×1) → check `existsSync(HANDOFF.md) || listHandoffs().length>0` + messaggi aggiornati. Tool descriptions marcate DEPRECATED.
- [x] **ID compositi** in tutti i messaggi (`P00x` / `P00x(F00x)`), mai UUID nudi.
- [x] Validazione: `pnpm -r build` pulito; `pnpm check` pulito; smoke T001/T002 OK (default→in-progress, ref resolution, ops path).
- [ ] **Split T003 vs P004**: gli auto-write su session-event (`writeProjectHandoff` a 923/932/942) + resume summary/protocollo (264/341/357/382/3605/3716/3791/3793) restano file-based e sono **P004** (resume flow: load injection, delete-on-resume, auto-clear-on-done, protocollo, hygiene). `writeProjectHandoff` mantenuto (usato dai session-event).
- [ ] **Da fare al release**: bump `@agent-plan/core` (refs.ts), `@agent-plan/mcp` (tool + findPhaseByRef migration), `@agent-plan/pi-adapter` (tool + deprecation) prima della PR `develop → main`.

### Fatto — P004 Resume flow: load injection, delete-on-resume, auto-clear-on-done, protocollo, hygiene (sessione 2026-07-15)
- [x] **P004 completato** (feature F004, fase P004). Handoff entity-scoped integrati nel flow di resume (entrambi gli adapter); auto-clear su fase done; delete-on-resume; hygiene gate entity; fallback resume.json.
- [x] **T1 auto-clear-on-done** (`packages/plan-core/src/plan-store.ts`): `syncStatuses()` ritorna `string[]` (composite ref delle fasi con handoff auto-cancellato su transizione → done, `handoffUpdatedAt` tenuto come audit); `syncTaskStatusRollup(phaseId)` ritorna `string | null`. Notify: pi-adapter `maybeHealStatuses(st, ctx?)` (3 call-site aggiornati a passare ctx); mcp `planner-task-complete` appende il ref cancellato.
- [x] **T3 hygiene gate** (pi-adapter + mcp): rimosso il warn file-based `HANDOFF.md`; session_start detector → entity review hint; task-start/task-update(in-progress)/mcp hygiene → check `listHandoffs().length>0` + messaggio "if relevant, handoff show <ref> → clear". Non-bloccante.
- [x] **T2 load injection** (`packages/pi-adapter/src/index.ts`): `buildStartupResumeSummary` + context block + `startupResumeProtocol` ora consumano `listHandoffs()` e iniettano la lista numerata `[n] P00x(F00x) — <data> — "<prima riga>"` nel recap; protocollo: presenta lista → raccomanda la più recente/allineata → chiedi conferma → `handoff show <ref>` → leggi → **cancella con `handoff clear`** → riprendi; fallback 0-handoff → resume.json. `writeProjectHandoff` (before_session/compact/shutdown) ora scrive sulla fase in-progress corrente (`setPhaseHandoff`), skip se nessuna attiva — non scrive più `.planner/HANDOFF.md`. `buildHandoffMarkdown` senza dipendenza file (createdAt fresh); template strings entity. `/planner handoff prepare` entity. MANDATORY PROTOCOL item 1 riscritto entity (non-bloccante).
- [x] **T2 mcp** (`packages/plan-mcp/src/index.ts`): `buildRecapText` (Claude Code/Codex) → `listHandoffs()`; "## Pending phase handoffs (N)" + lista numerata + "planner-handoff-show <ref> then planner-handoff-clear <ref> once consumed (delete-on-resume)".
- [x] **T4 delete-on-resume**: istruzione esplicita nel protocollo (pi-adapter riga 3713 + mcp riga 100): dopo show+conferma, l'agente cancella con `handoff clear <ref>` PRIMA di iniziare il lavoro. Default = clear su ripresa confermata (non automatico: l'agente può tenere la voce se non riprende davvero).
- [x] **T5 fallback + test**: `listHandoffs()` vuoto → resume.json focus; 0 handoff + 0 active → "review the plan". Test `packages/plan-core/test/resume-flow.test.mjs` (6 test verdi: auto-clear syncStatuses + rollup + reopen-no-restore + no-transition + write-to-in-progress + skip/fallback). Suite core 29/29 verdi.
- [x] Validazione: `pnpm -r build` pulito; `pnpm check` pulito; 29/29 test core verdi; smoke T2 data-path OK.
- [x] **Nessun riferimento file-based residuo** negli adapter (grep: `handoff?.content`, `handoff?.updatedAt`, `st.saveHandoff`, `st.loadHandoff()`, `existingHandoff` = 0 occorrenze in pi-adapter e mcp).
- [ ] **Da fare al release**: bump `@agent-plan/core` (plan-store auto-clear + return types), `@agent-plan/mcp` (buildRecapText), `@agent-plan/pi-adapter` (resume flow + writeProjectHandoff redirect) prima della PR `develop → main`. Verificare il recap su Pi dopo `/planner load` (l'URL Web UI rimane visibile).

### Fatto — P005 Web UI: viewer handoff + badge + API server + WS (sessione 2026-07-16)
- [x] **P005 completato** (feature F004, fase P005). API server entity-scoped + client api.ts + WS live + badge fasi + viewer completo.
- [x] **T1 server API** (`packages/plan-server/src/serve.ts` + `ws-hub.ts`): rimosse route file-based `GET/DELETE /handoff`; aggiunte `GET /handoffs`, `GET /phases/:id/handoff`, `PUT /phases/:id/handoff` (content vuoto = clear), `DELETE /phases/:id/handoff` (404 se fase mancante, audit preservato). WS events `handoffUpdated`/`handoffCleared {phaseId} in `WsEvent` + broadcast `phases-updated`+`plan-rendered`.
- [x] **T2 client** (`packages/plan-web-ui/src/lib/types.ts` + `api.ts` + `app/root.tsx` + `live-sync.tsx`): `Phase` += `handoff`+`handoffUpdatedAt`; `HandoffDocument` → `HandoffSummary`+`PhaseHandoff`; `normalizePhase` defaults; `listHandoffs`/`getPhaseHandoff`/`setPhaseHandoff`/`clearPhaseHandoff` sostituiscono `getHandoff`/`deleteHandoff`; root loader → `listHandoffs` (`handoffExists = handoffs.length>0`); live-sync switch += `handoffUpdated`/`handoffCleared`.
- [x] **T3 badge** (`components/ui/badges.tsx` + `styles/base.css`): `HandoffBadge` (icona documento + label "handoff" nascosta <640px + tooltip con data + link `/handoff` + `shrink-0`). Inserito in Work Tree phase row, phase-row lista, phase-detail header (guard `phase.handoff`).
- [x] **T4 viewer** (`routes/handoff.route.tsx`, riscritto da file-based): two-pane responsive — lista pending (`CopyableBadge` compositeRef + firstLine + data) | contenuto full `FormattedText` (`.formatted-text` overflow rules) + pulsante **Clear** (delete-on-resume da UI). WS live re-fetch su `handoffUpdated`/`handoffCleared`. Empty state "No pending phase handoffs". Default seleziona il primo. Route (non modal) → scroll naturale su mobile, overflow 0.
- [x] Validazione: `pnpm -r build` + `pnpm check` puliti; 16/16 API smoke verdi; Puppeteer @390px verde (badge presente/assente correttamente + tooltip + click→/handoff; viewer 2 handoff + switch content + Clear→empty + FormattedText + 0 overflow + 0 errori console). Bundle syncato su `plan-server` + `pi-adapter` web-ui-dist.
- [ ] **Da fare al release**: bump `@agent-plan/server` (API entity + WS events) + `@agent-plan/web-ui` (badge+viewer+client) prima della PR `develop → main`.
