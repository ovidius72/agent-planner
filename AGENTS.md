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
L'integrità del piano dipende dalla sincronizzazione tra l'attività dell'agente e lo stato dei task. I lock di scrittura (edit/write) sono l'unico modo per garantire che l'agente non lavori "al di fuori" del piano.

Regole operative:
- **Sempre `task_start`**: prima di toccare una sola riga di codice, l'agente DEVE chiamare `task_start`. Non è un optional, è l'attivazione del contesto di lavoro.
- **Sempre `task_complete`**: al termine di ogni deliverable, l'agente DEVE chiamare `task_complete`. Senza questo, la dashboard e il resume rimarranno in uno stato incoerente.
- **No bypass arbitrari**: il bypass del lock deve essere l'ultima risorsa (es. fix rapidi di typo). Per ogni modifica sostanziale, l'unico modo corretto è l'attivazione del task.
- **Stato = Verità**: se un task è `in-progress`, l'agente deve effettivamente starci lavorando. Se smette, deve chiuderlo o bloccarlo.

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

### 7. Stack deciso finora
Direzione corrente:
- frontend: React + TypeScript
- backend locale: Hono su Node
- validazione: Zod
- sync live: SSE inizialmente
- architettura: platform core + adapter Pi

### 8. Comunicazione e Riferimenti
L'agente DEVE evitare di fare riferimento a feature, fasi o task utilizzando i loro UUID tecnici (es. `bd6ed366`). 
I riferimenti devono essere sempre umani, univoci e compositi, seguendo il formato:
- Feature: `F001 - Nome`
- Fase: `P001(F001) - Titolo`
- Task: `T001(P001/F001) - Titolo`

Esempio CORRETTO: "Procedo con il task T003(P001/F001) - Implementazione API"
Esempio ERRATO: "Procedo con il task bd6ed366"

### 9. Fonte dei requisiti correnti
Documenti da leggere prima di modificare architettura o processo:
- `PROJECT.md`
- `ROADMAP.md`
- `CHECKLIST.md`

## Comportamento atteso dagli agenti
Quando inizi a lavorare:
1. leggi `AGENTS.md`
2. leggi `CHECKLIST.md`
3. leggi i documenti rilevanti (`PROJECT.md`, `ROADMAP.md`)
4. aggiorna la checklist prima e dopo cambi significativi
5. se cambi una decisione architetturale, documentala esplicitamente

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
