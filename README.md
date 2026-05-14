# Eisenhower Matrix — Obsidian plugin

Vizualizace tasků napříč vault-em v 5-polové Eisenhower matici (DO / DECIDE / DELEGATE / DELETE / OPEN). Čte a zapisuje Obsidian Tasks syntaxi — `#tagy`, `📅 due`, `🛫 start`, `✅ done`, priority emoji `🔺/⏫/🔼/🔽/⏬`.

> Plugin verze webové aplikace „To-Do Today". Stejné UI a feature set, ale nativně v Obsidianu (žádný server, žádný browser). [Web verze](../Druhy-mozek/Eisenhower-matrix/README-Eisenhower-matrix.md) zůstává funkční paralelně (pro mobile přes LAN).

## Stav

**Phase A — Foundation** (read-only proof of concept). Plugin lze nainstalovat, otevře view, vykreslí všechny tasky v matici. Žádné interakce zatím (checkbox je disabled). Další fáze přijdou postupně.

| Fáze | Obsah | Stav |
|------|-------|------|
| A | Foundation: install, render, read-only matrix | ✅ |
| B | Read-only UI polish: filtr, sort, datum nav | ⏳ |
| C | Write ops: toggle, add, move, edit, set priority/due | ⏳ |
| D | Settings tab + commands palette + ribbon polish | ⏳ |
| E | Polish + mobile + popout window support | ⏳ |

## Konvence

Tasky musí mít Obsidian Tasks formát:

```
- [ ] #DO #Osobní ⏫ 📅 2026-05-10 🛫 2026-05-01 Zavolej Alici
- [x] #DECIDE #Work ✅ 2026-04-30 Rozhodni se ohledně budgetu
```

Kvadrant určuje **první token po `- [ ]`**:
- `#DO` → DO
- `#DECIDE` → DECIDE
- `#DELEGATE` → DELEGATE
- `#DELETE` → DELETE
- cokoli jiného → OPEN

Priorita (z Obsidian Tasks pluginu):
- 🔺 highest · ⏫ high · 🔼 medium · 🔽 low · ⏬ lowest

## Install (vývoj / Phase A)

Plugin zatím není v Community Plugins store. Instalace ručně:

1. `git clone https://github.com/krcaljaroslav/obsidian-eisenhower-matrix.git` (jakmile bude repo public)
2. `cd obsidian-eisenhower-matrix && npm install && npm run build`
3. Zkopíruj `manifest.json`, `main.js`, `styles.css` do `{vault}/.obsidian/plugins/eisenhower-matrix/`
4. V Obsidianu: Settings → Community plugins → enable „Eisenhower Matrix"
5. Klikni na ikonu mřížky v left ribbon, nebo `Ctrl+P` → „Open Eisenhower Matrix"

### Symlink pro vývoj

Místo kopírování pro každý build můžeš nasymlinkovat dist do plugin složky:

```powershell
# PowerShell jako admin
New-Item -ItemType SymbolicLink `
  -Path "C:\path\to\vault\.obsidian\plugins\eisenhower-matrix" `
  -Target "C:\Druhy_mozek\0_Projects\obsidian-eisenhower-matrix"
```

Pak stačí `npm run dev` v projektu — esbuild watch režim, Obsidian po každém buildu reload (`Ctrl+R` v dev tools, nebo „Reload app without saving" command).

## Konfigurace

Phase A: žádná. Plugin respektuje core plugin „Daily notes" — uživatelovu nastavenou složku pro daily.

## Známé limity v Phase A

- **Read-only** — checkbox, drag, edit, add task nefunguje. Přijde ve Fázi C.
- **Žádný filtr / datum nav / dark mode toggle** — Fáze B.
- **Žádná settings** — Fáze D.
- Live reload přes `vault.on(modify/create/delete/rename)` funguje, ale debounce je hardcoded 200 ms.

## Sdílený kód s web app

Plugin sdílí ~300 řádků core kódu s [web verzí](../Druhy-mozek/Eisenhower-matrix/app/):

| Plugin | Web app |
|--------|---------|
| `src/core/parser.ts` | `server/parser.ts` |
| `src/core/taskUtils.ts` | `src/utils/taskUtils.ts` |
| `src/core/types.ts` | `src/types.ts` |

**Drž sync ručně** — když měníš v jednom, uprav i druhý. Test suite obou repech zachytí drift.

## Licence

[MIT](LICENSE)
