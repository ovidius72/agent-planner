# Collegamenti al codice: meccanismo implementativo proposto

20 ottobre 2026. Proposta concreta per E1/E2, successiva ai sei interventi di affidabilità già concordati. Non introduce nuove entità planner di lavoro: task, requisiti, decisioni e handoff mantengono il modello e i proprietari attuali. I moduli e le operazioni qui nominati sono proposti, non già presenti nel prodotto.

**Chiarimento di perimetro:** si analizza il codice del progetto che usa Agent Plan, qualunque sia il suo linguaggio, non necessariamente il sorgente TypeScript di Agent Plan. Il precedente esperimento TypeScript è una prova locale limitata e non stabilisce la tecnologia universale del prodotto. Il contratto comune deve essere verificato su progetti e strumenti di linguaggi diversi.

## Setup del progetto e attivazione degli strumenti

Questo è un flusso proposto da implementare. Nel checkout attuale `agent-plan setup <harness>` configura l'integrazione con l'agente e `init` inizializza `.planner/`; questi comandi non costituiscono già un installer multi-linguaggio per l'analisi del codice. [CLI attuale](/Users/antonio/projects/agent-plan/packages/agent-plan/src/index.ts:42).

### 1. Collegare l'agente, poi discutere il progetto

L'integrazione con l'harness rende disponibili tool e skill del planner. Nella discussione l'agente raccoglie idea, obiettivi, requisiti, stack concordato, regole e modalità di lavoro, usando le entità esistenti. Su un repository esistente legge anche manifest e configurazioni; il rilevamento non deve decidere o modificare da solo lo stack. Un planner già presente viene riusato.

**Caso iniziale: cartella vuota.** La discussione precede spesso la creazione del progetto. In quel momento non ci sono manifest, sorgenti o estensioni da cui ricavare un linguaggio: il setup parte dalle esigenze dell'utente e dalla scelta dello stack, non dal rilevamento. Il linguaggio in cui è scritto Agent Plan o l'ambiente dell'agente non costituiscono una scelta dello stack del progetto.

L'agente chiarisce obiettivi, piattaforma e vincoli, discute le alternative pertinenti e registra lo stack concordato nelle informazioni di progetto esistenti (`technologies`/`tools`), con una Accepted Decision di progetto per la scelta e la sua motivazione quando definite. Se la scelta non è stata fatta, resta esplicitamente da definire; il planner può continuare la discussione senza un provider del codice.

Una volta concordato lo stack si può costruire il piano dei provider e, se richiesto, preparare gli strumenti anche prima che esistano sorgenti. L'analisi semantica effettiva rimane in attesa dello scaffold e della configurazione necessari. La scelta di Rust non implica di per sé un download immediato né rende analizzabile una cartella vuota.

La sequenza concettuale è: **idea e requisiti → stack da definire/concordato → preparazione degli strumenti necessari → scaffold disponibile → verifica della configurazione → analisi attiva**. Sono condizioni del setup, non nuove fasi o task da creare automaticamente nel planner. Dopo lo scaffold il rilevamento confronta il progetto reale con lo stack concordato: una divergenza va chiarita o registrata come decisione, non risolta sovrascrivendo silenziosamente la scelta.

### 2. Scegliere le capacità, non i nomi dei prodotti

L'agente propone una configurazione comprensibile: solo planner, struttura/navigazione del codice, oppure anche riferimenti e analisi delle dipendenze. La scelta tecnica è risolta dal prodotto in base al progetto e alla disponibilità dei provider; l'utente può modificare le opzioni avanzate.

Non installare contemporaneamente Tree-sitter, un server LSP e tutti gli indexer SCIP per principio. Le capacità possono essere fornite da uno stesso strumento o da sorgenti alternative. La prima attivazione dell'analisi può autorizzare un piano concreto di preparazione e download; i load successivi riusano la configurazione e gli strumenti disponibili. La politica su eventuali nuovi strumenti/aggiornamenti va dichiarata nel setup.

### 3. Ispezione e piano di preparazione deterministici

Un servizio comune di setup dovrebbe:

