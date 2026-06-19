# Unit01 — UI Overhaul Changes

> Decisions are locked here one by one. This is the source of truth before implementation.

---

## Status Legend
- 🔲 Not discussed yet
- 💬 In discussion
- ✅ Locked in

---

## Components

| # | Component | Status |
|---|-----------|--------|
| 1 | Color Theme / Palette | ✅ |
| 2 | Welcome Banner | ✅ |
| 3 | Thinking Spinner | ✅ |
| 4 | Prompt / Status Bar | ✅ |
| 5 | User Input Echo | ✅ |
| 6 | Tool-call Streaming Spinner | ✅ |
| 7 | Tool Result Lines (✓/✗) | ✅ |
| 8 | File Write Confirmation | ✅ |
| 9 | Side-by-Side Diff Block | ✅ |
| 10 | New File Block | ✅ |
| 11 | Code Blocks in AI Response | ✅ |
| 12 | AI Response (● + markdown) | ✅ |
| 13 | Thinking Block (🧠) | ✅ |
| 14 | Interactive Select Menu | ✅ |
| 15 | Status / Usage Panels | ✅ |
| 16 | Help Menu | ✅ |
| 17 | System / Error Messages | ✅ |
| 18 | /menu Command Picker | ✅ |
| 19 | Slash Inline Autocomplete | ✅ |
| 20 | AI Question Prompt | ✅ |
| 21 | Startup Error Screens | ✅ |
| 22 | Context Auto-compact Notification | ✅ |
| 23 | Sandbox / Guard Block Messages | ✅ |

---

## Decisions

<!-- Each locked decision will be added here -->

---

### ✅ Component #20 — AI Question Prompt

**Decision: Use ❯ select treatment, same as #14**

When model uses `<question>` tool to ask a clarifying question with options.

#### Visual:
```
  Which database should I use?
  ────────────────────────────────────────
  ❯ PostgreSQL
    SQLite
    MongoDB
```
- Question text → violet `#C084FC` bold
- `────` rule → `themeBorder` `#1E1B4B`
- `❯` cursor → gold `#F59E0B`
- Options same as #14 select menu treatment
- Replaces current plain `1) option` numbered list

---

**Status: ✅ LOCKED**

---

### ✅ Component #21 — Startup Error Screens

**Decision: ◈ error/warn pattern from #17, applied at boot time**

Fires before the banner when Ollama isn’t running, model not found, config invalid etc.

#### Visual:
```
  ◈ error  ·  no local Ollama models detected
             ensure Ollama is running: ollama run qwen2.5-coder

  ◈ warn   ·  model "mistral" not found, using qwen2.5:72b

  ◈ error  ·  compact_threshold must be 0.5–0.95, got: 1.2
```
- Same `◈ type · message` pattern as #17
- error → rose `#F87171`
- warn → gold `#F59E0B`
- Hint lines (indented) → `themeGray` `#64748B`
- Replaces `[Error]` / `[Config Error]` bracket labels and raw `console.error` red dumps

---

**Status: ✅ LOCKED**

---

### ✅ Component #22 — Context Auto-compact Notification

**Decision: ◈ info pattern from #17**

Shows after automatic context compaction mid-session.

#### Visual:
```
  ◈ info  ·  context compacted ·  87% → 21%  ·  saved 24k tokens
```
- `◈ info` → emerald `#34D399`
- All detail on one line, `·` separators in gray
- Replaces `⚡ Context auto-compacted (was 87% full). Saved 24,301 tokens.`
- `⚡` emoji gone

---

**Status: ✅ LOCKED**

---

### ✅ Component #23 — Sandbox / Guard Block Messages

**Decision: ◈ guard pattern from #17**

Shows when sandbox blocks a dangerous command or tool depth exceeded.

#### Visual:
```
  ◈ guard  ·  command blocked  ·  rm -rf /
  ◈ guard  ·  tool depth limit reached (15)
  ◈ guard  ·  path outside workspace  ·  /etc/passwd
```
- `◈ guard` → gold `#F59E0B` (warning, not error — it’s protection, not failure)
- Blocked command/path in dim rose `#F87171`
- Replaces `⚠️  [Sandbox Guard] ...` emoji + bracket label

---

