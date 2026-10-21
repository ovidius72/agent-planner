# Agent Brain: affidabilità di Agent Plan prima delle evoluzioni

Specificazione di scope del 20 ottobre 2026, aggiornata sui problemi indicati direttamente dall'utente. Non è un piano operativo parallelo: servirà come input per una feature Agent Plan, ancora da registrare. Questo documento sostituisce, quanto a priorità e perimetro, le roadmap preparatorie precedenti.

## Obiettivo e ordine

Prima risolvere sei problemi di utilizzo di Agent Plan: orientamento fra handoff, costo del contesto, mantenimento di requisiti/regole, ritorno al lavoro interrotto, scelta del prossimo lavoro e proliferazione dei task. Poi aggiungere riferimenti strutturati al codice e un grafo interrogabile/navigabile.

Agent Plan conserva già requisiti, feature/fasi/task, decisioni, regole, dipendenze, checkpoint e handoff di fase. Non va sostituita questa struttura né creata una seconda autorità sulla conoscenza del progetto.

## Riscontri sul codice: fatti distinti dalle cause ancora da riprodurre

- **Scelta degli handoff scaricata sull'utente:** con più handoff, il recap elenca ref/data/prima riga e chiede di scegliere la fase. [recap.ts:296](/Users/antonio/projects/agent-plan/packages/plan-core/src/recap.ts:296).
- **Istruzioni contraddittorie sull'ordine delle letture:** la skill condivisa dice di leggere prima di invocare il lifecycle, mentre le descrizioni di `task_start` Pi/MCP e il contesto Pi dicono di invocarlo prima delle letture. [planner-skill.md.in:44](/Users/antonio/projects/agent-plan/plugins/_shared/planner-skill.md.in:44), [pi-adapter/index.ts:5569](/Users/antonio/projects/agent-plan/packages/pi-adapter/src/index.ts:5569), [plan-mcp/index.ts:2264](/Users/antonio/projects/agent-plan/packages/plan-mcp/src/index.ts:2264).
- **Ricostruzione separata del focus:** il recap calcola task attivi e checkpoint a parte; il selettore dispone di un proprio percorso, consapevole della sessione. [recap.ts:65](/Users/antonio/projects/agent-plan/packages/plan-core/src/recap.ts:65), [task-selection.ts:293](/Users/antonio/projects/agent-plan/packages/plan-core/src/task-selection.ts:293).
- **Continuità della fase prima della priorità globale:** il selettore prova i task pronti della fase corrente prima di confrontare le feature. È un comportamento verificato, ma la politica desiderata va fissata esplicitamente. [task-selection.ts:366](/Users/antonio/projects/agent-plan/packages/plan-core/src/task-selection.ts:366).
- **Ritorno già implementato, coperture da verificare:** esistono stack di deviazioni e checkpoint; i diversi percorsi considerano insiemi diversi di stati (`planned`/`waiting`, checkpoint `planned`, disponibilità esplicita degli stati parcheggiati). Questo indica scenari da riprodurre, non dimostra da solo la causa di tutti i ritorni mancati. [task-selection.ts:301](/Users/antonio/projects/agent-plan/packages/plan-core/src/task-selection.ts:301).
- **Costo potenzialmente ripetuto:** il contesto di avvio include descrizioni di feature/fase, requisiti e decisioni già ottenibili dalle letture complete; Pi inietta inoltre skill e guidelines nel prompt dei turni. Va misurato il percorso effettivo per ciascun harness prima di quantificare il risparmio. [task-context.ts:175](/Users/antonio/projects/agent-plan/packages/plan-core/src/task-context.ts:175), [pi-adapter/index.ts:6246](/Users/antonio/projects/agent-plan/packages/pi-adapter/src/index.ts:6246).
- **Riferimenti al codice già richiesti come testo:** la creazione del task richiede `file:line` nella descrizione, ma non dispone di un modello di link al simbolo che ne verifichi identità e validità. [plan-mcp/index.ts:1430](/Users/antonio/projects/agent-plan/packages/plan-mcp/src/index.ts:1430).

Questi riscontri sono statici. Non è stata ancora eseguita una suite di riproduzione dei sei problemi, né sono state applicate correzioni.

