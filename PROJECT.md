# Agent Plan Platform

## Obiettivo
Realizzare una platform locale e project-scoped per creare, mantenere e visualizzare un piano di progetto strutturato, con integrazione nativa per Pi e compatibilità progettuale con altri harness/agenti (Claude Code, Codex, ecc.).

## Visione
La platform deve permettere di:
- inizializzare un piano di progetto se non esiste
- raccogliere e mantenere scopo, regole, stack tecnologico e tools
- definire requirements iniziali e macro-task
- definire fasi di lavoro ad alto livello
- discutere ogni fase tramite Q&A guidata fino a chiarirne scope, vincoli, dipendenze e outcome, senza entrare subito nei dettagli implementativi
- creare checklist di task e subtasks per ogni fase
- visualizzare e modificare il piano da web UI
- sincronizzare modifiche web <-> file di progetto
- rendere il piano leggibile e usabile anche da altri harness

## Requisiti funzionali consolidati

### 0. Regola di esecuzione del progetto
Chiunque lavori su questo progetto deve:
- mantenere una checklist di lavoro aggiornata
- aggiornare la checklist durante lo svolgimento delle attività, non solo alla fine
- rendere espliciti stato, prossimi passi e blocchi
- trattare questa regola come obbligatoria per agenti e umani

### 1. Inizializzazione piano
Il sistema deve:
- creare il piano se non esiste già
- vivere dentro il progetto target in una cartella `.planner/`
- raccogliere almeno:
  - scopo del progetto
  - regole da seguire
  - tecnologie da usare
  - tools da usare
  - requirements iniziali
  - macro-task iniziali

### 2. Gestione progetto
Il piano deve contenere:
- goal del progetto
- scope e out-of-scope
- decisioni principali
- regole globali operative
- stack e tools
- requirements e macro-task

### 3. Gestione fasi
Per ogni fase il sistema deve supportare:
- creazione
- modifica
- stato
- discussione guidata
- checklist task/subtask
- rendering leggibile

Ogni fase deve avere:
- numero identificativo
- slug stabile
- id derivato da numero + slug
- titolo
- descrizione
- summary
- stato
- date di creazione/aggiornamento

Formato id raccomandato:
- `phase-01-auth-core`
- `phase-02-api-foundation`

### 4. Discovery di fase
Per ogni fase l’agente deve:
- fare domande e risposte fino a chiarire la fase
- usare `grill-me` quando disponibile
- non richiedere dettagli implementativi completi in discovery
- raccogliere solo quanto necessario per definire:
  - obiettivo
  - scope
  - non-scope
  - dipendenze
  - rischi
  - criteri di completamento ad alto livello

### 5. Gestione task
Ogni fase deve avere:
- checklist di task
- subtasks annidate o associate
- stato per task/subtask
- descrizione e aggiornamento

Naming task richiesto:
- `[phase-slug]-task-[numero]-[short-name]`

Esempio:
- `auth-core-task-001-db-schema`
- `auth-core-task-002-login-flow`

### 6. Regole operative globali
Devono esistere regole configurabili per:
- prima di iniziare una fase
- prima di iniziare un task della fase
- al termine della fase

### 7. Stati
Stati minimi richiesti per fasi/task:
- `planned`
- `in-progress`
- `done`
- `blocked`
- `canceled`

Per le fasi il modello può includere anche:
- `draft`
- `discovery`

### 8. Web UI
Deve essere possibile da web:
- visualizzare il piano
- visualizzare le fasi
- visualizzare i task correlati
- vedere stato, data aggiornamento e descrizione
- aggiungere nuove fasi
- aggiungere task
- modificare entità esistenti
- sincronizzare le modifiche con il piano nel progetto

### 9. Compatibilità multi-harness
La platform deve essere progettata in modo che il piano sia fruibile anche da:
- Pi
- Claude Code
- Codex
- altri harness futuri

Questo implica:
- formati file aperti e leggibili
- schema esplicito
- API o CLI riusabili
- adapter separati dal core

## Decisioni architetturali prese

### A. Architettura generale
Decisione: **platform core + adapter Pi**

Quindi:
- il dominio del piano non dipende da Pi
- Pi è un adapter/orchestratore
- altri adapter potranno essere aggiunti in futuro

### B. Source of truth
Decisione: **JSON strutturato** come fonte primaria.

Motivazione:
- editing affidabile
- validazione schema
- sincronizzazione più semplice
- compatibilità con più harness

### C. Markdown
Decisione: **Markdown generato**, non fonte primaria.

Motivazione:
- deve essere leggibile da umani e agenti
- evitare parsing bidirezionale fragile

### D. Posizione dei dati
Decisione: il piano vive dentro il progetto in:
- `.planner/`

### E. UI
Decisione: **React da subito**.

### F. Web stack
Direzione approvata:
- frontend: React + TypeScript
- backend locale: Hono su Node
- sync live: SSE inizialmente
- validazione: Zod

### G. Modularità
Componenti previsti:
- `plan-core`
- `plan-server`
- `plan-web`
- `pi-adapter`

### H. Compatibilità multi-harness
Decisione: il core deve essere **harness-agnostic**.

### I. Sviluppo isolato
Decisione: il progetto viene sviluppato fuori da `~/.pi`, nella cartella:
- `/Users/antonio/projects/agent-plan`

### J. Struttura repository
Decisione: partire subito con un monorepo/workspace minimale, con package separati ma un solo repository.

### K. Disciplina di esecuzione
Decisione: ogni lavorazione deve mantenere e aggiornare una checklist persistente nel repository.

Implicazioni:
- ogni agente deve leggere la checklist all'inizio del lavoro
- ogni agente deve aggiornare la checklist quando completa, avvia o blocca un'attività
- la checklist è parte del processo, non documentazione opzionale

## Architettura target

### 1. plan-core
Responsabilità:
- schema dati
- validazione
- CRUD file
- naming/id/slug
- gestione stati
- render markdown
- sync e persistenza

### 2. plan-server
Responsabilità:
- API REST locale
- SSE per aggiornamenti live
- accesso ai dati `.planner/`
- trigger di render markdown

### 3. plan-web
Responsabilità:
- overview progetto
- lista requirements
- lista fasi
- dettaglio fase
- dettaglio task
- CRUD essenziale

### 4. pi-adapter
Responsabilità:
- init del piano
- workflow discovery fase
- integrazione `grill-me`
- comandi/tool custom
- avvio/arresto web server
- prompt injection contestuale

## Struttura `.planner/` proposta

```text
.planner/
  README.md
  manifest.json
  project.json
  requirements.json
  phases/
    phase-01-auth-core.json
    phase-02-api-foundation.json
  generated/
    PLAN.md
    phases/
      phase-01-auth-core.md
      phase-02-api-foundation.md
  schema/
    plan.schema.json
  adapters/
    AGENTS.md
    CLAUDE.md
    CODEX.md
```

## Vincoli progettuali
- niente dipendenza del dominio da Pi
- niente markdown come source of truth
- scritture centralizzate
- validazione forte
- file leggibili anche da tooling esterno
- workflow fase ad alto livello prima dell’implementazione dettagliata

## Non-obiettivi v1
- collaborazione multi-user remota
- auth complessa
- realtime collaboration avanzata
- board/gantt sofisticati
- pianificazione implementativa ultra-dettagliata già in discovery

## Esito attuale
Le decisioni principali sono consolidate. Il prossimo lavoro è trasformarle in:
1. struttura monorepo/workspace minimale
2. schema dati completo
3. scaffold tecnico iniziale
