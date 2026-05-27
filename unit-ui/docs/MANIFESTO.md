# Manifesto: Stop Rebuilding the Terminal

## Every Agent CLI Builds the Same UI From Scratch. That Has to End.

There are 40+ AI coding agents and CLI assistants in active development as of mid-2026. Claude Code, Codex CLI, Gemini CLI, Antigravity, OpenCode, Kiro, Qwen CLI, Goose, Aider, Swe-agent — and dozens more launching every quarter.

Every single one of them builds a custom terminal UI from scratch.

We audited 10 of the most popular tools across 4 programming languages and 5 TUI frameworks. Every one implements **the same 8-10 widgets** — streaming text, thinking blocks, tool call cards, diff views, approval prompts, status bars, multi-line input, provider selectors — independently, from scratch, with the same bugs, the same regressions, and the same user complaints.

**That's ~133,000 lines of duplicated code solving the same problems. At $1,000/day engineering cost, that's $15-25M of wasted effort.**

And the market is growing exponentially. By 2027 there will be ~80 agent CLIs. The waste is accelerating.

---

## The Problem Goes Deeper Than Duplication

### Every Team Rediscovers the Same Bugs

We scraped GitHub issues, HN threads, and Reddit across all 10 tools. The same complaints appear in every repo:

| Complaint | Appears in | Root Cause |
|---|---|---|
| Thinking blocks collapse too fast | Claude Code, Gemini CLI, Kiro CLI | Every team builds their own collapse logic |
| Terminal flicker during streaming | Claude Code, Codex CLI, Qwen CLI, Kiro CLI | Every team builds their own render loop |
| CJK/IME input broken | Claude Code, Kiro CLI, Gemini CLI | Every team builds their own input handler |
| No theming / can't customize colors | Claude Code, Codex CLI | Every team builds their own style system |
| Raw thought tokens leaking to output | Gemini CLI | Every team builds their own parser |
| No provider logos / text-only menus | ALL 10 TOOLS | No one invests in this because it's grindy |

**These bugs are not inevitable. They are the cost of rebuilding.**

### The Quality Gap Between "Good Enough" and "Professional"

Look at any open-source agent CLI. The streaming works. The chat functions. But compare it to Claude Code's UI — the polish gap is obvious:

- **Hobby level:** Raw JSON tool calls, no collapse on thinking blocks, plain text provider names
- **Professional level:** Formatted tool call cards, animated thinking block collapse, official provider logos in the selector

The difference is 4-8 weeks of engineering time that most teams don't have.

### The "Build vs Buy" Math Doesn't Favor Building

| Widget | Days to Build | Cost at $1,000/day |
|---|---|---|
| StreamingText | 5 days | $5,000 |
| ThinkingBlock | 4 days | $4,000 |
| ToolCallCard | 6 days | $6,000 |
| DiffView | 8 days | $8,000 |
| ApprovalPrompt | 4 days | $4,000 |
| ProviderSelector | 5 days | $5,000 |
| APIKeyInput | 3 days | $3,000 |
| Input+ (multi-line) | 6 days | $6,000 |
| Terminal Graphics | 10 days | $10,000 |
| **Total** | **51 days** | **$51,000** |

**That's 10 weeks of one engineer. Or $19/month for Pro.**

At $19/dev/month, a team would need to subscribe for **224 years** to equal the build cost. This is not a hard sell.

---

## What the Ecosystem Gets Wrong

### "We'll just use Ink/React"

6 of the 10 tools use React + Ink. Yet:
- Claude Code **forked Ink** (251KB custom renderer) because the OSS version couldn't handle their requirements
- Codex CLI **rewrote from Ink to Ratatui** due to performance issues
- Every Ink tool independently builds streaming text, thinking blocks, tool calls, diff views, and approval prompts

Ink gives you a renderer. It does NOT give you any AI-specific components. Every team still builds the same 8 widgets.

### "We'll just copy from an open-source agent"

This is what teams actually do. They copy Codex CLI's streaming text, adapt OpenCode's diff view, cobble together a status bar. Then they maintain a fork forever. When the upstream fixes a bug, they miss it. When they discover a rendering glitch, they fix it alone.

**Copying is not sharing. It's inherited maintenance debt.**

### "The widgets are simple, we'll just build them"

They look simple. Streaming text is "just print tokens to the screen." A thinking block is "just a collapsible div." A diff view is "just show git diff."

Then you discover:
- Streaming text needs ANSI-safe parsing, word-wrap at character boundaries, cursor animation, completion detection
- Thinking blocks need expand/collapse animations, timer display, word count, scroll preservation
- Diff views need syntax highlighting, line numbers, hunk navigation, side-by-side layout, change counts
- Approval prompts need keyboard shortcuts, risk level calculation, diff preview, cost estimate

Each widget is a rabbit hole. We've already dug all of them.

---

## The Solution: Unit-UI

**Unit-UI is a Rust toolkit of drop-in Ratatui widgets for building agent CLIs.** You `cargo add unit-ui` and get streaming text, thinking blocks, tool call cards, diff views, approval prompts, provider logos, and more — all as composable widgets that implement the standard Ratatui `Widget` trait.