## R1. Orientamento utile al load, anche dopo molto tempo

**Problema:** ref e prima riga di più handoff non permettono all'utente di ricordare il significato e il punto di lavoro delle fasi.

**Comportamento richiesto:** il load offre un quadro breve del lavoro aperto: nome e obiettivo di feature/fase, punto raggiunto, lavoro residuo, motivo della sospensione quando registrato, dipendenze, priorità e prossimo passo concretamente praticabile. Propone una ripresa motivata usando lo stato attuale. La data dell'handoff non determina da sola la priorità.

Non leggere integralmente tutti gli handoff per produrre questo quadro: usare identità, metadati e contenuti pertinenti, con dettagli su richiesta. Le eventuali sintesi derivate devono avere fonti riconoscibili e restare distinguibili dai dati canonici. Gli handoff rimangono di fase.

**Verifica:** dopo una lunga pausa, con più fasi e handoff anche obsoleti, una persona comprende le alternative dal recap; la raccomandazione coincide con il motore comune o espone l'ambiguità reale con una domanda circostanziata.

## R2. Ripresa completa con costo del contesto controllato

**Problema:** handoff, feature, fase e task possono ripetere le stesse informazioni in più risposte.

**Comportamento richiesto:** una consegna coordinata del contesto necessario alla ripresa, con riferimenti e revisioni. Consegnare integralmente requisiti, regole e decisioni richiesti; evitare di ritrasmettere copie immutate ancora disponibili nel contesto effettivo. Letture condivise fra task fratelli vanno riusate solo quando valide.

Un riavvio o una compattazione può far perdere informazioni anche senza cambiare la sessione tecnica: l'attestazione persistente da sola non prova che il contenuto sia ancora presente nel contesto del modello. Prevedere rinnovo del contesto agli eventi supportati e un percorso esplicito di ripresa dove l'harness non li espone. Non attestare come letto un file soltanto perché è stato nominato o salvato su disco.

**Verifica:** misurare dimensioni/trasmissioni del percorso prima e dopo su casi uguali; controllare completezza e assenza di duplicazioni evitabili, anche dopo compattazione, cambio task e modifica delle fonti. Il budget in caratteri e la misura dei token sono cose diverse; nessuna riduzione percentuale è ancora promessa.

## R3. Requisiti, coding standards e metodo di lavoro mantenuti nel tempo

**Problema:** leggere una volta le regole non garantisce che gli agenti continuino ad applicarle.

**Comportamento richiesto:** ampliare le skill di Agent Plan con procedure comuni per orientamento/ripresa, lavoro sul task, applicazione degli standard, verifica e controllo dello scope. La fonte rimane nel prodotto, distribuita/adattata a Pi, Claude Code, Codex e altri harness supportati. Il generatore attuale già parte da una skill canonica del core: estenderlo, senza creare un'autorità separata nel plugin Claude. [sync-plugins.cjs:1](/Users/antonio/projects/agent-plan/scripts/sync-plugins.cjs:1).

Separare un protocollo operativo breve da regole canoniche complete e skill specialistiche caricate quando pertinenti. Rinnovare il contesto completo necessario al load, dopo perdita del contesto e quando cambiano le fonti; richiamare gli obblighi applicabili ai passaggi di lavoro. Risolvere le istruzioni contraddittorie fra guide, descrizioni tool e prompt iniettati. Non imporre automaticamente standard esterni al posto di quelli del progetto e non spostare regole già registrate senza una decisione esplicita.

Skill, consegna del contesto e controlli del lifecycle hanno ruoli complementari: una skill non garantisce da sola il rispetto semantico delle istruzioni; i vincoli verificabili devono essere controllati dalle operazioni di dominio. Le capacità dei diversi harness e i relativi limiti devono essere dichiarati.

**Verifica:** scenari lunghi con compattazione, ripresa, modifica dei requisiti/guidelines e cambio harness; controllo dei contenuti realmente consegnati e del comportamento sulle violazioni verificabili.

### R3.1. Applicazione verificabile delle regole esistenti prima della scrittura

