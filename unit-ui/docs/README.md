# Unit-UI

**The Rust terminal toolkit for building agentic CLIs.**

```text
  _   _       _ _       _   _ ___
 | | | |_ __ (_) |_    | | | |_ _|
 | | | | '_ \| | __|   | | | || |
 | |_| | | | | | |_    | |_| || |
  \___/|_| |_|_|\__|    \___/|___|
                   Toolkit
```

---

## Elevator Pitch

Unit-UI is a **Rust component library** built on top of [Ratatui](https://ratatui.rs) that provides drop-in terminal widgets purpose-built for AI agent interfaces. Every agent CLI (Claude Code, Codex, Gemini CLI, OpenCode, Goose, etc.) rebuilds the same streaming chat, tool call, diff view, and approval prompt UI from scratch. Unit-UI eliminates that duplication.

**`cargo add unit-ui` → you get streaming text, collapsible thinking blocks, tool call cards, diff views, approval prompts, provider logos, status bars, and more — all as composable Ratatui widgets.**

---

## Documentation

| Document | What it covers |
|---|---|
| **[MANIFESTO.md](./MANIFESTO.md)** | Why Unit-UI exists — the problem, the waste, the necessity |
| **[TIERS.md](./TIERS.md)** | Free vs Pro vs Enterprise — what you get, who it's for, pricing |
| **[GUIDE.md](./GUIDE.md)** | Getting started in 5 minutes — installation, examples, architecture |
| **[MONETIZATION.md](./MONETIZATION.md)** | Business model, pricing rationale, go-to-market |
| **[VALIDATION.md](./VALIDATION.md)** | Audit of 10 agent CLIs, widget coverage, user complaints |

---

## The Problem

### Market Context

There are roughly **40+ AI coding agents and CLI assistants** in active development as of mid-2026:

| Category | Examples |
|---|---|
| Major vendor CLIs | Claude Code, Codex CLI, Gemini CLI, ChatGPT Terminal |
| Open source agents | OpenCode, Goose, Aider, Continue.dev Terminal, Shell Agent |
| Specialized tools | Swe-agent, OpenHands CLI, Devika, Smol Developer |
| Proprietary tools | Cursor Terminal, Windsurf CLI, Copilot in terminal |

**Every single one of them** builds a custom terminal UI from scratch. They all need:

- Streaming token output
- Collapsible reasoning/thinking blocks
- Tool call invocation and result cards
- File diff displays with syntax highlighting
- Approval prompts with contextual risk display
- Multi-line input with history
- Status/progress indicators
- Provider/model selection menus

**None of them share UI code.** The result:

- ⏱ **2-4 weeks** per team to build a passable chat TUI
- 🐛 Each team independently rediscovers rendering bugs (scroll, overflow, ANSI escape injection)
- 🎨 UX quality varies wildly — most are functional but ugly
- 🧩 Integration with Ratatui ecosystem is always an afterthought
- 🔄 Switching providers (Anthropic → OpenAI → Google) requires UI rewrites

### Why Rust?

| Concern | Node.js (Ink) | Rust (Ratatui) |
|---|---|---|
| Startup time | 200-800ms (Node init + module resolution) | **5-15ms** |
| Binary size | 50-200MB (with Node runtime or pkg) | **3-8MB** |
| Dependency tree | 500-2000 transitive deps | **50-150** |
| Portability | Requires Node or bundled runtime | **Single static binary** |
| Memory safety | GC pauses, memory spikes | **Zero-cost, deterministic** |
| Cross-compile | Painful without container | **Trivial (cargo build --target)** |

The industry is converging on Rust for CLIs. Claude Code API was rewritten in Rust. Codex CLI uses Rust. Bun uses Zig. The terminal demands speed.

---

## The Solution

### What Unit-UI Is

Unit-UI is a **toolkit** — not a framework, not a starter pack, not a boilerplate generator. You own your architecture.

- **Toolkit** → pick widgets, compose them, wire your own event loop, bring your own provider SDK
- **`cargo add unit-ui`** → add to any existing or new Rust project
- **Individual crate imports** → `use unit_ui::prelude::*;`
- **Zero lock-in** → every widget is a standalone Ratatui `Widget` impl

### Architecture at a Glance

```
┌──────────────────────────────────────────────────────────────┐
│                    YOUR APPLICATION                           │
│  (event loop, provider calls, file ops, state management)    │
├──────────────────────────────────────────────────────────────┤
│                      unit-ui                                  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐        │
│  │Streaming │ │Thinking  │ │ToolCall  │ │DiffView  │        │
│  │Text      │ │Block     │ │Card      │ │          │        │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘        │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐        │
│  │Approval  │ │Provider  │ │Input     │ │StatusBar │        │
│  │Prompt    │ │Selector  │ │          │ │          │        │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘        │
│  ┌──────────┐ ┌──────────┐ ┌─────────────────────┐          │
│  │TaskPanel │ │Agent     │ │Theme / Config Loader │          │
│  │          │ │Switcher  │ │(Unit.toml)           │          │
│  └──────────┘ └──────────┘ └─────────────────────┘          │
├──────────────────────────────────────────────────────────────┤
│                   ratatui (backend)                           │
├──────────────────────────────────────────────────────────────┤
│              crossterm / termion (terminal I/O)               │
└──────────────────────────────────────────────────────────────┘
```

### Widget Composition Model

```
                  ┌─────────────────────────────┐
                  │           App                │
                  │  ┌───────────────────────┐  │
                  │  │      StatusBar         │  │
                  │  │  [claude-sonnet-4]     │  │
                  │  │  tokens: 1,542  $0.02 │  │
                  │  └───────────────────────┘  │
                  │  ┌───────────────────────┐  │
                  │  │   StreamingText        │  │
                  │  │   "Let me analyze..."  │  │
                  │  │                        │  │
                  │  │   ┌─ Thinking ─────┐   │  │
                  │  │   │ The user wants  │   │  │
                  │  │   │ a sort function  │   │  │
                  │  │   └─────────────────┘   │  │
                  │  └───────────────────────┘  │
                  │  ┌───────────────────────┐  │
                  │  │   ToolCall            │  │
                  │  │   ◉ edit_file         │  │
                  │  │   ┌─────────────────┐ │  │
                  │  │   │ path: main.rs   │ │  │
                  │  │   │ content: ...    │ │  │
                  │  │   └─────────────────┘ │  │
                  │  │   ✓ Result: applied   │  │
                  │  └───────────────────────┘  │
                  │  ┌───────────────────────┐  │
                  │  │   ApprovalPrompt      │  │
                  │  │   Apply changes? Y/n  │  │
                  │  │   [diff preview]      │  │
                  │  └───────────────────────┘  │
                  │  ┌───────────────────────┐  │
                  │  │   Input (focused)      │  │
                  │  │   > sort the list by │  │
                  │  └───────────────────────┘  │
                  └─────────────────────────────┘
```

---

## Widget Catalog

### Free Tier (MIT License) — $0

| Widget | Description |
|---|---|
| **StreamingText** | Character-by-character token renderer with word-wrap, cursor animation, completion detection |
| **Spinner** | Activity indicator with multiple frame styles (dots, bar, pulse, custom) |
| **BasicInput** | Single-line text input with editing, clipboard, cursor movement, history |
| **MessageBubble** | Chat message display with role coloring (user/assistant/system/tool) |
| **StatusBar** | Lightweight bar showing active provider, connection status, elapsed time, token count |
| **Unit.toml** | Theme and configuration parser with palette support |

### Pro Tier (Commercial License) — $19/dev/month

| Widget | Description |
|---|---|
| **StreamingText+** | Thinking block integration, collapse/expand animations, ANSI-safe streaming |
| **ThinkingBlock** | Collapsible reasoning section with expand/collapse toggle, word count, timing, animation |
| **ToolCallCard** | Formatted JSON args, expandable results, status badges, timing per tool |
| **DiffView** | Side-by-side or unified with syntax highlighting, line numbers, change counts, hunk nav |
| **ApprovalPrompt** | Yes/no/cancel with context panel, risk level, diff preview, cost estimate, keyboard shortcuts |
| **ProviderSelector** | Grid menu with official ANSI logos (20+ providers), model sub-selection, pricing display |
| **APIKeyInput** | Secure paste, mask/unmask, validation, clipboard integration, env var suggestion |
| **Input+** | Multi-line editor with vim keybindings, history search, @-reference autocomplete |
| **AgentSwitcher** | Tabbed persona switching, per-agent config, session count, memory indicator |
| **TaskPanel** | Plan → step → progress tracking with timing and checkmarks |
| **TerminalGraphics** | Sixel, Kitty, and iTerm2 image rendering protocols |
| **Pre-built layouts** | Chat, IDE, and minimal layouts — one-line setup |

### Enterprise Tier — $499/org/month (flat)

| Feature | Description |
|---|---|
| Everything in Pro | All Pro widgets and layouts |
| SSO / SAML | Okta, Azure AD, Google Workspace, OneLogin |
| Audit logging | Immutable log stream, SIEM integration |
| License management | Centralized seat assignment, usage dashboard |
| Priority support | 4-hour SLA, direct line to maintainers |
| Custom widgets | Bespoke components built for your product |
| Compliance docs | SOC 2, ISO 27001, DPA |

---

## Architecture Deep Dive

### Core Trait Design

```rust
/// Every widget implements this. No framework magic.
pub trait UnitWidget: Widget {
    /// Unique ID for focus management and event routing
    fn id(&self) -> &str;

    /// Whether this widget currently has keyboard focus
    fn focused(&self) -> bool;

    /// Called when the widget receives or loses focus
    fn set_focused(&mut self, focused: bool);

    /// Handle a key event. Returns true if consumed.
    fn handle_key(&mut self, key: KeyEvent) -> bool;

    /// Optional: render a minimal version (for collapsed state)
    fn render_compact(&self, area: Rect, buf: &mut Buffer) { /* default: render full */ }
}
```

### Event Loop Integration (Infrastructure-Free)

Unit-UI does **not** provide an event loop. You bring your own. This is intentional:

```rust
// Your app, your event loop, your provider SDK
fn main() -> Result<()> {
    let terminal = ratatui::init();
    let mut streaming = StreamingText::new();
    let mut input = Input::new();
    let mut status = StatusBar::new()
        .provider("claude-sonnet-4");

    loop {
        terminal.draw(|buf| {
            // Compose widgets however you want — no App struct required
            let chunks = Layout::vertical([Constraint::Fill(1), Constraint::Length(3)]);
            streaming.render(chunks[0], buf);
            input.render(chunks[1], buf);
            status.render(buf.area(), buf);  // overlay or fixed
        })?;

        if let Event::Key(key) = event::read()? {
            // Route events yourself — full control
            if input.focused() && input.handle_key(key) { continue; }
            if streaming.handle_key(key) { continue; }
            match key.code {
                KeyCode::Esc => break,
                _ => {}
            }
        }
    }

    ratatui::restore();
    Ok(())
}
```

### State Management (You Own It)

Unit-UI widgets are **stateless renderers**. They take state as parameters, not as hidden internal mutations:

```rust
// ❌ NOT how Unit-UI works
streaming.append_token("hello");  // hidden mutation

// ✅ How Unit-UI works — you pass state each frame
streaming.render(buf, area, &State {
    content: &chat_history,
    thinking: &thinking_block,
    cursor_pos: cursor_pos,
});
```

This means:
- You control persistence (save/restore threads)
- You control undo/history
- You can serialize/deserialize independently
- Testing is trivial (pure input → output)

### Theming System

```toml
# Unit.toml — shared across unit-ui projects
[theme]
schema = "catppuccin-mocha"           # named palette, or custom below

[theme.colors]
background = "#1e1e2e"
surface    = "#313244"
accent     = "#cba6f7"
text       = "#cdd6f4"
subtext    = "#a6adc8"
error      = "#f38ba8"
warning    = "#fab387"
success    = "#a6e3a1"
info       = "#89b4fa"
code_bg    = "#181825"
selection  = "#585b70"

[theme.typography]
mono_font  = "Iosevka Term"           # for code/diffs
ui_font    = "Inter"                  # for labels

[theme.borders]
style      = "rounded"                # none, plain, rounded, double
color      = "surface"

[widgets.streaming_text]
speed      = "smooth"                 # instant, smooth, character-by-character
thinking   = { default_collapsed = true, show_timer = true }

[widgets.diff_view]
layout     = "side-by-side"           # unified, side-by-side
context_lines = 3
```

### Provider Logo System

One of our most differentiated features. We ship official SVG → ANSI rendering for 50+ providers:

```
   ┌──────────────────────────────────────────────────────┐
   │ Select provider                                       │
   │                                                      │
   │  ┌────┐  ┌────┐  ┌────┐  ┌────┐  ┌────┐  ┌────┐   │
   │  │ ◉◉ │  │  G │  │  O │  │  C │  │ ◇◇ │  │  M │   │
   │  │    │  │    │  │    │  │    │  │    │  │    │   │   │
   │  │An  │  │Gthb│  │Ope │  │Cl  │  │Mis │  │Mtk │   │
   │  │rop │  │ Cop│  │nAI │  │aude│  │tral│  │    │   │   │
   │  └────┘  └────┘  └────┘  └────┘  └────┘  └────┘   │
   │                                                      │
   │  ┌────┐  ┌────┐  ┌────┐  ┌────┐  ┌────┐  ┌────┐   │
   │  │ Ggl│  │ Amz│  │ A21│  │ Crt│  │ Dpr│  │ Fng│   │
   │  │    │  │    │  │    │  │    │  │    │  │    │   │   │
   │  │Gem │  │Bed │  │L21 │  │Cor │  │Dep │  │Fir │   │
   │  │ini │  │roc │  │    │  │tex │  │Sea │  │efx │   │   │
   │  └────┘  └────┘  └────┘  └────┘  └────┘  └────┘   │
   │                                                      │
   └──────────────────────────────────────────────────────┘
```

Logos are rendered as ANSI block art at compile time — zero runtime cost, no image library dependency. Each logo is ~8-12 lines tall, scalable, and themed.

---

## Competitive Landscape

### Direct Comparison

| Dimension | Unit-UI | assistant-ui/react-ink | Chakra UI (for Ink) | Build from scratch |
|---|---|---|---|---|
| **Language** | Rust | TypeScript | TypeScript | Any |
| **Runtime** | Native binary | Node.js | Node.js | Depends |
| **Startup time** | 5-15ms | 200-800ms | 200-800ms | Depends |
| **AI widgets** | 12+ (all tiers) | 4 (Thread, Composer, Message, ToolCall) | 0 | 0 |
| **Streaming text** | ✅ Smooth, ANSI-safe | ✅ Basic | ❌ | Must build |
| **Thinking/reasoning** | ✅ Collapsible, timer | ❌ | ❌ | Must build |
| **Tool call cards** | ✅ Formatted, expandable | ✅ Basic | ❌ | Must build |
| **Diff view** | ✅ Side-by-side, syntax | ❌ | ❌ | Must build |
| **Approval flow** | ✅ Risk context, shortcuts | ❌ | ❌ | Must build |
| **Provider selector** | ✅ SVG logos, pricing | ❌ | ❌ | Must build |
| **API key mgmt** | ✅ Mask/validate/env-var | ❌ | ❌ | Must build |
| **Task panel** | ✅ Plan → step → progress | ❌ | ❌ | Must build |
| **Agent switcher** | ✅ Tabs, per-agent config | ❌ | ❌ | Must build |
| **Terminal graphics** | ✅ (Sixel/Kitty) PRO | ❌ | ❌ | Very hard |
| **Theme system** | ✅ Unit.toml, palettes | ❌ (CSS-in-JS) | ✅ | Must build |
| **License** | MIT + Commercial | MIT | MIT | — |
| **Dependency count** | ~80 (Rust) | ~800+ (npm) | ~1000+ | — |
| **Distribution** | `cargo install` | `npx` or `npm install` | `npm install` | — |

### The Gap Visualized

```
                     AI-Specific Widgets
                              │
                              │     Unit-UI ▲
                              │              │
                              │              │
                     assistant-ui/react-ink │
                              │              │
                              │              │
     (empty) ────────────────┼──────────────┤────▶ Ratatui widgets
                              │              │
                              │   Bubble Tea │
                              │   (Go Bubbles)│
                              │              │
                              │              │
                              ▼              │
                     Generic TUI Frameworks  │
                              │              │
                              │              ▼
                              │       Non-AI Widgets
                              │
```

**Unit-UI is the only Rust+AI-verticalized option.** Every other Rust TUI project (Ratatui, Cursive, tui-rs) has zero AI-specific components. Every AI-verticalized TUI project (assistant-ui/react-ink) is Node.js only.

---

## Moat

### 1. Rust Ecosystem Lock-In

Ratatui has **27M+ downloads** and is the dominant Rust TUI framework. Any team building a Rust CLI agent (which is increasingly the norm) who needs AI-specific widgets has only one choice: Unit-UI. Once you depend on Unit-UI widgets, migrating out means rewriting every widget from scratch.

Every agent CLI in Rust is a potential user:
- **Codex CLI** (Anthropic's open source) — uses Ratatui, no AI widgets
- **OpenCode** — uses OpenTUI, but OpenTUI is Zig core
- **Goose** — Rust-based agent, has basic TUI
- **Swe-agent** — Python (potential `unit-ui` bindings?)
- **Future agents** — every new Rust agent needs these widgets

### 2. Provider SVG Ecosystem

We will build and maintain **official ANSI-rendered logos for 50+ providers**. This is grindy, detail-oriented work that competitors won't invest in. Once teams see their AI provider with official branding in their terminal, switching costs increase.

### 3. Terminal Graphics Protocol

Sixel/Kitty/iTerm2 image support in a terminal AI agent is a **killer feature** for data analysis use cases (charts, screenshots, UI mockups). No other AI TUI library handles this. Implementing terminal graphics is notoriously finicky — we do it so 500 downstream projects don't have to.

### 4. Theming Standard (Unit.toml)

By defining a cross-project theme format (`Unit.toml`), we create a **de facto standard** for agent CLI appearance. Theme designers can publish themes. Tools can share theme files. Catppuccin, Tokyo Night, Nord — one file, every agent tool.

### 5. Dogfooding via UNIT-01

UNIT-01's CLI will be built on Unit-UI. Every bug we fix, every UX improvement we make, every perf optimization — goes straight into the library. We are not a separate team guessing what users need; we are the users.

### 6. Open Core with PRO Lock-In

The free tier is genuinely useful (streaming text, basic input, spinner, message bubble, status bar). But the PRO features (thinking blocks, tool calls, diff views, approval prompts) are the widgets that differentiate professional agent UIs. Once a team adopts Unit-UI free and their users expect thinking blocks and diff views, upgrading to PRO is frictionless.

### 7. Distribution Model

`cargo install unit-ui` → instant. No Node.js. No Docker. No Python venv. No version manager required. A single 5MB binary. For CLI developers, every MB and every millisecond of startup time matters. This is a genuine technical advantage over the JS ecosystem.

---

## Roadmap

### Phase 1: Foundation (Q3 2026 — Current)

```
████████████░░░░░░░░░░░░░░░░░░░░░░░░░░  ~30%
```

- [x] Product research and spec
- [ ] Crate scaffolding (`unit-ui-core`, `unit-ui-widgets`)
- [ ] `StreamingText` widget (smooth, ANSI-safe)
- [ ] `Spinner` widget (multiple frame styles)
- [ ] `BasicInput` widget
- [ ] `MessageBubble` widget
- [ ] `StatusBar` widget (lightweight)
- [ ] Theme system (Unit.toml parser)
- [ ] Ratatui 0.30+ compatibility
- [ ] GitHub repo, CI, example app
- [ ] `cargo publish` v0.1.0

**Target: Late Q3 2026**

### Phase 2: Pro Launch (Q4 2026)

```
░░░░░░░░░░░░████████░░░░░░░░░░░░░░░░░░  ~20%
```

- [ ] `ThinkingBlock` — collapsible, animated
- [ ] `ToolCallCard` — args, result, timing
- [ ] `DiffView` — side-by-side, syntax highlight, hunk nav
- [ ] `ApprovalPrompt` — Y/n, risk context, keyboard shortcut
- [ ] `ProviderSelector` — grid menu with official ANSI logos (20 providers)
- [ ] `APIKeyInput` — secure paste, mask, validate, env var suggestion
- [ ] Pro license model (crates.io + private registry or feature gate)
- [ ] Starter template 1: `basic-agent` (cargo generate)
- [ ] Documentation site (docs.unit-ui.dev)

### Phase 3: Multi-Agent & Graphics (Q1 2027)

```
░░░░░░░░░░░░░░░░░░░░████████░░░░░░░░░░  ~15%
```

- [ ] `TaskPanel` — plan → step → progress tracking
- [ ] `AgentSwitcher` — persona tabs, per-agent config
- [ ] `Input+` — multi-line, vim bindings, history, @-references
- [ ] Terminal graphics protocol (Sixel/Kitty/iTerm2)
- [ ] Provider logos expanded to 50+
- [ ] Starter template 2: `pro-agent` (PRO scaffolding)
- [ ] Integration guide: Claude Code API, OpenAI SDK, Google SDK
- [ ] Discord / community

### Phase 4: Ecosystem (Q2 2027+)

```
░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░████░░  ~5%
```

- [ ] Plugin system (custom widgets from third parties)
- [ ] Theme gallery / marketplace
- [ ] Python bindings (PyO3) for Python agents
- [ ] WebAssembly target (browser-based terminal demos)
- [ ] VS Code terminal overlay integration
- [ ] Telemetry / opt-in usage analytics (PRO)
- [ ] Enterprise SSO / audit logging (PRO)

---

## Monetization Strategy

### Free Tier (MIT)

```
┌────────────────────────────────────────────────────────────────┐
│ FREE (MIT)                                                     │
│                                                                │
│  StreamingText    Spinner    BasicInput    MessageBubble       │
│  StatusBar        Theme system    Unit.toml parser             │
│  Single-provider workflows                                     │
│                                                                │
│  ▶ Goal: Adoption. Every Rust agent CLI starts here.            │
│  ▶ Viral: "Check out this agent I built" → repo uses unit-ui   │
│  ▶ We get: GitHub stars, crate downloads, community PRs         │
│  ▶ User gets: 80% of what they need for basic agent chat        │
└────────────────────────────────────────────────────────────────┘
```

### Pro Tier (Commercial License)

```
┌────────────────────────────────────────────────────────────────┐
│ PRO ($19/dev/month or $190/dev/year)                            │
│                                                                │
│  ThinkingBlock    ToolCallCard    DiffView    ApprovalPrompt   │
│  ProviderSelector (official logos!)    APIKeyInput    Input+   │
│  AgentSwitcher    TaskPanel    Terminal Graphics (Sixel/Kitty) │
│  Pre-built layouts                                              │
│                                                                │
│  ▶ Why pay: These widgets separate "works" from "ships."       │
│    Your users expect thinking blocks, diff views, and           │
│    approval prompts. Without them, your CLI looks amateur.      │
│  ▶ Validated pricing: $15-49/dev/mo is the market range         │
│    (MUI X, CodeRabbit, Bito). At $19/mo we undercut             │
│    MUI X Premium ($49) while exceeding MUI X Pro ($15).         │
│  ▶ Build cost: 10 weeks / $51K to build from scratch.          │
│    Pro pays for itself in the first hour it saves.              │
└────────────────────────────────────────────────────────────────┘
```

### Open Source vs Paid Boundary

The cut is not arbitrary — it follows the **Indie Maker's Maxim**: "Charge for the things that are valuable to companies, give away the things that are valuable to individuals."

- **Individual hackers** building a personal agent assistant: Free tier is sufficient
- **Startups** shipping a commercial agent product: They need thinking blocks, diff views, provider logos, approval prompts — PRO features
- **Enterprise** deploying agents to teams: They need SSO, audit, compliance — enterprise tier

### Distribution Channels

| Channel | Strategy |
|---|---|
| **crates.io** | `cargo add unit-ui` for free; PRO via feature flag + license key |
| **GitHub** | Open source repo, MIT license for free tier, source-available for PRO |
| **Docs site** | docs.unit-ui.dev with interactive examples |
| **Twitter/X** | Build in public, widget previews, perf comparisons |
| **Reddit (r/rust)** | Launch post: "27M Ratatui downloads and nobody built AI widgets" |
| **HN** | Launch with focus on the problem: "Every agent CLI rebuilds the same UI" |
| **Conferences** | RustConf, EuroRust — talk: "Building Agent CLIs in Rust" |
| **UNIT-01 dogfooding** | "UNIT-01's CLI is built on Unit-UI" → cross-sell |

---

## Quick Start

### Installation

```bash
# Add to your Rust project
cargo add unit-ui

# Or clone the starter template
cargo install cargo-generate
cargo generate unit-ui/templates/basic-agent
```

### Minimal Chat App

```rust
use unit_ui::prelude::*;
use ratatui::{Frame, Terminal, layout::*, widgets::*};

fn main() -> color_eyre::Result<()> {
    let terminal = ratatui::init();
    let mut streaming = StreamingText::new()
        .speed(Speed::Smooth)
        .thinking(ThinkingBlock::new().collapsed());
    let mut status = StatusBar::new()
        .provider("claude-sonnet-4");

    loop {
        terminal.draw(|frame| {
            let [chat_area, status_area] =
                Layout::vertical([Fill(1), Length(1)])
                    .areas(frame.area());
            streaming.render(chat_area, frame.buffer_mut());
            status.render(status_area, frame.buffer_mut());
        })?;

        if let Event::Key(key) = event::read()? {
            if key.code == KeyCode::Esc { break; }
        }
    }

    ratatui::restore();
    Ok(())
}
```

---

## FAQ

### Is Unit-UI a framework?

**No.** It's a toolkit — individual widgets you compose how you want. You bring your own event loop, state management, provider SDK, and async runtime. Unit-UI is `cargo add` and use, not `cargo new` and obey.

### Do I need Ratatui experience?

Basic familiarity with Ratatui's `Widget` trait helps, but you can learn as you go. Every widget in Unit-UI implements the standard `Widget` trait — no custom rendering pipeline.

### Can I use Unit-UI with non-AI CLIs?

You can, but that's not the focus. `StreamingText` is useful for any streaming output (logs, build output). `DiffView` is useful for any VCS interaction. But the library is optimized for agent interfaces.

### How is this different from just copying the streaming chat from OpenCode/Codex?

1. You could copy their code, but then you're maintaining a fork forever
2. Their code is coupled to their specific state management and event loop
3. Unit-UI widgets are standalone, generic, well-tested, and documented
4. Unit-UI PRO features (thinking blocks, provider logos, diff views) are not available in any open source agent CLI

### What about Bubble Tea/Go ecosystem?

Bubble Tea's [Bubbles](https://github.com/charmbracelet/bubbles) is the closest analogy — a component library for a TUI framework. But Bubbles has no AI-specific components either. If we were in Go, Unit-UI would be the same idea. The gap exists across all ecosystems — we're filling it in Rust first.

### When does the PRO tier launch?

Targeting Q4 2026 alongside v0.2.0. The free tier ships in Q3 2026 (v0.1.0).

### How do I get early access?

Join the [waitlist](https://unit-ui.dev) (coming soon) or follow [@unit_ui](https://x.com/unit_ui) on X.

---

## About UNIT

Unit-UI is developed by the team behind [UNIT-01](https://unit-01.dev) — the open-source sovereign agent engine, and [Sandbox MCP](https://sandbox-mcp.dev) — the secure execution layer for MCP servers.

| Product | Role |
|---|---|
| **UNIT-01** | The brain — agent engine with any LLM, any tool |
| **Sandbox MCP** | The muscle — secure containerized execution |
| **Unit-UI** | The face — terminal interface components |

Together: a full-stack platform for building, running, and interfacing with AI agents in the terminal.

---

*Unit-UI. Stop rebuilding the terminal. Start shipping agents.*