1. Leggere prima lo stack concordato nel progetto. Quando esistono sorgenti/manifest, rilevare anche root, linguaggi e configurazioni effettivi, inclusi repository misti, e confrontarli con quanto deciso. In una cartella vuota conservare lo stato da definire o pianificato, senza inventare un rilevamento.
2. Verificare strumenti configurati o disponibili, provenienza, versione, avviabilità e compatibilità. La presenza di un'estensione nell'IDE non garantisce che il suo eseguibile sia accessibile ad Agent Plan.
3. Risolvere le capacità richieste contro un catalogo versionato di provider supportati. Ogni voce definisce linguaggi, funzionalità, piattaforme, modalità di avvio/import, dipendenze e procedure di installazione/diagnostica collaudate.
4. Produrre un piano concreto con riuso, componenti mancanti, configurazione richiesta e capacità che resteranno indisponibili.

L'agente spiega e invoca questo piano. Il modello non deve inventare ogni volta comandi di installazione o scegliere un pacchetto dal nome simile.

### 4. Che cosa si installa davvero

| Componente | Strategia di distribuzione proposta |
|---|---|
| Client LSP, lettore degli indici e modello comune | Parti del modulo di analisi di Agent Plan |
| Tree-sitter, se usato | Libreria dell'applicazione con grammatiche compatibili; distribuite col modulo/provider o scaricate in modo gestito. Non richiede l'aggiunta di dipendenze all'applicazione dell'utente |
| Server del linguaggio, come `rust-analyzer` o `clangd` | Riusare un eseguibile compatibile configurato/disponibile; in alternativa preparare una copia gestita da Agent Plan dove supportato |
| Indexer che produce SCIP | Attivare solo quello pertinente quando serve un indice persistente e la capacità è supportata; riusare lo stesso eseguibile se fornisce anche altri servizi |
| CLI generica `scip` | Opzionale per operazioni specifiche sugli indici; non è il compilatore universale da installare per ogni progetto |
| Toolchain del progetto, JDK, Cargo o contesto di compilazione | Prerequisiti distinti da rilevare e configurare secondo il progetto; non sostituirli implicitamente con versioni scelte dal planner |