**Requisito esplicito dell'utente:** prima di scrivere codice, analizzare il codice esistente, comprenderne standard e convenzioni, seguire le regole imposte. Un componente che funziona ma introduce una struttura incompatibile con il progetto non soddisfa il lavoro. Questo precisa R3 e non crea un nuovo task o uno stato di lifecycle aggiuntivo.

**Correzione dopo verifica del checkout locale:** leggere il contesto e rispettare gli standard non sono nuove capacità da aggiungere alla lista. La [skill canonica](/Users/antonio/projects/agent-plan/packages/plan-core/planner-skill.md:44) prescrive già letture prima del codice e identifica le Project Guidelines come sede degli standard. Le [regole del core](/Users/antonio/projects/agent-plan/packages/plan-core/src/planner-rules.ts:20) prescrivono già di mantenerli durante l'esecuzione. Le [guidelines del progetto Agent Plan](/Users/antonio/projects/agent-plan/.planner/project.json:6) contengono già prescrizioni concrete per componenti, tipizzazione, test e skill React. Il [flusso iniziale di discussione Pi](/Users/antonio/projects/agent-plan/packages/pi-adapter/src/index.ts:1535) chiede anche ricerca della codebase, ma non costituisce un controllo delle letture del sorgente prima di ciascuna modifica.

Il gap verificato è nei controlli: il [read tracking](/Users/antonio/projects/agent-plan/packages/plan-core/src/read-tracking.ts:28) registra task, fasi, feature e requisiti, con controllo separato delle guidelines; non registra l'analisi di implementazioni analoghe. Il [gate di completamento](/Users/antonio/projects/agent-plan/packages/plan-core/src/task-completion-gate.ts:58) controlla la checklist e l'eventuale override motivato, non la conformità architetturale del diff. Questi riscontri sono statici e non provano quale passaggio sia stato saltato in uno specifico episodio passato.

Esiste inoltre una [Accepted Decision di progetto](/Users/antonio/projects/agent-plan/.planner/project.json:174) che mantiene il guard delle scritture senza task esclusivamente informativo: nessun blocco o richiesta di permesso. Il [core](/Users/antonio/projects/agent-plan/packages/plan-core/src/guard-decision.ts:312) lo implementa; con un task in corso non emette neppure quel warning. Questo guard non è un controllo di analisi o conformità del codice. Non trasformarlo implicitamente in un blocco generalizzato: un eventuale nuovo controllo bloccante dell'analisi preliminare richiede una decisione esplicita sul suo perimetro e sulle integrazioni supportate.

**Procedura comune proposta, precedente alla prima modifica del codice:**

1. Leggere le istruzioni applicabili, le Project Guidelines, le decisioni approvate e le configurazioni pertinenti del progetto e dell'area interessata. Identificare responsabilità del modulo e punti di integrazione.
2. Cercare e leggere implementazioni esistenti realmente analoghe, le loro interfacce e i test pertinenti. La similarità funzionale o il nome del file non bastano: il precedente deve appartenere al livello architetturale e al contesto appropriati. Verificare prima che esista già una capacità da riusare.
3. Ricavare convenzioni pertinenti: organizzazione, API, composizione, gestione dello stato e degli errori, naming, dipendenze ammesse, test e verifiche. Separare regole esplicite da osservazioni sul codice. Un pattern frequente non diventa automaticamente una decisione approvata; non copiare un precedente obsoleto in conflitto con le istruzioni applicabili.
4. Registrare una breve analisi sul task esistente: fonti lette con revisioni/impronte, precedenti scelti e motivo della pertinenza, convenzioni da seguire, elementi da riusare, integrazione prevista, verifiche e punti irrisolti. Le fonti complete restano recuperabili; non copiare interi file nel task né aprire task per ciascuna lettura.
5. Procedere alla scrittura quando l'analisi necessaria è disponibile e coerente. Non aggiungere una conferma utente a ogni passaggio: seguire autonomamente regole e decisioni già autorizzate. Chiarire soltanto conflitti o scelte sostanziali non risolvibili dal contesto e dalle autorizzazioni esistenti. Se non ci sono precedenti perché il progetto è nuovo, dichiararlo e definire le convenzioni necessarie nel processo di discussione esistente, senza inventare standard imposti.

