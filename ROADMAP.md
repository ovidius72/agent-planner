# Roadmap di realizzazione

## Obiettivo della roadmap
Costruire la platform in modo incrementale, mantenendo il core indipendente dagli adapter e limitando il rischio durante lo sviluppo.

## Regola di processo obbligatoria
Durante qualunque attività su questo progetto deve esistere una checklist aggiornata nel repository.

Regole:
- aggiornare la checklist mentre si lavora
- segnare stato, blocchi e prossimi step
- non considerare un'attività completa se la checklist non è stata aggiornata

## Fase 0 — Foundation del repository
Obiettivo:
- creare il workspace del progetto
- impostare tooling base
- preparare la suddivisione in package

Output attesi:
- monorepo/workspace iniziale
- package base:
  - `plan-core`
  - `plan-server`
  - `plan-web`
  - `pi-adapter`
- TypeScript config condivisa
- lint/format/test base

## Fase 1 — Dominio e persistenza (`plan-core`)
Obiettivo:
- definire il modello dati e la persistenza in `.planner/`

Attività:
- definire schema Zod per:
  - manifest
  - project
  - requirements
  - **feature** (nuovo — contiene fasi e raggruppa attività)
  - phase (con link a feature)
  - task
  - subtask
- definire convenzioni naming/id/slug per feature
- implementare read/write atomico
- implementare validazione
- implementare CRUD minimo
- implementare generazione markdown:
  - `generated/PLAN.md`
  - `generated/features/*.md`
  - `generated/phases/*.md`

Criteri di completamento:
- è possibile creare `.planner/` da zero
- è possibile creare/modificare fasi e task da API di libreria
- il markdown viene rigenerato in modo coerente

## Fase 2 — Server locale (`plan-server`)
Obiettivo:
- esporre il core tramite API locale

Attività:
- creare server Hono
- implementare endpoint REST per:
  - project
  - requirements
  - **features** (CRUD completo)
  - phases (con filtro featureId)
  - tasks
- WebSocket broadcast per events `features-updated`
- implementare file watcher su `.planner/`
- propagare eventi di aggiornamento ai client

Criteri di completamento:
- un client può leggere e modificare il piano via HTTP
- il server notifica aggiornamenti live
- cambi esterni ai file vengono rilevati

## Fase 3 — Nuova Web App (v2)
Obiettivo:
- creare UI React professionale e strutturata
- gerarchia **features → phases → tasks**
- pagine e componenti separati

Attività:
- struttura cartelle: pages/ + components/ui + components/features + components/phases
- pagine:
  - Dashboard con riepilogo + grafici + lista stile ClickUp
  - Features list (CRUD completo, stato modificabile dalla lista)
  - Feature detail (phases annesse, workDone/workRemaining)
- componenti atomici: Card, Button, Badge, Modal, Input/Textarea/Select
- design tokens CSS: colori, spaziature, temi light/dark
- gradient + blur + glassmorphism
- TanStack Query + WebSocket live sync
- TailwindCSS v4 puro, niente classi CSS custom globali

Criteri di completamento:
- il piano è navigabile dal browser
- fasi e task sono modificabili dal web
- la UI resta sincronizzata con i file `.planner/`

## Fase 4 — Adapter Pi (`pi-adapter`)
Obiettivo:
- integrare Pi come orchestratore intelligente della platform

Attività:
- registrare tool custom per lettura/scrittura piano
- registrare comandi custom, ad esempio:
  - `/plan-init`
  - `/plan-show`
  - `/phase-add`
  - `/phase-discuss <phase-id>`
  - `/task-add <phase-id>`
  - `/plan-web start`
  - `/plan-web stop`
- implementare init guidato del piano
- implementare avvio/arresto server web
- implementare prompt injection contestuale

Criteri di completamento:
- Pi può inizializzare il piano
- Pi può creare e aggiornare fasi/task
- Pi può avviare la web UI locale

## Fase 5 — Discovery guidata delle fasi
Obiettivo:
- supportare il workflow Q&A ad alto livello per chiarire una fase

Attività:
- integrare `grill-me` quando disponibile
- prevedere fallback interno se la skill non è disponibile
- definire stop condition della discovery
- salvare in fase almeno:
  - goals
  - nonGoals
  - dependencies
  - risks
  - openQuestions
  - completionCriteria

Criteri di completamento:
- una fase può passare da `draft`/`discovery` a `planned`
- la discovery chiarisce la fase senza pretendere dettagli implementativi completi

## Fase 6 — Regole operative / gates
Obiettivo:
- applicare le regole globali richieste prima/dopo fase/task

Attività:
- modellare regole in `project.json`
- implementare controlli per:
  - beforePhaseStart
  - beforeTaskStart
  - afterPhaseComplete
- renderizzare queste regole nel markdown e nella UI
- iniettarle nel prompt di Pi quando rilevante

Criteri di completamento:
- i gate sono persistiti, visibili e applicabili
- Pi li usa come contesto operativo

## Fase 7 — Compatibilità multi-harness
Obiettivo:
- rendere il sistema utilizzabile anche fuori da Pi

Attività:
- pubblicare schema JSON chiaro
- creare docs adapter-specifiche:
  - `AGENTS.md`
  - `CLAUDE.md`
  - `CODEX.md`
- valutare CLI o MCP come step successivo

Criteri di completamento:
- un altro harness può leggere e capire `.planner/`
- la struttura è abbastanza stabile da essere integrata da tooling esterno

## Ordine di implementazione consigliato
1. repository/workspace
2. `plan-core`
3. `plan-server`
4. `plan-web`
5. `pi-adapter`
6. discovery fase
7. gates
8. multi-harness docs/adapter

## Rischi principali
- crescita prematura della UI React
- coupling involontario del core con Pi
- conflitti di scrittura tra web e adapter
- eccesso di dettaglio in discovery fase
- parsing/rigenerazione markdown non consistente

## Mitigazioni
- core separato fin dall’inizio
- un solo layer di persistenza
- markdown solo derivato
- API piccole e validate
- workflow discovery con stop condition esplicita

## Prossimo step consigliato
Dopo questi documenti, il passo migliore è:
1. definire la struttura del repository (repo semplice vs workspace)
2. definire lo schema Zod completo
3. generare lo scaffold iniziale dei package/moduli
