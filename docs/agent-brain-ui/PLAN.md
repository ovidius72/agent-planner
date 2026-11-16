# Piano per il nuovo design system `agent‑brain‑web‑ui`

> **Obiettivo**: introdurre un pacchetto UI indipendente (`@agent‑plan/agent‑brain‑web‑ui`) che implementi il design system definito da *tokens.json* e da *components.md*.  Il pacchetto deve coesistere con l’attuale `plan‑web‑ui` senza modificarlo.

---

## ✅ Checklist delle attività

| # | Attività | Descrizione | Stato |
|---|----------|-------------|------|
| 1 | **Creare worktree & package** | `git switch -c feat/agent‑brain‑ds`; `pnpm init -w packages/agent‑brain‑web‑ui`; aggiungere il package a `pnpm-workspace.yaml`. | ☐ |
| 2 | **Scaffold di configurazione** | Aggiungere `vite.config.ts`, `tsconfig.json`, `postcss.config.cjs`, `tailwind.config.cjs` (placeholder). | ☐ |
| 3 | **Script di generazione del tema** | `scripts/generate‑tailwind‑theme.ts` legge `docs/agent‑brain‑ui/mockup/ds/agent‑plan/tokens.json` e scrive il file Tailwind con le estensioni dei token. | ☐ |
| 4 | **Implementare gli **atoms**** | Creare componenti React in `src/components/ui/` per: `Button`, `Icon`, `IconButton`, `StatusBadge`, `Pill`, `EntityTag`, `ShortId`, `VendorIcon`, `Meter`, `Input`, `Textarea`, `Select`, `Switch`, `ToggleChip`, `Scrim`. Ogni atom deve supportare le props descritte nella sezione *Proposta di API* e utilizzare le classi Tailwind basate sui token. | ☐ |
| 5 | **Implementare le **molecules**** | Creare componenti in `src/components/ui/` per: `AgentChip`, `IDBreadcrumb`, `SegmentedControl`, `FacetedSearchField`, `StatTile`, `SectionHeader`, `NavItem`, `NavGroup`, `FormField`, `RestorePointRow`, `CheckItem`, `ContextCostRow`, `Modal` (Radix‑candidate), `DropdownMenu` (Radix‑candidate), `Toast`, `DataTable`, `TreeRow`, `FocusCard`, `Inspector`, `Charts`, `ExportMenu`, `CodeEditorView`, `ConflictBanner`, `MapCanvas`, `EmptyState`. | ☐ |
| 6 | **Creare layout di base (`AppShell`)** | Combina `Sidebar`, `AppHeader`, `TopStrip`; gestire stato globale (tema, sidebar collapsed, drawer). | ☐ |
| 7 | **Migrare le pagine principali** | Implementare le pagine in `src/pages/` (Planner, Agents, TaskDetail, Settings, ecc.) usando gli organismi creati. | ☐ |
| 8 | **Testing** | Scrivere unit‑test per tutti gli atoms e molecules con Jest + React Testing Library; configurare Storybook per visualizzare la libreria. | ☐ |
| 9 | **CI / CD** | Aggiornare `.github/workflows/ci.yml` per includere il nuovo package (build, lint, test). Aggiungere step di pubblicazione (`pnpm release`) per il pacchetto. | ☐ |
|10| **Documentazione** | Aggiornare `docs/agent‑brain‑ui/README.md` con istruzioni di build, dipendenze, utilizzo dei componenti; generare `tokens.md` a partire da `tokens.json`. | ☐ |
|11| **Release** | Eseguire `pnpm release` da `develop` creando `release/vX.Y.Z` che pubblica `@agent‑plan/agent‑brain‑web‑ui` su npm. | ☐ |

---

## 📄 Descrizione dettagliata delle prime fasi

1. **Worktree & package**
   - Creare il branch `feat/agent‑brain‑ds` a partire da `develop`.
   - Inizializzare il package con `name: "@agent‑plan/agent‑brain‑web‑ui"`, `private: false`, `main: "dist/index.js"`.
   - Aggiornare `pnpm-workspace.yaml` aggiungendo la path `packages/agent‑brain‑web‑ui`.

2. **Scaffold di configurazione**
   - `vite.config.ts` con plugin React (`@vitejs/plugin-react`).
   - `tsconfig.json` che estende il root (`../tsconfig.base.json`).
   - `postcss.config.cjs` → `require('tailwindcss'), require('autoprefixer')`.
   - `tailwind.config.cjs` verrà sovrascritto dallo script di generazione (passo 3).

3. **Script di generazione del tema**
   - Legge `tokens.json` e costruisce l’oggetto `theme.extend` con: `colors`, `spacing`, `borderRadius`, `boxShadow`, `fontFamily`, `fontSize`, `backdropBlur`.
   - Salva il risultato in `packages/agent‑brain‑web‑ui/tailwind.config.cjs`.
   - Questo script sarà eseguibile con `pnpm run generate:theme`.

4. **Atoms**
   - Tutti gli atoms devono esportare sia il componente che il relativo **type** (`ButtonProps`, ecc.) per l’autocomplete.
   - Un file `index.ts` ri‑esporterà tutti gli atoms per un import globale (`import { Button, Icon } from '@agent‑plan/agent‑brain‑web‑ui'`).
   - I componenti dovranno includere `className?: string` per permettere ulteriori customizzazioni.

5. **Molecules**
   - Le molecules combinano gli atoms usando le stesse convenzioni di naming (`AgentChipProps`, `FacetedSearchFieldProps`).
   - Ogni molecule avrà un **story** in `src/stories/` per il test visivo.
   - Alcune molecules (Modal, DropdownMenu) saranno marcate con commenti `// Radix candidate` per decisione futura.

---

### 📌 Note operative
- **Non toccare** la cartella `packages/plan-web-ui`; rimane intatta per la UI legacy.
- **Commit granulari**: ogni task della checklist dovrebbe generare un commit con messaggio tipo `feat(agent‑brain‑web‑ui): implement Button atom`.
- **Pre‑flight**: prima di ogni commit grande, aprire una PR verso `develop` per revisione.
- **Versionamento**: il pacchetto avrà la stessa versione di `@agent-plan/core` (es. `0.1.0` iniziale) e seguirà il ciclo di release standard (`pnpm release`).

---

### 📌 Come usare la checklist
- Apri il file in VSCode, spunta le caselle (`[x]`) quando l’attività è completata.
- Il CI controlla che non rimangano checkbox non spuntate al `merge` della PR di release.

---

> **Fine del piano** – Aggiorna questo documento man mano che le attività vengono completate.
