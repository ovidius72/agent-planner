# AGENTS.md

Questo file definisce le regole fondamentali per chiunque lavori su questo progetto: agenti Pi, Claude Code, Codex o contributor umani.

## Regole non negoziabili

### 1. Mantieni sempre una checklist aggiornata
È obbligatorio usare e aggiornare una checklist persistente nel repository durante il lavoro.

Regole operative:
- leggere la checklist prima di iniziare
- aggiornare la checklist quando un'attività parte, cambia stato, si blocca o si conclude
- annotare chiaramente i prossimi passi
- non lasciare lavoro implicito solo nella conversazione

File di riferimento iniziale:
- `CHECKLIST.md`

### 2. Rispetta rigorosamente il Lifecycle dei Task
L'integrità del piano e la precisione della dashboard dipendono dalla sincronizzazione **immediata** tra l'attività dell'agente e lo stato dei task. L'aggiornamento del piano non è un'attività di "chiusura sessione", ma un prerequisito operativo.

Regole operative:
- **Sempre `task_start`**: prima di toccare una sola riga di codice, l'agente DEVE chiamare `task_start`. È l'attivazione del contesto di lavoro.
- **Sempre `task_complete`**: al termine di ogni deliverable, l'agente DEVE chiamare `task_complete`.
- **Sincronizzazione Istantanea**: i cambi di stato (start/complete/block) devono avvenire **nel momento esatto** in cui la transizione avviene. È vietato accumulare aggiornamenti di stato per l'ultima fase della sessione.
- **Sincronizzazione costante**: se l'estensione segnala "Nessun task attivo", l'agente deve regolarizzare immediatamente la situazione avviando il task corretto.
- **Stato = Verità**: se un task è `in-progress`, l'agente deve effettivamente starci lavorando. Se smette, deve chiuderlo o bloccarlo (giustificando l'azione nello `statusLog`).

### 2. Non usare il markdown come source of truth del piano
Il piano di progetto deve avere come fonte primaria dati strutturati in `.planner/`.
Il markdown è una vista generata, leggibile da umani e agenti.

### 3. Il core deve restare harness-agnostic
Il dominio del piano non deve dipendere da Pi.
Pi è un adapter. Anche altri harness dovranno poter leggere e usare il piano.

Implicazioni:
- evitare coupling del core con API specifiche di Pi
- preferire modelli dati, API e file format aperti
- progettare pensando a Pi, Claude Code, Codex e futuri adapter

### 4. La cartella del piano vive nel progetto target
Il piano deve vivere in:
- `.planner/`

### 5. Il piano deve essere discusso per fasi
Per ogni fase:
- chiarire obiettivo, scope, non-scope, dipendenze, rischi e outcome
- usare `grill-me` quando disponibile
- non richiedere subito tutti i dettagli implementativi
- dettagliare l'implementazione quando la fase viene effettivamente lavorata

### 6. Convenzioni di naming
#### Phase ID
Usare formato:
- `phase-01-auth-core`
- `phase-02-api-foundation`

#### Task name
Usare formato:
- `[phase-slug]-task-[NNN]-[short-name]`

Esempi:
- `auth-core-task-001-db-schema`
- `auth-core-task-002-login-flow`

### 7. Task status changes e motivazioni

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

### 8. Stack deciso finora
Direzione corrente:
- frontend: React + TypeScript
- backend locale: Hono su Node
- validazione: Zod
- sync live: SSE inizialmente
- architettura: platform core + adapter Pi

### 9. Comunicazione e Riferimenti
L'agente DEVE evitare di fare riferimento a feature, fasi o task utilizzando i loro UUID tecnici (es. `bd6ed366`). 
I riferimenti devono essere sempre umani, univoci e compositi, seguendo il formato:
- Feature: `F001 - Nome`
- Fase: `P001(F001) - Titolo`
- Task: `T001(P001/F001) - Titolo`

Esempio CORRETTO: "Procedo con il task T003(P001/F001) - Implementazione API"
Esempio ERRATO: "Procedo con il task bd6ed366"

### 10. Fonte dei requisiti correnti
Documenti da leggere prima di modificare architettura o processo:
- `PROJECT.md`
- `ROADMAP.md`
- `CHECKLIST.md`

### 11. Igiene Operativa (Zero Tolerance)

L'operatività dell'agente deve essere pulita e senza residui. Ogni omissione procedurale è considerata un errore di esecuzione.

#### Gestione Handoff
L'handoff è un meccanismo di passaggio di testimone, non un archivio di note.
- **Cancellazione Immediata**: l'agente DEVE cancellare `.planner/HANDOFF.md` immediatamente dopo averlo letto e processato. 
- **Divieto di Persistenza**: lasciare un file di handoff nel repository dopo l'avvio della sessione è una violazione del protocollo.