Not a framework. Not a starter pack. Not a boilerplate generator. **A toolkit.** You own your architecture, your event loop, your state management, your provider SDK. We just give you the UI components that every agent needs.

### The Free Tier (MIT) — The No-Brainer

Every Rust agent CLI starts here:

- **StreamingText** — Character-by-character token renderer with word-wrap, cursor animation
- **Spinner** — Activity indicator with multiple frame styles
- **BasicInput** — Single-line text input with editing, clipboard, cursor movement
- **MessageBubble** — Chat message display with role coloring
- **StatusBar** — Lightweight provider and connection status
- **Theme system** — Unit.toml configuration

**Free means free.** MIT license. No restrictions. No feature flags. No "upgrade now" nagging. We want every agent CLI in the Rust ecosystem to start with Unit-UI.

### The Pro Tier (Commercial) — The Upgrade That Pays for Itself

The widgets that separate professional products from hobby projects:

- **ThinkingBlock** — The #1 requested feature across every agent CLI. Collapsible, animated, timer.
- **ToolCallCard** — Formatted JSON args, expandable results, status badges, timing. Makes your CLI look premium vs. raw JSON.
- **DiffView** — Side-by-side or unified with syntax highlighting, line numbers, hunk navigation. The make-or-break for code agents.
- **ApprovalPrompt** — Y/n with context panel, risk level, diff preview, keyboard shortcuts. Required for production safety.
- **ProviderSelector** — Grid menu with official ANSI logos for 20+ providers. Model sub-selection. Pricing display.
- **APIKeyInput** — Secure paste, mask/unmask, validation, env var suggestion. Enterprise-grade credential handling.
- **Input+** — Multi-line editor with vim keybindings, history search, @-references. Power user input.
- **AgentSwitcher** — Tabbed persona switching with per-agent config, session count, memory indicator.
- **TaskPanel** — Plan → step → progress tracking with timing and checkmarks.
- **TerminalGraphics** — Sixel/Kitty/iTerm2 image rendering for data analysis, charts, UI mockups.

**$19/dev/month.** Less than one hour of an engineer's time. Less than a SaaS subscription. Less than a coffee run for the team.

### The Enterprise Tier — For Organizations

- Everything in Pro
- SSO/SAML authentication
- Audit logging (who used which widget in which project)
- Centralized license management
- Priority support with SLA
- Custom widget development
- Compliance documentation

**$499/org/month flat.** Not per-seat. For a 50-person team, that's $10/person/month. Compare to GitLab Ultimate at $39/seat.

---

## Why Rust? Why Now?

The industry is converging on Rust for CLIs:

- Claude Code's API server: Rust
- Codex CLI: Rust + Ratatui
- Goose: Dual stack (Ink + Ratatui, moving to Rust)
- Kiro: Core engine in Rust, TUI on Bun
- Ratatui: 27M+ downloads, dominant Rust TUI framework

**There are zero AI-specific widgets in the entire Ratatui ecosystem.** Not one. The gap is wide open.

Every new Rust agent CLI built today will need streaming text, thinking blocks, tool call cards, diff views, approval prompts, and provider selectors. They can build them from scratch (51 days, $51K) or `cargo add unit-ui` (5 minutes, $19/mo for Pro).

---

## The Moat

**Rust ecosystem lock-in:** Ratatui has 27M+ downloads. Any team building a Rust CLI agent who needs AI widgets has one choice: Unit-UI. Once you depend on our widgets, migrating out means rewriting everything from scratch.

**Provider SVG ecosystem:** We'll maintain official ANSI-rendered logos for 50+ providers. Grindy, detail-oriented work that competitors won't invest in. Once teams see their provider with official branding in their terminal, switching costs increase.

**Terminal graphics:** Sixel/Kitty/iTerm2 image support in a terminal AI agent is a killer feature for data analysis. No other AI TUI library handles this. Implementing terminal graphics is notoriously finicky — we do it so 500 downstream projects don't have to.

**Dogfooding via UNIT-01:** Our own agent CLI is built on Unit-UI. Every bug we fix, every UX improvement we make, every perf optimization goes straight into the library. We are not guessing what users need — we are the users.

**First-mover in a growing market:** ~40 agent CLIs now, ~80 projected by 2027. Every one that doesn't use Unit-UI is another 5,000+ lines of duplicated, buggy, throwaway code.

---

## The Ask

If you're building an agent CLI in Rust:

1. **`cargo add unit-ui`** — start with the free tier. Streaming text, spinner, input, message bubble, status bar. All MIT, all free.
2. **When you need thinking blocks, diff views, approval prompts, or provider logos** — `cargo add unit-ui --features pro`. $19/dev/month. Less than an hour of your time.
3. **When your org needs SSO, audit, and compliance** — Enterprise at $499/org/month. Flat rate, not per-seat.

Stop rebuilding the terminal. Start shipping agents.

---

*Unit-UI is developed by the team behind UNIT-01 — the open-source sovereign agent engine, and Sandbox MCP — the secure execution layer for MCP servers.*

*[unit-ui.dev](https://unit-ui.dev) · [GitHub](https://github.com/unit-ui) · [crates.io](https://crates.io/crates/unit-ui)*