**Controlli da implementare:** estendere il protocollo comune e i controlli del lifecycle con evidenze dell'analisi, senza confondere il task attivo con l'autorizzazione a scrivere. Una ricevuta valida deve riferirsi a contenuti effettivamente consegnati e allo snapshot pertinente: un flag dichiarato dall'agente o il solo elenco dei percorsi non prova la lettura, né una lettura prova la comprensione. Riutilizzare letture ancora disponibili e valide; invalidare le parti interessate quando cambiano regole, fonti, ambito di lavoro o quando il contesto viene perso.

L'eventuale blocco delle scritture è una scelta distinta ancora da definire e richiede integrazione con gli strumenti effettivamente usati dall'harness, inclusi quelli che modificano file attraverso comandi. Un controllo in `task_start` non impedisce da solo scritture eseguite fuori dal planner. Distinguere per ogni harness il protocollo prescritto, le operazioni realmente intercettate e i controlli non disponibili; non dichiarare un blocco universale senza copertura dei percorsi di modifica né cambiare la decisione esistente sul no-task guard. Il protocollo deve essere utilizzabile anche senza un provider semantico, mediante letture dirette e ricerca nel codice.

**Verifica del risultato:** confrontare la modifica con regole e precedenti selezionati, controllando riuso, responsabilità, API, convenzioni e verifiche pertinenti. Applicare gli strumenti già previsti dal progetto per i vincoli automatizzabili; le scelte qualitative richiedono una revisione motivata. Una build verde, una checklist spuntata o una ricevuta di lettura non dimostrano da sole conformità architetturale. Non inventare soglie numeriche per termini come "slim".

**Accettazione:** un agente nuovo sviluppa un componente coerente con precedenti e regole applicabili; i percorsi coperti rendono rilevabile un tentativo di scrittura privo di analisi valida, applicando solo i blocchi eventualmente concordati; un cambio di area o una modifica delle fonti richiede il solo approfondimento necessario; un precedente legacy incompatibile viene riconosciuto; un progetto senza precedenti espone il caso; una soluzione funzionalmente corretta che duplica infrastruttura o viola una responsabilità architetturale non viene accettata dalla verifica di conformità. Per ogni scenario dichiarare quali proprietà sono controllate automaticamente e quali richiedono revisione. Il guard informativo esistente conserva la propria politica finché non viene esplicitamente modificata.