Precisazioni: [LSP](https://microsoft.github.io/language-server-protocol/) è un protocollo fra client e server; [SCIP](https://github.com/scip-code/scip) è un formato/protocollo per indici con indexer specifici; i [binding Tree-sitter](https://tree-sitter.github.io/node-tree-sitter/) richiedono una grammatica del linguaggio. L'interfaccia utente deve spiegare la capacità attivata, evitando di presentare tre installazioni universali equivalenti.

I componenti gestiti vanno conservati in una directory dati/cache dell'applicazione configurabile, con versioni e artefatti identificabili e riuso fra progetti compatibili. Configurazione desiderata e versioni richieste possono essere condivise nel progetto; percorsi assoluti e risoluzione effettiva degli eseguibili rimangono locali. Cache e indici dipendono dal checkout. Questa preparazione non deve aggiungere librerie di analisi al `Cargo.toml`, `pom.xml` o `package.json` dell'applicazione analizzata.

### 5. Controllare la configurazione prima di dichiarare pronta l'analisi

Avviare il provider o eseguire l'indexer non basta. Il setup deve controllare root, configurazione, copertura e un risultato minimo coerente: una definizione nota risolta al sorgente dello snapshot e riferimenti interrogabili quando previsti. Per C/C++ possono mancare i comandi di compilazione; per Rust dipendenze/configurazioni e sorgenti della libreria standard possono influire sull'analisi. Fonti: [setup clangd](https://clangd.llvm.org/installation#project-setup), [installazione rust-analyzer](https://rust-analyzer.github.io/book/installation.html).

La UI deve distinguere pronto, indicizzazione in corso, configurazione incompleta, strumento mancante e indice da aggiornare. Il planner continua a funzionare se una capacità sul codice non è pronta. Lo stato non può diventare «nessun utilizzo» quando la ricerca non è stata eseguita.

### 6. Uso ordinario e nuovi agenti

I successivi agenti caricano lo stesso profilo del progetto attraverso i tool comuni, riusano gli strumenti compatibili e consultano l'indice corrente. Non ripetono il setup né lo ricostruiscono dalla chat. Cambi di stack, root o configurazione richiedono una rivalutazione; il trasferimento su un'altra macchina riusa la configurazione desiderata e risolve nuovamente i componenti locali.

Un esempio di dialogo di attivazione, non un risultato verificato sul sistema dell'utente: «Il progetto è Rust. Il piano è pronto. Per aggiungere navigazione e riferimenti userò il provider Rust; riuserò gli strumenti compatibili presenti e mostrerò eventuali componenti mancanti. L'indice persistente verrà preparato quando il workspace è analizzabile». L'utente sceglie la capacità; Agent Plan gestisce il percorso tecnico e ne espone l'esito.

## Tre oggetti separati

**1. Collegamento canonico (`CodeLink`).** Collega un'entità già esistente del planner a una destinazione del codice, con un proprio ID e il tipo di relazione. Il proprietario usa l'identità canonica, non il titolo o il numero di riga. Per una decisione si conservano anche ID e proprietario della decisione. Il testo della decisione non viene duplicato nel link.

**2. Destinazione e baseline (`CodeAnchor`).** Conserva identità del repository, riferimento iniziale al simbolo, revisione osservata, impronte e prova storica della destinazione scelta. Un UUID permette al planner di nominare il collegamento durante la sua storia, ma non dimostra che una funzione rinominata sia ancora lo stesso oggetto logico.

**3. Risoluzione di uno snapshot (`AnchorResolution`).** È un risultato derivato: in questo checkout e su questi contenuti, il simbolo è stato ritrovato qui, è cambiato oppure resta ambiguo/non trovato. Contiene le righe correnti per la navigazione. Non riscrive automaticamente il collegamento canonico.

Esempio concettuale, con valori dimostrativi:

```json
{
  "id": "link-id",
  "owner": { "kind": "task", "entityId": "task-uuid" },
  "relation": "implements",
  "anchorId": "anchor-id",
  "baseline": {
    "snapshotId": "content-manifest-hash",
    "path": "packages/plan-core/src/plan-store.ts",
    "symbol": "PlanStore.claimTask",
    "kind": "method",
    "declarationHash": "hash",
    "contextHash": "hash"
  }
}
```

`snapshotId` identifica un manifesto di contenuti e configurazione; il nome del branch o il commit da soli non identificano modifiche locali non committate. Nomi, percorsi e hash sono indizi e dati di verifica, non identità eterne del codice.

## Creazione del collegamento

1. L'agente cerca simboli nell'indice, riceve i candidati e ne legge il codice alla revisione indicata.
2. Seleziona esplicitamente il simbolo pertinente e la relazione col task/requisito/decisione. La scoperta di un nome nella prosa non basta a creare automaticamente un link autorevole.
3. L'operazione canonica verifica che proprietario e simbolo esistano nello snapshot dichiarato; se i contenuti sono cambiati dopo la selezione, rifiuta la scrittura come obsoleta.
4. Salva link, baseline e provenienza. Per la storia si usa il contenuto Git disponibile; per baseline non committate va acquisita una prova immutabile del sorgente necessario, deduplicata per contenuto. Un hash senza il contenuto recuperabile non basta per mostrare il passato.
5. La UI e i tool usano l'ID del link. Le righe vengono ottenute dal resolver corrente, non copiate nella descrizione come unica destinazione.

I riferimenti `file:line` legacy possono diventare candidati di migrazione marcati non verificati. Nessuna attribuzione automatica di decisioni a un simbolo ricostruita soltanto da testo o vicinanza di righe.

## Indice comune e motori per linguaggi diversi

Il linguaggio in cui è scritto Agent Plan non determina il linguaggio dei progetti analizzati. Un processo Node/TypeScript può invocare strumenti Rust, C o Java e leggere i loro risultati; il compilatore TypeScript da solo non analizza Rust, C o Java.

La direzione proposta è un nucleo indipendente dal linguaggio, con importazione di indici semantici e interrogazione di motori specializzati. Si tratta di una proposta architetturale, non di un'integrazione già eseguita.

| Linguaggio del progetto | Esempi di strumenti da integrare | Contesto da rispettare |
|---|---|---|
| Rust | `rust-analyzer`, tramite servizi semantici e/o esportazione SCIP | Workspace Cargo, feature, target, configurazioni e macro |
| C/C++ | `clangd` per servizi semantici; `scip-clang` per indici | Comandi di compilazione, include, define e target |
| Java | Eclipse JDT Language Server per servizi semantici; indexer Java compatibile SCIP | Moduli, classpath e configurazione del progetto |
| JavaScript/TypeScript | Servizi TypeScript e/o `scip-typescript` | Workspace, configurazioni, risoluzione moduli e dipendenze |
| Altri linguaggi | Provider con contratto comune e capacità dichiarate | Configurazione effettiva dello strumento del linguaggio |

I motori citati sono esempi verificati nelle rispettive fonti, non dipendenze installate o supporti già dichiarati da Agent Plan. Riferimenti: [rust-analyzer](https://rust-analyzer.github.io/book/features.html), [clangd](https://clangd.llvm.org/features), [JDT LS](https://github.com/eclipse-jdtls/eclipse.jdt.ls), [indexer SCIP disponibili](https://github.com/scip-code/scip#tools-using-scip).

### Indice persistente: importazione SCIP

[SCIP](https://github.com/scip-code/scip) è un formato indipendente dal linguaggio per rappresentare simboli, occorrenze e relazioni utili alla navigazione. La proposta è valutarlo come ingresso comune per evitare di implementare un indicizzatore semantico completo per ogni linguaggio. L'indexer resta specifico del linguaggio e deve produrre dati compatibili col checkout/configurazione osservati.

Agent Brain deve importare quei dati, normalizzarli, associarli allo snapshot del progetto e aggiungere relazioni verso gli ID canonici di task, requisiti e decisioni. Un formato comune non garantisce medesima copertura, aggiornamento incrementale universale o identità stabile dopo ogni refactor.

### Codice corrente: servizi LSP

Il [Language Server Protocol](https://microsoft.github.io/language-server-protocol/) permette di dialogare con server specializzati. L'adapter può chiedere definizioni, simboli, riferimenti e altre funzionalità effettivamente supportate dal server. LSP è il protocollo, non il motore che comprende tutti i linguaggi. Né garantisce un ID persistente dei simboli valido fra tutte le revisioni.

Queste interrogazioni possono servire ad aggiornare o verificare le posizioni correnti, comprese modifiche non committate quando gestite dal server/client. Devono restare associate al documento/configurazione realmente analizzati. L'integrazione LSP non sostituisce il controllo dello snapshot e della baseline già descritto.

### Struttura sintattica: parser multi-linguaggio

[Tree-sitter](https://tree-sitter.github.io/tree-sitter/) dispone di grammatiche per diversi linguaggi e può fornire struttura sintattica e analisi incrementale. È una possibile sorgente per dichiarazioni, contenimento e impronte quando serve un livello strutturale. Il solo parsing non dimostra quale implementazione venga chiamata, quali riferimenti attraversino moduli o come un macro/trait risolva un caso concreto.

Un fallback sintattico deve quindi dichiarare la copertura ridotta: non può presentare ricerche di nomi o chiamate sintattiche come riferimenti semanticamente risolti. Anche la disponibilità di una grammatica è da verificare per il linguaggio/versione.

### Contratto e capacità del provider

Tutti i provider devono esporre origine, versione, root, configurazione, snapshot, simboli/occorrenze e capacità disponibili: sintassi, definizioni, riferimenti, implementazioni, chiamate risolte. Ogni risultato distingue dati prodotti, relazioni irrisolte e limiti di copertura. Occorre normalizzare range ed encoding senza assumere che tutti gli strumenti usino le stesse coordinate.

Per un progetto misto Rust + JavaScript si usano provider distinti sulle rispettive parti e si uniscono i risultati nel modello comune. Relazioni attraverso FFI, JNI, rete o codice generato non compaiono automaticamente perché i grafi sono nello stesso archivio: servono prove e integrazioni specifiche o collegamenti dichiarati/inferiti chiaramente distinti.

Il primo contratto va verificato almeno con provider di linguaggi differenti, includendo Rust, prima di chiamarlo indipendente dal linguaggio. Ogni linguaggio dichiarato supportato richiede fixture proprie di riferimenti, spostamenti, cancellazioni e contesto di build; gli 11 casi TypeScript non validano altri provider.

## Esempio concreto su un progetto Rust

1. L'utente lavora nel progetto Rust che contiene la propria `.planner/` e collega un task a una funzione Rust selezionata.
2. Agent Brain individua la root Cargo e usa il provider Rust configurato. Gli usi e le implementazioni vengono chiesti al motore Rust o importati dal suo indice; non passano dal compilatore TypeScript.
3. La destinazione Rust e i riferimenti noti entrano nel modello comune con provenienza, configurazione e snapshot. Il link verso il task/decisione è gestito dal dominio Agent Plan.
4. Se cambiano funzione, configurazione Cargo o dipendenze pertinenti, il provider Rust aggiorna/verifica i risultati; il resolver comune applica gli stati di validità e riesame.
5. Se il provider non è disponibile o l'indice è incompleto, Agent Plan continua a funzionare come planner. Le capacità semantiche mancanti sono visibili: nessuna corrispondenza trovata non equivale automaticamente a nessun utilizzo esistente.

La stessa procedura usa strumenti diversi in C o Java. Occorre gestire alias, configurazione, import e mapping fra dichiarazioni distribuite e sorgenti. Un riferimento statico non prova ogni chiamata possibile a runtime.

## Algoritmo di risoluzione

**Passo 0 — validare l'indice.** Verificare repository/worktree, configurazione del provider e hash delle fonti necessarie. Un indice vecchio non può produrre un link presentato come corrente. Per la prima versione il refresh può essere su richiesta: il watcher è un'ottimizzazione successiva, non l'autorità sulla freschezza.

**Passo 1 — corrispondenza dichiarativa.** Cercare la dichiarazione con modulo/contenitore, tipo di simbolo, nome e firma coerenti con la baseline. Se è unica si può fornire la posizione corrente, ma modifiche di firma/corpo/contesto devono restare visibili. Il riuso di un nome dopo una riscrittura non certifica continuità dell'intento.

**Passo 2 — rilevamento delle modifiche.** Confrontare impronte della dichiarazione e del contesto pertinente: import/binding, configurazione e dipendenze conosciute. La normalizzazione deve essere sintattica e preservare valori e operatori. Commenti/documentazione hanno una revisione separata; ignorare il whitespace per localizzare un simbolo non autorizza a ignorare una motivazione cambiata in un commento.

**Passo 3 — ricerca dei candidati spostati/rinominati.** Se la corrispondenza precedente manca, cercare candidati attraverso impronte strutturali, firma, contenitore, riferimenti e informazioni Git. La [rilevazione dei rename di Git](https://git-scm.com/docs/git-diff) è basata sulla similarità: è un indizio, non la prova che una decisione vada trasferita al nuovo codice.

**Passo 4 — conferma della continuità.** Una rinomina/spostamento esterno produce un candidato da confermare; più candidati restano ambigui. Per un refactor eseguito tramite un flusso controllato si può registrare la mappatura prima/dopo e verificarla sullo snapshot risultante. Il riesame del significato resta distinto dall'accettazione della nuova posizione. Una conferma usa il fingerprint atteso, quindi non può approvare silenziosamente codice modificato nel frattempo.

**Passo 5 — destinazione assente o indice incompleto.** Se il provider ha copertura sufficiente e non trova la destinazione, segnalare assenza preservando la baseline. Errori di parsing, linguaggio non supportato o indicizzazione incompleta producono stato sconosciuto, non una falsa cancellazione.

## Due assi distinti per la UI e per gli agenti

| Localizzazione del riferimento | Riesame del contenuto |
|---|---|
| Risolto sullo snapshot corrente | Nessun cambiamento rilevato nelle fonti dichiarate dell'ultima revisione |
| Candidato di spostamento/rinomina | Nuova corrispondenza da confermare |
| Ambiguo | Nessuna associazione corrente affidabile |
| Non trovato | Baseline storica consultabile, destinazione corrente assente |
| Sconosciuto/indice obsoleto | Verifica non eseguibile o ancora da aggiornare |

La prima riga non equivale a «spiegazione certamente corretta». Dimostra soltanto che non sono cambiate le fonti controllate rispetto a una revisione registrata. Dipendenze mancanti dal grafo, configurazione esterna e comportamento dinamico limitano tale conclusione.

## Come trattare una descrizione diventata obsoleta

Non esiste un controllo universale capace di dimostrare che una spiegazione in linguaggio naturale sia ancora vera dopo qualsiasi modifica. Si può invece rendere esplicito e verificabile il processo:

1. Collegare il testo pertinente — descrizione del task, decisione, documento — alle fonti che lo sostengono e alla sua revisione.
2. Quando cambia una fonte collegata o una dipendenza pertinente, marcare quel collegamento come da riesaminare. Una prima versione può invalidare conservativamente un ambito più ampio, indicando il motivo; la precisione si migliora con casi reali.
3. Presentare all'agente vecchia baseline, diff, sorgente attuale e decisione originale. Il riesame deve dire cosa resta vero e cosa è cambiato.
4. Se l'affermazione è verificabile automaticamente, aggiungere/usare un controllo pertinente. Esempi: contratto dell'API, presenza di un export, comportamento di ownership. Un hash invariato e un test verde non dimostrano ogni motivazione architetturale.
5. Registrare il riesame esplicito con autore, ambito, prove, revisione del testo e fingerprint delle fonti. Se una di queste cambia, il riesame non vale automaticamente per il nuovo stato.
6. Aggiornare una descrizione fattuale attraverso il suo proprietario; cambiare una decisione approvata segue invece il processo delle Accepted Decisions. Non riscrivere una decisione per farla coincidere con un'implementazione che se ne è allontanata.

Se una frase non ha fonti o controlli collegati, dichiarare che la sua attualità non è verificata. Nessuna pulizia automatica del testo o produzione automatica di task per ogni invalidazione: i punti da riesaminare vengono raccolti nel lavoro pertinente.

## Integrazione concreta nel monorepo

| Responsabilità | Punto proposto |
|---|---|
| Schemi e operazioni di link/revisione, validazione dei proprietari, compatibilità | `plan-core`, accanto a `schema.ts` e alle operazioni di `PlanStore` |
| Link approvati e baseline recuperabili | Documenti canonici sotto `.planner/`, con identità proprie e mutazioni granulari |
| Indice dello snapshot e risoluzioni correnti | Cache ricostruibile sotto `.planner/.local/`, distinta per checkout/configurazione |
| Analisi del codice del progetto utente | Provider per linguaggio e importazione di indici comuni, separati dagli adapter degli agenti; nessuna dipendenza del dominio del piano dal compilatore TypeScript |
| Letture e mutazioni degli agenti | Operazioni condivise esposte da MCP/Pi: ricerca simboli, creazione link, risoluzione, elenco impatti e registrazione riesame; nomi definitivi da scegliere |
| Web UI | Apertura delle posizioni risolte, baseline/diff, badge distinti di localizzazione e riesame, conferma dei candidati |

Al completamento di una modifica si rivalutano i link impattati, si raccolgono eventuali riesami necessari e si registra l'evidenza prevista dalla politica concordata. Il comportamento non dipende dalla Web UI aperta. Il frontend riceve lo stesso stato del resolver usato dagli agenti.

## Prova isolata eseguita

Ho eseguito una prova su `PlanStore.claimTask` del checkout locale, analizzando sorgenti con TypeScript 5.9.3. Le variazioni sono trasformazioni in memoria del sorgente, non modifiche al repository. Il compilatore ha risolto otto chiamate dirette verso funzioni/metodi del progetto; fra queste `PlanStore.loadAllPhases`.

| Caso | Risultato osservato |
|---|---|
| Sorgente invariato | Destinazione risolta |
| Inserimento di 80 righe all'inizio | Stessa dichiarazione, posizione aggiornata da 3502 a 3582 |
| Modifica del corpo di `claimTask` | Destinazione risolta, cambiamento rilevato, riesame richiesto |
| Rinomina esterna del metodo | Candidato da confermare, nessun trasferimento automatico |
| Spostamento esterno del file | Candidato da confermare |
| Due possibili destinazioni equivalenti | Ambiguità mantenuta |
| Cancellazione del metodo | Non trovato, nessun link a codice estraneo |
| Sorgente non analizzabile | Stato sconosciuto, nessuna falsa dichiarazione di cancellazione |
| Modifica a `loadAllPhases`, con `claimTask` invariata | Cambiamento della dipendenza rilevato, riesame richiesto |
| Indice costruito sul vecchio contenuto | Indice rifiutato come obsoleto |
| Indice di un altro worktree | Riutilizzo rifiutato |

**Esito: 11/11 casi della prova superati.** Questo non è un risultato della suite di Agent Plan né un'implementazione pronta del prodotto. La prova copre metodi di classe/funzioni, candidati sintattici e dipendenze dirette risolte dal compilatore. Non copre migrazioni, conferma persistente dei refactor, grafo transitivo completo, altri linguaggi, semantica delle descrizioni o interfacce MCP/Pi/UI. Le impronte della prova escludono trivia; la versione di prodotto deve trattare separatamente commenti/documentazione e configurazione.

Sono disponibili la [prova eseguibile](/Users/antonio/Documents/Codex/2026-10-20/referenced-chatgpt-conversation-this-is-an/outputs/code-anchor-proof.mjs) e i [risultati osservati](/Users/antonio/Documents/Codex/2026-10-20/referenced-chatgpt-conversation-this-is-an/outputs/code-anchor-proof-results.json). L'eseguibile usa il TypeScript già installato nel repository indicato, legge i sorgenti e salva i risultati accanto allo script. Accetta il percorso del repository come primo argomento; il default è il checkout locale ispezionato. I fixture sono variazioni in memoria e non vengono scritti nel repository.

Prima dell'integrazione servono test su progetti multipli, overload, import alias, copia di codice, sostituzione di un simbolo omonimo, modifiche dei binding/configurazione, dipendenze transitive e cambiamenti durante il riesame. Un indice completo o un UUID non devono essere presentati come soluzione generale all'identità semantica del codice.
