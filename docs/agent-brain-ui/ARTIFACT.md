# Interactive mockup

The clickable version of this design is hosted on claude.ai as a Design Canvas
artifact. It is the canvas rendered from `mockup/` (the `.dc.html` files here are the
source; they need the canvas runtime, so click through them there, or open the
rendered copies in `mockup/static/`, see below).

- **UI mockup (all screens):** https://claude.ai/artifact/LkFamcAA6Fkbo6pjkQipih
- **Design system (tokens + brand book):** https://claude.ai/artifact/6eZ1SzyYPABFynHxak9SKp

Both artifacts are **private**: only the owner and people the owner has explicitly
shared them with can open the links. If you cannot open them, ask the owner to share.

The artifact and the `mockup/` source are kept in sync. When the design changes, both
are updated together.

## Viewing the mockup without the canvas

Opening a `mockup/*.dc.html` file directly in a browser (or importing it into another
tool) shows the raw template: `{{projTitle}}`, `{{a.owner}}`, every modal and branch at
once, and links that go nowhere. That is expected: the files load `./support.js`, the
canvas runtime, which is not in the repo.

Use **`mockup/static/`** instead: the same screens rendered with the demo data, as plain
HTML. Open `mockup/static/index.html` (or `Main.html`) straight from disk; the sidebar
and in-page links move between screens. In-page interactions (modals, filters, theme
toggle, collapsible sidebar) are not wired there — use the artifact for those.

Regenerate `static/` after changing a `.dc.html` file:

1. Download `artifact-type/dc-runtime.js` from the UI mockup artifact.
2. `node scripts/export-mockup-static.mjs --runtime path/to/dc-runtime.js`
   (or save it as `mockup/support.js`, git-ignored, and omit `--runtime`).

The script fails if any page still shows an unresolved `{{hole}}` or throws.
