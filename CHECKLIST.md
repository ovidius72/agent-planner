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

### Fatto — plan-web-v2 (da zero)
- [x] Nuovo package: `packages/plan-web-v2/`
- [x] Struttura: pages/, components/ui/, components/layout/, components/charts/, components/features/, components/phases/
- [x] Tipi: Feature, Phase, Task, Project in `types.ts`
- [x] API client: `api.ts` con tutti gli endpoint
- [x] TanStack Query hooks: `hooks/use-queries.ts`
- [x] WebSocket live sync: `ws.ts`
- [x] Componenti UI: Card, Button, Badge, Modal, Input/Textarea/Select
- [x] Layout: AppShell (centrato, m-auto, max-w-[1120px]), NavBar (sticky, link Dashboard/Features)
- [x] Tema: light/dark con CSS variables + data-theme + localStorage
- [x] Dashboard: stat cards, phase distribution bar chart, ClickUp-style feature list
- [x] Features page: lista completa con stato modificabile direttamente dalla riga
- [x] Feature detail: metadati, stats, work log, phases CRUD
- [x] PhaseCard: edit inline + delete
- [x] HashRouter con route: /, /features, /features/:id
- [x] TailwindCSS v4 (@tailwindcss/vite), design tokens puliti
- [x] Build: `pnpm --filter @agent-plan/web-v2 build` passa (tsc + vite)
- [x] WebSocket hook per sync real-time
- [x] Dashboard con statistiche e grafici (overview project + fasi/task)
- [x] React Router (HashRouter) per navigazione
- [x] Phase detail page con form di edit (tutti i campi)
- [x] Task detail page con form di edit
- [x] Form di creazione fase/task
- [x] Tema light/dark con look glass/blur + icone moderne
- [x] CSS dedicato (`index.css` + Tailwind v4)

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

### Fatto — bootstrap/discuss planner
- [x] `planner-init` ora raccoglie titolo + short description
- [x] `planner-init` avvia automaticamente il bootstrap `project discuss`
- [x] Aggiunti comandi flat visibili con autosuggest: `planner-project-discuss`, `planner-phase-discuss`, `planner-task-discuss`
- [x] `planner-project-discuss` supporta bootstrap/re-discuss con codebase hints, Q&A e approvazione prima del salvataggio
- [x] `planner-phase-add` ora può collegare la fase a una feature e avviare subito `phase discuss`
- [x] `planner-task-add` ora può avviare subito `task discuss`
- [x] `planner-task-discuss` può inizializzare descrizione e checklist del task

### In corso
- [ ] Runtime validation post-restart / Claude Code hook validation. Vedi `BACKLOG.md`.
- [ ] Memoria progetto / handoff automatico / porte web per progetto (handoff fatto — vedi `BACKLOG.md`)
- [ ] Rivedere generazione markdown con dati reali

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
- [x] Implementato P0-1 task lifecycle guard: Pi blocca `bash/edit/write` senza task `in-progress`; Claude Code setup installa hook `PreToolUse` per `Bash|Edit|Write`; backlog aggiornato a implementato/pending runtime validation.
- [x] Aggiunto al `BACKLOG.md` il piano deferred per integrazione Zed: MCP context server, setup CLI, usage docs, profilo agent, skill/extension opzionale e limiti del task guard.
- [x] Sistemato e validato `/planner export` e `/planner export-full`: Pi ora esporta direttamente senza HTTP/503, MCP non usa più `require` ESM, Markdown export è più robusto, `pnpm build`, `pnpm check`, `git diff --check`, CLI export e smoke MCP passano.
- [x] Abbreviati i prompt Pi `y/n/always` in `y/n/(a)lways`; l'alias `a` era già supportato.
- [x] Completata export UX: `export`/`export-full` compaiono nel menu Pi `/planner`, Web UI ha dropdown `Export` con download Summary/Full.

### Fatto — planner discuss / decision persistence / dashboard
- [x] Checklist task: checkbox persistenti, sempre visibili, collegati al task, senza redirect alla route `/toggle`
- [x] Header con task `in-progress` alimentato dal root loader
- [x] Rimossa duplicazione goal/description nel layout principale
- [x] Aggiunto accordion "AI Consolidated Context" in dashboard
- [x] Aggiunto campo strutturato `acceptedDecisions` su project/feature/phase/task
- [x] Resa visibile la lista `acceptedDecisions` in dashboard, feature detail, phase detail e task detail
- [x] Renderer markdown aggiornato per includere accepted decisions e dettagli operativi persistiti
- [x] Ridotta la confusione con GSD nei flussi planner discuss tramite regole/prompt espliciti

### Prossimi passi
- [ ] Web UI: pagina requirements
- [ ] README + guida d'uso
- [ ] Investigare autocomplete subcommand in Pi (se supportato)

### Note operative
- La checklist va tenuta viva e aggiornata con stati, blocchi e completamenti.
- Il core del piano deve restare harness-agnostic.
- I dati del piano vivono in `.planner/` dentro il progetto target.
