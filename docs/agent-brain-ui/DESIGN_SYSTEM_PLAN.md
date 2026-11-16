# Design System – Agent Brain UI

## Obiettivo
Creare un nuovo package **`@agent-plan/agent-brain-web-ui`** che implementi il design system definito da `tokens.json` e da `components.md`. Il pacchetto sarà indipendente da `plan-web-ui` e sarà il nuovo stack UI per il progetto.

## Checklist delle attività

| # | Attività | Descrizione | Stato |
|---|----------|--------------|------|
| 1 | **Setup worktree & package** | Creare branch `feat/agent-brain-ds`, aggiungere nuovo package `agent-brain-web-ui` al workspace. | ☐ |
| 2 | **Generare Tailwind theme** | Script `scripts/generate-tailwind-theme.ts` che converte `tokens.json` in `tailwind.config.cjs`. | ☐ |
| 3 | **Implementare Atom – Button** | Componenti con varianti, size, icon, loading, disabled. Test unitario. | ☐ |
| 4 | **Implementare Atom – Icon** | Wrapper su `lucide-react` con size e className. | ☐ |
| 5 | **Implementare Atom – IconButton** | Icon + aria‑label, stato attivo/disabilitato. | ☐ |
| 6 | **Implementare Atom – StatusBadge** | Mappa `status` → token colore, opzioni label. | ☐ |
| 7 | **Implementare Atom – Pill, Dot, EntityTag, ShortId, VendorIcon, Meter** | Componenti di base, tutti basati su token. | ☐ |
| 8 | **Implementare Atom – Input / Textarea / Select / Switch / ToggleChip / Scrim** | Controlli form con classi Tailwind e supporto Radix (opzionale). | ☐ |
| 9 | **Implementare Molecule – AgentChip** | Combina VendorIcon, Pill, ShortId; usa surface‑strong. | ☐ |
|10| **Implementare Molecule – IDBreadcrumb** | Breadcrumb con navigazione, copia ID. | ☐ |
|11| **Implementare Molecule – SegmentedControl** | Serie di Button per scelta singola. | ☐ |
|12| **Implementare Molecule – FacetedSearchField** | Input con token‑chip e suggerimenti. | ☐ |
|13| **Implementare Molecule – StatTile / SectionHeader** | Riquadri informativi e header di sezione. | ☐ |
|14| **Implementare Molecule – NavItem / NavGroup** | Sidebar navigation, supporto rail/drawer. | ☐ |
|15| **Implementare Molecule – FormField / RestorePointRow / CheckItem / ContextCostRow** | Wrapper per form, backup, check, cost. | ☐ |
|16| **Implementare Molecule – Modal / DropdownMenu / Toast (Radix candidate)** | Overlay e notifiche. | ☐ |
|17| **Implementare Molecule – DataTable / TreeRow / FocusCard / Inspector / Charts / ExportMenu / CodeEditorView / ConflictBanner / MapCanvas / EmptyState** | Componenti di livello organismo/template. | ☐ |
|18| **Creare Layout – AppShell** | Sidebar, AppHeader, TopStrip, tema persistente. | ☐ |
|19| **Migrare pagine** | Planner, Agents, Settings, ecc. verso `agent-brain-web-ui`. | ☐ |
|20| **Testing** | Unit test, Storybook, Playwright E2E. | ☐ |
|21| **CI / Build** | Aggiornare workflow per includere nuovo package. | ☐ |
|22| **Documentazione** | Aggiornare `README.md`, generare guide per token, componenti, uso. | ☐ |
|23| **Release** | Pubblicare `@agent-plan/agent-brain-web-ui` con script `pnpm release`. | ☐ |

---

## Note operative

- **Ramo base**: `feat/agent-brain`.
  La feature verrà sviluppata su un worktree creato da `feat/agent-brain` con una branch temporanea `feat/agent-brain-ds`. 
  Per ogni attività:
  1. **Lavori** nella branch `feat/agent-brain-ds`.
  2. **Al termine** della attività attendi la mia review.
  3. Dopo l'approvazione, **commit**, **push** e apri una **pull‑request** verso `feat/agent-brain`.
  4. Una volta che la PR è mergiata, **cancelli** il worktree e la branch temporanea.
  5. Il prossimo step ricomincia creando nuovamente il worktree da `feat/agent-brain`.
  `develop` e `main` non verranno toccati.
- Tutti gli *atoms* espongono le props elencate nella tabella presente in `docs/agent-brain-ui/components.md`. Le props permettono di sovrascrivere classi via `className` e di scegliere varianti (`variant`, `tone`, `size`).
- I token sono disponibili in `docs/agent-brain-ui/mockup/ds/agent-plan/tokens.json`. Lo script di generazione del tema aggiornerà automaticamente `tailwind.config.cjs`.
- Alcuni componenti overlay (Modal, DropdownMenu, Toast) sono **candidati Radix**; saranno aggiunti solo dopo approvazione esplicita.
- Le attività saranno spuntate manualmente nella checklist quando completate.
- Tutti gli *atoms* espongono le props elencate nella tabella presente in `docs/agent-brain-ui/components.md`. Le props permettono di sovrascrivere classi via `className` e di scegliere varianti (`variant`, `tone`, `size`).
- I token sono disponibili in `docs/agent-brain-ui/mockup/ds/agent-plan/tokens.json`. Lo script di generazione del tema aggiornerà automaticamente `tailwind.config.cjs`.
- Alcuni componenti overlay (Modal, DropdownMenu, Toast) sono **candidati Radix**; saranno aggiunti solo dopo approvazione esplicita.
- Le attività saranno spuntate manualmente nella checklist quando completate.

---

*Questo file funge da piano di lavoro condiviso. Aggiorna lo stato della colonna "Stato" man mano che completi gli step.*

## Regole di qualità del codice

- **Formattazione:** usiamo `oxfmt` (configurazione in `.oxfmt.json`). Il progetto sarà formattato automaticamente prima di ogni commit.
- **Linting:** usiamo `oxlint` con configurazione in `.oxlintrc.json`. Regole principali:
  - nessun `any` o `unknown` (errori di tipo).
  - tutti i componenti devono essere in file singoli (max 400 linee).
  - ogni file deve avere `noUnusedVars` e `noImplicitAny` attivi.
  - nessun warning TypeScript; il build deve passare senza errori.
- **Test:** per ogni componente/logic module viene creato:
  - unit test (`*.test.tsx`) con Jest.
  - Storybook story (`*.stories.tsx`).
  - tutti i test devono passare senza warnings.
- **Componenti:** se non è possibile evitare `any`/`unknown`, segnala al revisore.
- **Conformità:** prima di dichiarare completata un’attività, il linter, il formatter e i test devono essere verdi.

---