#### Disciplina degli Aggiornamenti
L'agente non deve attendere promemoria dall'utente o dall'estensione per aggiornare il piano.
- **Attivazione Proattiva**: l'agente deve avviare il task (`task_start`) PRIMA di iniziare a pensare all'implementazione.
- **Chiusura Immediata**: il task va completato (`task_complete`) NON DOPO l'invio del codice, ma COME PARTE della consegna del deliverable.
- **Motivazione Esaustiva**: ogni blocco deve essere motivato in modo che un terzo possa comprendere l'impedimento senza dover leggere l'intera cronologia della chat.

### 12. Branching & Release

Il progetto segue un flusso a due rami: **`develop`** (integrazione) e **`main`** (release).

Regole operative:
- **Branch di partenza**: ogni feature branch nasce da `develop`, **non** da `main`.
  - `git switch develop && git pull && git switch -c feature/<nome>`
- **PR verso `develop`**: il lavoro quotidiano si integra con PR **verso `develop`**. È vietato pushare direttamente su `main` o `develop` senza PR.
- **`main` è solo release**: `main` riceve modifiche **esclusivamente** via PR da `develop`. Il merge `develop → main` è l'atto di release.
- **Pubblicazione automatica**: il workflow `.github/workflows/publish.yml` pubblica su npm **solo** al merge di una PR su `main` (trigger `push: branches:[main]`). Il merge su `develop` **non** pubblica (è staging).
- **Bump versione deliberato e manuale**: il bump delle versioni dei package non è automatico. Si fa con `pnpm release:bump [-- patch|minor|major]` (gruppo core: `plan-core`, `plan-mcp`, `plan-server`, `agent-plan`) e `pnpm release:bump:adapter` (pi-adapter, cadenza indipendente), **prima** di una PR `develop → main` che si intende rilasciare.
- **Validazione CI**: `.github/workflows/ci.yml` esegue `build + check` su `develop` e su ogni PR. Il codice deve essere verde prima del merge.
- **Branch di default**: `develop` è il default branch su GitHub, quindi le nuove PR puntano a `develop`.

## Comportamento atteso dagli agenti
Quando inizi a lavorare:
1. leggi `AGENTS.md`
2. leggi `CHECKLIST.md`
3. leggi i documenti rilevanti (`PROJECT.md`, `ROADMAP.md`)
4. aggiorna la checklist prima e dopo cambi significativi
5. se cambi una decisione architetturale, documentala esplicitamente

### Avvio del planner (solo su esplicita richiesta)
- Il planner e la Web UI **non partono mai in automatico**. Non chiamare `planner-load`, non avviare la Web UI, né mostrare l'URL del web se l'utente non lo chiede.
- **Solo quando l'utente lo richiede** (`/planner load` o `/planner recap` in Pi e Claude Code/Codex; equivalente MCP `planner-load`): chiama il tool, presenta il recap consolidato (stato progetto, task in-progress, eventuale handoff pendente, URL del web) **in quella singola risposta**, e termina quella risposta con una riga prominente `🌐 Web UI: <url>`. Se il recap include un handoff pendente, sintetizzalo all'utente e poi cancellalo con `planner-handoff-clear` (o `/planner handoff clear`).
- **L'URL del web appare solo**: (a) in quella risposta di recap dopo `load`/`recap`, o (b) quando l'utente chiama `/planner web status`. **Mai** in altre risposte o ad ogni messaggio.

### Regola dettagli (task / phase / feature)
- **Scrivi appena hai punti rilevanti**: non appena emergono punti rilevanti (decisioni, vincoli, stato attuale, riferimenti file:line, edge case), scrivili nella description/notes del task, phase o feature corrispondente (`planner-task-update`, `planner-phase-update`, `planner-feature-update`). Non lasciare lavoro implicito solo nella conversazione.
- **Leggi quando inizi un task**: prima di iniziare a lavorare su un task, leggi la sua description e notes (e quelle della phase/feature genitore) con `planner-task-show` / `planner-phase-show`. Se esiste un handoff, leggilo come contesto.
- **Riferimenti umani**: cita task/phase/feature con il composito univoco (es. `#T007 · F001/P002/T003`), non con UUID nudi.

### Pre-flight Protocol (Mandatory)
Prima di iniziare qualsiasi nuova fase, nuovo task o nuova feature, l'agente deve:
1. **Dichiarare l'intento**: "Sto per [iniziare la fase X / creare il task Y / ecc.]."
2. **Specificare i mezzi**: "Per farlo, userò [strumento A, tool B, o modifica al file C]."
3. **Richiedere approvazione**: "Procedo?"

L'agente deve attendere la conferma esplicita dell'utente prima di eseguire le modifiche al piano o al codice.

### Planner Discuss Mode (Mandatory)
Quando l'utente usa i flussi `planner project/phase/task/feature discuss`, l'agente deve restare nel dominio **Agent Plan**.

Regole:
- non attivare workflow, skill o comandi GSD
- non reinterpretare `discuss` come workflow GSD
- non proporre milestone/phase orchestration GSD se l'utente sta lavorando nel planner locale
- usare solo il modello dati `.planner/`, le regole del planner e le domande utili alla discovery

## Regola finale
Se svolgi lavoro senza aggiornare la checklist, stai violando il processo del progetto.