**Riferimento esterno studiato:** [WorldFlowAI/everything-claude-code](https://github.com/WorldFlowAI/everything-claude-code) separa skill, regole e hook. Le sue [skill di compattazione](https://github.com/WorldFlowAI/everything-claude-code/blob/main/skills/strategic-compact/SKILL.md) e gli [hook del lifecycle](https://github.com/WorldFlowAI/everything-claude-code/blob/main/hooks/hooks.json) sono spunti da adattare al modello Agent Plan. Non basta copiarli: gli script esaminati di [pre-compattazione](https://github.com/WorldFlowAI/everything-claude-code/blob/main/scripts/hooks/pre-compact.js), [avvio](https://github.com/WorldFlowAI/everything-claude-code/blob/main/scripts/hooks/session-start.js) e [fine sessione](https://github.com/WorldFlowAI/everything-claude-code/blob/main/scripts/hooks/session-end.js) registrano eventi, segnalano file e preparano template; non dimostrano il ripristino automatico completo delle regole del progetto. Le raccomandazioni esterne vanno filtrate rispetto a stack e processo già concordati.

## R4. Rientro affidabile nel lavoro interrotto

**Problema:** il lavoro parcheggiato può non tornare al centro dopo una deviazione.

**Comportamento richiesto:** preservare task sorgente, motivo, checkpoint, task temporaneo e obbligo di rientro. Alla conclusione del lavoro temporaneo, anche quando termina una fase, valutare il rientro prima di nuovo lavoro autonomo. Lo stack va mantenuto attraverso deviazioni annidate, riprese e recuperi espliciti della sessione.

Distinguere interruzione temporanea, attesa di una dipendenza, blocco e rinvio deliberato. Se il ritorno non è praticabile, mostrarne il motivo e conservare il punto di ripresa; non suggerire silenziosamente un task estraneo e non avviare automaticamente lavoro ancora bloccato. Preservare ownership e isolamento delle altre sessioni.

**Verifica:** A → B → C → conclusione C → ritorno B → conclusione B/fase → ritorno A; aggiungere riavvio, contesto perso, blocco persistente, dipendenza risolta e sessione concorrente.

## R5. Una sola politica spiegabile per il prossimo lavoro

**Problema:** recap, selettore e flussi di completamento possono orientare verso lavori diversi.

**Comportamento richiesto:** una valutazione nel core di task attivo, rientri, disponibilità, dipendenze, ownership e priorità. Load, raccomandazione, completamento, adapter e Web UI devono utilizzare lo stesso risultato e mostrare perché un candidato viene scelto o escluso.

La scelta esplicita dell'utente resta distinguibile dalla raccomandazione autonoma; non va trasformata in un errore soltanto perché cambia l'ordine.

**Decisione concordata con l'utente il 20 ottobre 2026:** quando non esiste lavoro attivo né un rientro pendente, prevale la priorità globale **feature → fase → task** fra il lavoro pronto e disponibile. Si seleziona prima la feature secondo priorità, poi una sua fase pronta secondo priorità, poi un task pronto della fase secondo priorità. La continuità della fase corrente non introduce una precedenza rispetto al lavoro globalmente prioritario. Dipendenze, blocchi e ownership restano vincoli di disponibilità. La politica va espressa una sola volta nel dominio condiviso e testata, includendo priorità 0, parità e genitori con stato derivato. La decisione è registrata qui come input al futuro piano; non è ancora stata creata una Accepted Decision nel planner.

**Verifica:** da uno stesso snapshot e identità della sessione, tutte le superfici mostrano lo stesso prossimo lavoro o lo stesso motivo di assenza; fine fase e task parcheggiati non perdono il rientro. Senza lavoro attivo o rientri pendenti, un task pronto in un'altra feature/fase globalmente prioritaria viene raccomandato prima di un task pronto della fase corrente con priorità globale inferiore.

## R6. Creazione dei task proporzionata al lavoro

**Problema:** gli agenti aggiungono task e frammentano il contesto più rapidamente di quanto completino il lavoro.

**Comportamento richiesto:** prima di creare, confrontare obiettivo e responsabilità con task esistenti, aperti o già completati. Un passo dell'obiettivo corrente va nella checklist o nella descrizione del task; una capacità già assegnata aggiorna il suo proprietario. Un task nuovo deve avere un risultato autonomo e un motivo per non estendere un task esistente. Un'idea fuori scope può restare nell'Ideas Inbox.

I controlli di similarità suggeriscono candidati da confrontare: il titolo simile non prova da solo una duplicazione. Non introdurre un limite numerico arbitrario né impedire la pianificazione iniziale. Se si riordina il backlog, preservare identità, dipendenze, decisioni e storia dei task; nessuna cancellazione/aggregazione automatica distruttiva.

**Verifica:** richiesta già coperta → uso del task esistente; dettaglio implementativo → checklist; obiettivo indipendente → task motivato; opportunità fuori scope → inbox. Osservare crescita e completamento come segnali, non come quota rigida.

## Evoluzioni successive

**E1. Collegamenti strutturati e verificabili al codice.** Il riferimento testuale `file:line` diventa pericoloso se viene trattato come collegamento permanente: inserimenti, spostamenti, refactor o cancellazioni possono lasciarlo puntato a codice diverso. Anche una descrizione corretta in origine può diventare obsoleta. Questo rischio è un requisito esplicito dell'evoluzione.

**Perimetro multi-linguaggio:** il codice collegato è quello del progetto che usa Agent Plan, che può essere Rust, C/C++, Java, JavaScript, TypeScript o altro. Il dominio e il formato comune devono restare indipendenti dal linguaggio; le capacità semantiche provengono da strumenti/indexer specifici, con copertura dichiarata. La prova TypeScript sul repository Agent Plan non definisce la tecnologia generale e non attesta supporto Rust/C/Java. Le prove di accettazione devono includere linguaggi differenti e progetti misti.

- La posizione in righe serve alla navigazione e va derivata dalla risoluzione attuale del riferimento; non è da sola l'identità del collegamento.
- Ogni collegamento deve distinguere la fonte storica da quella corrente: repository/worktree, revisione o snapshot del contenuto non committato, file e simbolo di destinazione quando individuabile, con evidenza per verificarne la corrispondenza. Il formato e il metodo di risoluzione restano da scegliere.
- Un collegamento a un commit permette di consultare il codice storico e la motivazione di allora, ma non dimostra che il codice corrente sia ancora lo stesso o rispetti la stessa decisione.
- Nome e percorso del simbolo aiutano la risoluzione, ma non sono immutabili: rename, spostamenti, overload e refactor possono renderla ambigua. Non associare silenziosamente una vecchia decisione al primo simbolo dal nome simile.
- Alla modifica delle fonti, rivalutare riferimenti e affermazioni dipendenti. Distinguere risoluzione corrente, contenuto cambiato da riesaminare, riferimento ambiguo e destinazione non trovata. Una destinazione ancora risolvibile non prova da sola che una descrizione o il suo "perché" siano ancora corretti.
- Preservare il contenuto approvato e la sua storia; segnalare ciò che richiede riconciliazione invece di riscrivere automaticamente una decisione per adattarla al codice.

**Verifica E1:** un inserimento di righe prima della funzione non cambia la destinazione; rename/spostamento vengono risolti o segnalati; la cancellazione non produce un link a codice estraneo; la modifica del corpo rende riesaminabili le affermazioni pertinenti; branch/worktree diversi non condividono una risoluzione non verificata. Il motivo della soluzione deriva dalla decisione/documentazione registrata; dove manca, va dichiarato o discusso, non inventato.

Il [meccanismo implementativo e la prova isolata](/Users/antonio/Documents/Codex/2026-10-20/referenced-chatgpt-conversation-this-is-an/outputs/agent-brain-code-links-design.md) specificano baseline, risoluzione, impronte, candidati di refactor e riesame separato delle descrizioni. La prova ha superato 11 casi su variazioni in memoria di una funzione reale; non costituisce un'integrazione nel prodotto.

**E2. Grafo unificato.** Proiettare relazioni già presenti nel planner e collegarle al codice. Consentire attraversamento e interrogazione, risalita da funzione a lavoro/decisioni e navigazione verso usi e dipendenze. Distinguere relazioni dichiarate, estratte e inferite; gestire l'aggiornamento rispetto al contenuto indicizzato. Il riferimento Graphify indica la capacità desiderata: la scelta fra riuso, adapter o motore dedicato non è ancora stata fatta.

AgentTest resta una proposta precedente distinta. Non viene inserito come prerequisito di questi sei interventi o del grafo senza definirne lo scope.

## Benefici da rendere visibili nella Web UI

- Load/orientamento: alternative di ripresa comprensibili, punto di lavoro e raccomandazione motivata.
- Focus: task attuale, deviazione in corso e catena di rientro visibili.
- Prossimo lavoro: motivazione della scelta e ragioni dei blocchi, coerenti con gli strumenti degli agenti.
- Contesto: visibilità di requisiti, guidelines e skill applicabili, con stato di aggiornamento/consegna senza simulare una misura della comprensione dell'agente.
- Backlog: responsabilità già assegnate, possibili sovrapposizioni e passo corrente da completare.
- Dopo E1/E2: navigazione fra entità del planner, funzioni, utilizzi e decisioni, mantenendo le viste gerarchiche esistenti.

## Sequenza e tracciamento

Prima riprodurre i sei scenari e verificare la politica globale di selezione concordata; poi unificare selezione/rientri e recap; rendere coerenti consegna del contesto e skill comuni; correggere disciplina dei task e parità delle superfici. Verificare il flusso completo anche su sessioni lunghe. Solo dopo procedere con E1/E2.

Il futuro piano deve usare una feature Agent Plan e fasi con task legati a risultati verificabili; i dettagli implementativi sono checklist, non una conversione automatica di ogni punto di questo documento in un task nuovo.

Stato: scope e riscontri statici documentati. Nessun worktree/branch o entità planner creato; nessuna modifica al codice, installazione, build o suite di test eseguita in questo passaggio.