**Status: ✅ LOCKED**

---

### ✅ Component #18 — /menu Command Picker

**Decision: Two-column layout, no emojis, ❯ navigator, violet + gray**

#### Visual:
```
  ◈ unit01  ·  commands
  ────────────────────────────────────────
  ❯ models       switch active model
    thinking     toggle reasoning blocks
    usage        context window usage
    sessions     browse saved sessions
    search       search codebase
    compact      compress context
    changes      view recent file changes
    undo         revert last change
    clear        clear conversation
    status       system info
    exit         quit unit01
  ────────────────────────────────────────
```

#### Color application:
- `◈ unit01  ·  commands` header → violet `#C084FC`
- `────` rules → `themeBorder` `#1E1B4B`
- `❯` cursor → gold `#F59E0B`
- Selected command name → `#E2E8F0` bold
- Unselected command names → violet `#C084FC` dim
- Descriptions → `themeGray` `#64748B`

#### What this replaces:
- All emoji prefixes (`🤖`, `🧠`, `📊` etc) — gone entirely
- Parenthetical command hints `(/models)` — gone, command name IS the item

---

**Status: ✅ LOCKED**

---

### ✅ Component #19 — Slash Inline Autocomplete (new feature)

**Decision: Popup above input zone, filters live as you type, Tab/Enter selects**

Currently doesn’t exist — typing `/` just submits whatever you type. This adds proper autocomplete.

#### Visual (typing `/mo`):
```
  │ models    thinking    usage    sessions   ← matches `mo` highlighted
  ────────────────────────────────────────
  ❯ /mo█
  ────────────────────────────────────────
```

#### Behavior:
- Triggers when first char typed is `/`
- Filters commands live as you type more chars
- `Tab` → autocompletes to first match
- `Enter` on a match → executes directly
- `Esc` → dismisses popup, stays in input
- Single match remaining → auto-highlight it

#### Color application:
- `│` popup left border → `themeBorder` `#1E1B4B`
- Matching commands → violet `#C084FC`
- Matched substring highlighted → gold `#F59E0B` bold
- Non-matching commands → hidden (filtered out)

---

**Status: ✅ LOCKED**

---

### ✅ Component #15 — Status / Usage Panels

**Decision: Keep info, restyle with separator language + palette**

#### `/status` visual:
```
  ────────────────────────────────────────
  ◈ unit01  ·  system status
  ────────────────────────────────────────
  model      qwen2.5:72b
  context    24,301 / 128,000 tokens  (18%)
  workspace  ~/nayalabs/unit01
  branch      main
  files      247
```

#### `/usage` progress bar:
```
  context window
  ────────────────────────────────────────
  [███████░░░░░░░░░░░░░]  18%  ·  24k / 128k
```
- `█` fill: gold `#F59E0B` (under 60%) → amber (60-80%) → rose `#F87171` (80%+)
- `░` empty: `themeGray` `#64748B`
- Labels: dim gray
- `◈` header mark: violet `#C084FC`

---

**Status: ✅ LOCKED**

---

### ✅ Component #16 — Help Menu

**Decision: Separator + violet commands + gray descriptions**

#### Visual:
```
  ────────────────────────────────────────
  ◈ unit01  ·  help
  ────────────────────────────────────────
  /models       switch the active model
  /thinking     toggle reasoning blocks
  /status       system info
  /usage        context window usage
  /sessions     browse saved sessions
  /compact      compress context
  /clear        clear conversation
  /help         show this menu
```
- `◈ unit01  ·  help` header: violet `#C084FC`
- Command names `/models` etc: violet `#C084FC`
- Descriptions: `themeGray` `#64748B`
- Replaces current cyan command list with no structure

---

**Status: ✅ LOCKED**

---

### ✅ Component #17 — System / Error Messages

**Decision: ◈ mark + type label + message. No emoji, no bracket labels**

#### Visual:
```
  ◈ error  ·  connection failed: ECONNREFUSED        ← rose red
  ◈ warn   ·  context 85% full, compacting soon      ← gold
  ◈ guard  ·  maximum tool depth (15) reached        ← gold
  ◈ info   ·  context compacted: 48k → 12k saved     ← emerald
  ◈ stop   ·  generation interrupted                 ← rose red
```

#### Color application:
- `◈` mark → matches the message type color
- `error` / `warn` / `guard` / `info` / `stop` label → same color, lowercase
- `·` separator → `themeGray`
- Message text → same color but slightly dimmer
- error/stop → rose `#F87171`
- warn/guard → gold `#F59E0B`
- info/success → emerald `#34D399`

#### What this removes:
- `⚠️` emoji — gone
- `[System Guard]` / `[Error]` bracket labels — gone
- `⚡` emoji for compaction — gone
- Everything replaced with `◈ type · message` pattern

---

**Status: ✅ LOCKED**

---

### ✅ Component #14 — Interactive Select Menu

**Decision: Keep structure, swap cursor to ❯, highlight to gold**

No reinvention needed. Structure works. Just palette + cursor consistency.

#### Visual:
```
  Switch Model

  ❯  qwen2.5:72b          ← gold highlight, selected
     qwen2.5:7b           ← dim gray
     llama3.2:latest      ← dim gray
     deepseek-r1:14b      ← dim gray
```

#### Color application:
- `❯` cursor → gold `#F59E0B` (same as prompt `❯` initial pulse)
- Selected item text → `#E2E8F0` near white, bold
- Selected item bg → deep indigo `#1E1B4B` (subtle, not heavy)
- Unselected items → `themeGray` `#64748B`
- Title → violet `#C084FC`
- Cursor hidden during selection (same as current)

#### What this replaces:
- Current `chalk.bgHex('#6B21A8').white(...)` purple bg → deep indigo bg + gold cursor
- Current `●` selection marker → `❯` (consistent with prompt)

---

**Status: ✅ LOCKED**

---

### ✅ Component #13 — Thinking Block

**Decision: Collapsible, full markdown rendered, ◈ mark + left rail**

Models that support thinking (Qwen3, DeepSeek-R1) write structured reasoning — tables, pseudocode, comparisons. Flattening that to plain gray italic wastes the most useful part. Full markdown rendering inside the thinking block, contained behind a dim left rail.

#### Collapsed (default):
```
  ◈ thought  ·  4s
```
Press `t` to expand.

#### Expanded:
```
  ◈ thought  ·  4s
  │
  │ Let me compare approaches:
  │
  │ | Approach | Pros      | Cons         |
  │ | JWT      | stateless | can't revoke |
  │ | Sessions | revocable | stateful     |
  │
  │ I'll go with JWT because:
  │ · The app is stateless
  │ · No Redis available
  │
```

#### Color application:
- `◈` mark → `themeGray` `#64748B` (dim, secondary)
- `thought` label → `themeGray` `#64748B` lowercase, no emoji, no colon
- `· 4s` duration → `themeGray` `#64748B` (useful info — how long model thought)
- `│` left rail → dim violet `#6D28D9` (deep violet, not full primary)
- Content inside → full markdown rendered, same renderer as AI response (#12)
- Everything inside slightly dimmer than the main AI response — secondary priority
- Code blocks inside thinking → same style as #11 but dimmed
- Tables, bullets, headings all render properly

#### Behavior:
- **Collapsed by default** — clean screen, opt-in to read
- `t` key toggles expand/collapse
- Duration `· 4s` shown even when collapsed — gives sense of thinking depth
- Streams live when expanded during generation

#### What this replaces:
- Current `🧠 Thinking:` header — gone (emoji + redundant label)
- Current plain gray italic unrendered text — replaced with full markdown
- Not collapsible currently — now collapsible by default

---

**Status: ✅ LOCKED**

---

### ✅ Component #12 — AI Response

**Decision: Keep ● bullet, keep emerald, keep full markdown — palette update only**

Nothing broken here structurally. The ● is the AI's voice marker. Emerald is the alive/output color, not structural. Full markdown is genuinely useful. Just update palette tokens.

#### Visual (unchanged structure):
```
● Here's how to set up JWT authentication...

  **Step 1:** Install the dependencies

  **Step 2:** Create the middleware

  TypeScript ────────────────────────────
  const verify = jwt.verify(token, secret)
  ───────────────────────────────────
```

#### Palette updates to markdown renderer tokens:
- `●` bullet → stays emerald `#34D399` (AI voice, not structural)
- Headings `##` → violet `#C084FC` bold
- Bold `**text**` → `#E2E8F0` near white bold
- Inline code `` `code` `` → on dark bg `#0D0D0D`, text in `#6EE7B7` soft emerald
- Blockquote `>` → left border in violet `#C084FC`, text in gray `#64748B`
- Links → violet `#C084FC` underlined
- List bullets → gold `#F59E0B` (small touch of the palette)
- Tables → border in `#1E1B4B`, header in violet

#### What stays the same:
- `marked` + `marked-terminal` renderer — unchanged
- Full markdown support: headings, bold, italic, lists, tables, blockquotes, code
- `●` prefix position and structure

---

**Status: ✅ LOCKED**

---

### ✅ Component #11 — Code Blocks in AI Response

**Decision: Language label on top rule, top + bottom rules, dark bg body — no side borders**

Same `────` separator language as the rest of Unit01. Code blocks feel part of the same system.

#### Visual:
```
  TypeScript ──────────────────────────────────
  const auth = async (token: string) => {
    const decoded = jwt.verify(token, SECRET)
    return decoded
  }
  ─────────────────────────────────────────
```

#### Color application:
- Language label (e.g. `TypeScript`) → `themePrimary` violet `#C084FC`
- Top rule `────` → `themeBorder` `#1E1B4B` (flows right after the label)
- Code body background → `themeBg` near black `#0D0D0D`
- Bottom rule `────` → `themeBorder` `#1E1B4B`
- No `│` side borders — just top and bottom rules
- Syntax highlighting applied normally on top
- No unlabeled fallback label needed — if no language, just `────` rule with no label

#### What this replaces:
- Current padded dark bg block with no label, no top/bottom rules
- `markedRenderer` code block override in `ui.ts` L266–307

---

**Status: ✅ LOCKED**

---

### ✅ Component #9 & #10 — Diff Block & New File Block

**Decision: Unified diff — drop side-by-side entirely**

Everyone does unified diff. Side-by-side is an IDE/web concept that breaks on narrow terminals and is visually overwhelming. Going with the standard that every developer already knows.

#### Diff Block Visual (modified file):
```
  src/index.ts
  ─────────────────────────────────────────
    1   const app = express()
    2 - const port = 3000
    2 + const port = process.env.PORT || 3000
    3   app.listen(port)
  ─────────────────────────────────────────
```

#### New File Block Visual:
```
  src/auth.ts  ·  new file
  ─────────────────────────────────────────
    1 + import jwt from 'jsonwebtoken'
    2 + 
    3 + export const verify = (token: string) => {
  ─────────────────────────────────────────
```

#### Color application:
- Filename → `themePrimary` violet `#C084FC`
- `· new file` / `· modified` label → `themeGray` `#64748B`
- `────` top & bottom rules → `themeBorder` `#1E1B4B`
- `-` removed lines: text in `themeRed` `#F87171` + subtle dark red bg `#2D1B1B`
- `+` added lines: text in `themeGreen` `#34D399` + subtle dark green bg `#1B2D1B`
- Context lines (unchanged): `themeGray` `#64748B`
- Line numbers: dimmer gray `#475569`
- Syntax highlighting still applied on top of all lines

#### What this replaces:
- Current two-column `┌─┬─┐ │ ├─┼─┤ └─┴─┘` side-by-side box — gone entirely
- `renderSideBySideDiff()` in `ui.ts` — replaced with unified renderer
- `renderNewFileBlock()` in `ui.ts` — simplified to same unified style

---

**Status: ✅ LOCKED**

---

### ✅ Component #8 — File Write Confirmation

**Decision: Separator line + bracketed key options**

Familiar enough for any AI CLI user. Distinctly Unit01 in its visual language — uses our separator line instead of a modal box.

#### Visual:
```
    write  src/index.ts  ·  342 lines
  ──────────────────────────────────────
  [y] yes    [n] no    [p] preview diff
```

#### Color application:
- Nerd Font file glyph `` → `themeGray` `#64748B`
- `write` verb → `themeGray` `#64748B`
- `src/index.ts` filename → `themePrimary` violet `#C084FC`
- `·  342 lines` → `themeGray` `#64748B`
- `────` separator → `themeBorder` `#1E1B4B`
- **Selected option**: `[y]` bracket+key in gold `#F59E0B`, label in `#E2E8F0`
- **Unselected options**: dim gray `#64748B`
- Default selected: `[y] yes` (first option)

#### Behavior:
- Single keypress — no Enter needed
- `y` → writes file, shows `⎿ Wrote src/index.ts (342 lines)` in emerald
- `n` → skips, shows `⎿ Skipped src/index.ts` in gray
- `p` → shows diff block first, then re-shows confirmation

#### What this replaces:
- Current `? Confirm changes? [y/N/p(review)]:` raw text prompt
- Current `create Proposed: src/foo.ts (42 lines)` label

---

**Status: ✅ LOCKED**

---

### ✅ Component #7 — Tool Result Lines

**Decision: Adopt Claude Code's ⎿ pattern — no ✓/✗, no "(completed)"**

Not everything needs to be new. Claude Code's approach here is genuinely clean and readable. We take it, apply our palette.

#### Visual:
```
  ⎿  Wrote src/index.ts (342 lines)          ← success
  ⎿  Ran: npm install (exit 0)               ← success
  ⎿  Read src/db.ts (89 lines)               ← success
  ⎿  Searched "DatabaseSync" (12 results)    ← success

  ⎿  Ran: npm install (exit 1)               ← failure
  ⎿  Wrote src/index.ts — permission denied  ← failure
```

#### Color application:
- `⎿` glyph → `themeGray` `#64748B` always (dim, structural)
- Success line text → `themeGreen` emerald `#34D399`
- Failure line text → `themeRed` rose `#F87171`
- No bold, no background — color alone signals status

#### What this removes:
- `✓` and `✗` tick/cross symbols — gone
- `(completed)` suffix — gone (redundant)
- `(failed)` suffix — gone (redundant, color says it)
- Duplicate tool name prefix

---

**Status: ✅ LOCKED**

---

### ✅ Component #5 — User Input Echo

**Decision: Rules disappear on submit, bare ❯ + text in history**

#### Full flow:

**While typing (active input zone with rules):**
```
──────────────────────────────────────────────────
❯ write me a login page
──────────────────────────────────────────────────
```

**After Enter (scroll history):**
```
❯ write me a login page
```

#### Rules:
- The two `────` rules exist ONLY while the input is active
- On Enter, rules disappear entirely
- What remains in history: `❯` in violet `#C084FC` + message text in `#E2E8F0`
- No background highlight, no dark block, no box — just bare text
- Simple. A receipt, not a feature.

#### What this replaces:
- Current `chalk.bgHex('#2B2B2B').white(...)` background block redraw
- The grey highlight blob is gone entirely

---

**Status: ✅ LOCKED**

---

### ✅ Component #3 — Thinking Spinner & #6 — Tool-call Streaming Spinner

**Decision: Sanskrit Cascade → Ambient Hold → Dissolution**

#### What replaces the current spinner:
Three distinct phases, both for thinking AND tool-call moments.

---

**Phase 1 — THE MOMENT** *(always plays, hard minimum 1200ms)*
- A rapid cascade of Sanskrit/Devanagari words bursting onto the line one by one
- Fast pace, colorful, alive — meant to be WATCHED
- Each word is a different character/syllable (अ, स्व, काल, ज्ञान, सृष्टि, धर्म, वायु, etc.)
- Multi-color palette (decided separately in colors section)
- This always plays — even if model responds in 300ms, Phase 1 runs its full 1200ms

**Phase 2 — AMBIENT HOLD** *(only if model hasn't responded yet after Phase 1)*
- Cascade stops
- ONE single Sanskrit word left on screen, slowly pulsing
- Like a heartbeat — calm, "still alive" signal
- No new words, no fast animation — just breathing
- Runs indefinitely until model starts responding

**Phase 3 — DISSOLUTION** *(triggered by first token OR tool XML detected)*
- The Sanskrit on the RIGHT side starts getting eaten by the real content from the LEFT
- For tool calls: the actual command text grows letter by letter from left, consuming the Sanskrit
- Example:
  ```
  अस्वप्नकालज्ञानसृष्टि
  writeअस्वप्नकालज्ञान
  write sअस्वप्नकाल
  write srcअस्वप्न
  write src/अस्व
  write src/index.tsअ
  write src/index.ts (234 chars)
  ```
- Duration: ~400–600ms for the dissolution
- For streamed text (non-tool): Sanskrit dissolves and markdown text begins flowing

---

#### Timing logic:
| Machine speed | Experience |
|---|---|
| Fast (M-series / good GPU) | Phase 1 (1.2s) → Phase 3 (dissolve) — tight & punchy |
| Medium | Phase 1 (1.2s) → Phase 3 (dissolve) — same |
| Slow (CPU / cold start) | Phase 1 (1.2s) → Phase 2 (ambient pulse, Xs) → Phase 3 (dissolve) |

No upper time cap. No hardcoded 2000ms like current code.

---

#### What this replaces:
- Current thinking spinner: ` ● Bamboozling...` (ThinkingSpinner class in ui.ts)
- Current tool-call spinner: `⠋ preparing tool call...` / `⠋ write src/index.ts...`
- The `minDelay = 2000` hardcoded constant in index.ts

---

**Status: ✅ LOCKED**

---

### ✅ Component #1 — Color Theme / Palette

**Decision: "Dark Ritual"**

The color story matches the Sanskrit spinner identity — ancient chaos becoming precise intent. Gold feels like Sanskrit manuscripts, fire, summoning. Violet feels cold, digital, precise. The contrast between them IS the animation's story.

#### Full Palette

| Token | Name | Hex | Used For |
|-------|------|-----|----------|
| `themePrimary` | Electric Violet | `#C084FC` | Borders, prompt label, structure |
| `themeBorder` | Deep Indigo Dark | `#1E1B4B` | Box borders, separator lines |
| `themeGold` | Amber Gold | `#F59E0B` | Sanskrit cascade, in-progress, spinner |
| `themeGreen` | Emerald | `#34D399` | Success ✓, AI response bullet |
| `themeGreenLight` | Soft Emerald | `#6EE7B7` | Info, inline code |
| `themeRed` | Soft Rose | `#F87171` | Errors ✗, interrupts |
| `themeGray` | Muted Slate | `#64748B` | Dimmed text, timestamps |
| `themeBg` | Near Black | `#0D0D0D` | Code block backgrounds |
| `themeBgDeep` | Pitch Black | `#050505` | Deepest backgrounds |

#### Color roles in the Sanskrit animation specifically:
- **Sanskrit cascade chars** → cycle through gold `#F59E0B` → amber `#D97706` → deep gold `#92400E` (warm, ancient, glowing)
- **Ambient pulse word** → slow violet `#C084FC` pulse (calm, ethereal)
- **Dissolving command text** → crystallizes into `#E2E8F0` (near white, cold, precise)

#### Why this over the competition:
- Claude Code owns warm orange → we don't touch it
- OpenCode/Crush own purple → we use violet but paired with GOLD, making it unique
- Nobody owns deep violet + amber gold in CLI tooling
- Near-black `#0D0D0D` bg makes every color hit harder — gold glows, violet pops

#### Replaces current tokens in `ui.ts` L10–17:
- `themePrimary` `#60A5FA` → `#C084FC`
- `themeBorder` `#334155` → `#1E1B4B`
- `themeGreen` `#2DD4BF` → `#34D399`
- `themeGreenLight` `#93C5FD` → `#6EE7B7`
- `themeOrange` `#F59E0B` → renamed to `themeGold`, same hex `#F59E0B`
- `themeGray` `#64748B` → unchanged
- `themeRed` `#FB7185` → `#F87171`
- `themeBgDeep` `#0F172A` → `#0D0D0D`

---

**Status: ✅ LOCKED**

---

### ✅ Component #2 — Welcome Banner

**Decision: "The Monument" — Option D, no Sanskrit**

#### Visual layout:
```

        ◈
        │
        │  u n i t  0 1
        │  ───────────────────────────


   ──────────────────────────────────────────────
   qwen2.5:72b  ·  128k ctx  ·  ~/project  ·  main
   ──────────────────────────────────────────────

```

#### Color application:
- `◈` diamond mark → `themePrimary` electric violet `#C084FC`
- `│` vertical connector line → `themePrimary` electric violet `#C084FC` dimmed
- `u n i t  0 1` spaced wordmark → `themePrimary` electric violet `#C084FC` bold
- `───` horizontal rule under name → `themeBorder` deep indigo `#1E1B4B`
- Bottom metadata line → `themeGray` `#64748B`
- Bottom `────` rules → `themeBorder` `#1E1B4B`
- Metadata values (model, ctx, path, branch) → `#E2E8F0` near white
- Separators `·` → `themeGray` `#64748B`

#### Structure:
- Top section: `◈` mark → `│` line → spaced wordmark → `───` rule
- Gap line
- Bottom section: full-width `────` + metadata on one line + `────`
- No box/border wrapping the whole thing — whitespace is the frame
- No ASCII mascot, no emoji, no box drawing around the whole thing

#### What this replaces:
- Current `printWelcomeBanner()` in `ui.ts` L522–561
- Current ASCII robot mascot (`░█` block chars)
- Current full-width `┌─┐ │ └─┘` border box

---

**Status: ✅ LOCKED**

---

### ✅ Component — Typography / Font Strategy

**Decision: Nerd Fonts assumed, with Unicode fallbacks**

#### What we assume:
- User has a **Nerd Font** installed (JetBrains Mono Nerd, FiraCode Nerd, Hack Nerd, etc.)
- This is a safe assumption — any developer running a local LLM CLI on Ollama almost certainly has a Nerd Font set in their terminal
- We do NOT ship or install any font ourselves

#### What this unlocks:
- Full **Nerd Font glyph set** for icons, arrows, powerline separators
- Richer visual language throughout the UI (tool icons, status indicators, branch symbols, etc.)
- Specific glyphs to use:
  - `󰙘` or `` — for file/write operations
  - `` — for git branch in prompt bar
  - `󰒓` — for settings/config
  - `` — for run/command operations
  - `◈` — logo mark (Unicode, works everywhere)
  - `` — for AI/model indicator
  - `󱁤` — for search/indexing

#### Fallback strategy:
- Any Nerd Font glyph that fails to render → falls back to a plain Unicode equivalent
- The Sanskrit spinner uses **Devanagari Unicode** — no Nerd Font needed, works in any terminal with Unicode support
- The banner spaced wordmark `u n i t  0 1` is plain chalk text — no font dependency

#### What this replaces:
- Current plain text labels (`write`, `run`, `read`) with glyph-enhanced versions
- Current `●` bullet (kept, it's Unicode) 
- Current `✓` / `✗` tick marks → enhanced with Nerd Font alternatives

---

**Status: ✅ LOCKED**

---

### ✅ Component #4 — Prompt / Status Bar

**Decision: Contained input zone — two full-width rules with ❯ between them**

#### Visual layout:
```
──────────────────────────────────────────────────
❯ 
──────────────────────────────────────────────────
```

Multi-line input expands naturally:
```
──────────────────────────────────────────────────
❯ write me a full authentication system with JWT
  tokens, refresh logic, and middleware for all
  the routes in this express app
──────────────────────────────────────────────────
```

#### Color application:
- Top rule `────` → `themeBorder` deep indigo `#1E1B4B`
- `❯` prompt char → appears as gold `#F59E0B` then cools to violet `#C084FC` over ~600ms
- Bottom rule `────` → `themeBorder` deep indigo `#1E1B4B`
- Typed text → `#E2E8F0` near white

#### The `❯` pulse detail:
- When the prompt first appears after a model turn, `❯` renders in gold `#F59E0B`
- Over ~600ms it transitions to violet `#C084FC` and stays there
- Signals the handoff — "model's energy → your energy"
- On first launch (no prior turn) it just appears in violet directly

#### What this removes:
- The `unit01 (main)` right-aligned status text — gone entirely
- The `unit01` tool name prefix before `❯` — gone entirely
- No branch name, no tool name, no repetition in the prompt zone
- The current single `─────` divider → replaced by two rules sandwiching the input

#### Rules:
- Both rules are full terminal width (`process.stdout.columns`)
- Rules do NOT scroll — they are redrawn each turn
- No text on the rules — purely structural
- Same structure as Claude Code and AGY — input zone is a defined, contained space

---

**Status: ✅ LOCKED**
