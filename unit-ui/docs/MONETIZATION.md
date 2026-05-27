# Unit-UI: Monetization Strategy

**How we categorize, price, and sell terminal widgets — and who pays.**

---

## Part 1: The Monetization Landscape

### Model Taxonomy for Component Libraries

There are 5 proven monetization models for open-source component libraries. Here they are, ranked by relevance to Unit-UI:

```
                         CONTROL vs REVENUE
                              │
         LOW CONTROL     ─────┼─────    HIGH CONTROL
         HIGH REVENUE          │          HIGH REVENUE
                              │
     ┌───────────────────────┬───────────────────────────┐
     │                       │                           │
     │  ① Donations          │  ③ Open Core              │
     │  GitHub Sponsors      │  Free MIT + Paid Pro      │
     │  Open Collective      │  MUI X: $15-49/dev/mo     │
     │  ~$0-500/mo           │  Chakra: $29-249/dev/mo   │
     │                       │  shadcnblocks: $149-399    │
     │                       │  *** THIS IS US ***       │
     ├───────────────────────┼───────────────────────────┤
     │                       │                           │
     │  ② SaaS Wrapper       │  ④ Dual License           │
     │  Free core +          │  GPL + Commercial          │
     │  paid cloud           │  Qt: $350/dev/mo          │
     │  differentiator       │  AGPL: forces payment      │
     │  not applicable       │  too restrictive for us    │
     │  (we're a library)    │                           │
     ├───────────────────────┼───────────────────────────┤
     │                       │                           │
     │  ⑤ Consulting/Support │                           │
     │  Training, custom     │                           │
     │  widgets, migration   │                           │
     │  $150-250/hr          │                           │
     │  scales poorly        │                           │
     └───────────────────────┴───────────────────────────┘
                              │
         LOW CONTROL          │          HIGH CONTROL
         LOW REVENUE          │          LOW REVENUE
                              │
```

**Verdict: Model ③ (Open Core) is the proven path.** Every successful component library uses it. The free tier drives adoption; the Pro tier captures value from companies that need advanced features.

### Real-World Pricing Comparables

| Company | Product | Free Tier | Pro Pricing | Model |
|---|---|---|---|---|
| **MUI** | Data Grid, Date Pickers, Charts | MIT core components | $15/dev/mo Pro, $49/dev/mo Premium | Open Core |
| **Chakra UI** | React component library | MIT | $29-249/dev/mo Pro templates | Open Core |
| **Aceternity UI** | Animated React components | 200+ free components | $199 one-time All-Access | Open Core |
| **shadcnblocks** | shadcn/ui blocks | Limited free blocks | $149-399 one-time | Open Core |
| **Preline UI** | Tailwind components | 944 free components | $99+ Pro | Open Core |
| **Tailwind UI** | Tailwind component templates | Nothing free | $299-599 one-time | Paid-only |
| **Radix UI** | Headless primitives | All free (MIT) | — (funded by WorkOS) | Free |
| **Qt** | C++ GUI framework | GPL | $350/dev/mo commercial | Dual License |
| **GitLab** | DevOps platform | CE (free) | $39/user/mo Ultimate | Open Core |

**Unit-UI runs in the same lane as MUI, Chakra, Aceternity, and shadcnblocks.** The patterns are proven. The only difference: our components live in the terminal, not the browser.

---

### The MUI X Playbook (Our Closest Analogue)

MUI X is the best reference because it matches our structure exactly:

```
MUI Core (MIT)                    Unit-UI Core (MIT)
├── Button                        ├── StreamingText
├── TextField                     ├── Spinner
├── Select                        ├── BasicInput
├── Modal                         ├── MessageBubble
├── ...                           └── StatusBar

MUI X Pro ($15/dev/mo)            Unit-UI Pro ($19/dev/mo)
├── DataGrid (sort, filter)       ├── ThinkingBlock
├── DatePicker (range)            ├── ToolCallCard
├── Charts (basic)                ├── DiffView
└── ...                           ├── ApprovalPrompt
                                  ├── ProviderSelector
MUI X Premium ($49/dev/mo)        └── APIKeyInput
├── DataGrid Premium (grouping)
├── Charts Premium                Future: Terminal Graphics
└── ...                           
```

**MUI X ARR: ~$8-12M.** Single product, open-core widget library, dev/mo pricing. This is the proof.

---

## Part 2: Unit-UI Widget Categorization

### Free Tier (MIT) — The Adoption Engine

Features that individual developers need to build a basic agent CLI:

```
┌────────────────────────────────────────────────────────────────────┐
│ FREE (MIT) — no payment, no license check, no restrictions         │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│  Widget              │ Why it's free                               │
│──────────────────────┼─────────────────────────────────────────────│
│  StreamingText       │ Absolute baseline — no CLI works without it │
│  Spinner             │ Trivial to implement, standard pattern      │
│  BasicInput          │ Single-line input, minimal features         │
│  MessageBubble       │ Role-colored container, basic               │
│  StatusBar           │ Lightweight, single-provider display        │
│  Unit.toml parser    │ Config loading — must be open               │
│  Theme system        │ Base palette loading                        │
│                                                                    │
│  DEMOGRAPHIC: Individual developers, open-source projects,         │
│  hobby agents, personal assistants.                                │
│                                                                    │
│  GOAL: Maximum adoption. Every Rust agent CLI starts here.         │
│  Viral loop: "Check out my agent" → repo uses unit-ui              │
│  → maintainer sees it → PRO consideration.                         │
│                                                                    │
│  UPGRADE TRIGGER: Hitting limitations of basic input, no           │
│  thinking blocks, no tool visualization → "I need PRO."            │
└────────────────────────────────────────────────────────────────────┘
```

### Pro Tier (Commercial License) — The Revenue Engine

Features that distinguish professional products from hobby projects:

```
┌────────────────────────────────────────────────────────────────────┐
│ PRO (Paid) — per-developer monthly or annual subscription           │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│  Widget              │ Value Prop                                   │
│──────────────────────┼─────────────────────────────────────────────│
│  ThinkingBlock       │ Collapsible, animated, timer — the #1       │
│                      │ requested feature across ALL agent CLIs     │
│──────────────────────┼─────────────────────────────────────────────│
│  ToolCallCard        │ Formatted args, expandable result, status   │
│                      │ badges, timing — makes CLI look               │
│                      │ professional vs. raw JSON                    │
│──────────────────────┼─────────────────────────────────────────────│
│  DiffView            │ Side-by-side, syntax highlighted, hunk nav  │
│                      │ — the make-or-break for code agents         │
│──────────────────────┼─────────────────────────────────────────────│
│  ApprovalPrompt      │ Y/n with context panel, risk level,         │
│                      │ diff preview, keyboard shortcuts —          │
│                      │ required for production safety              │
│──────────────────────┼─────────────────────────────────────────────│
│  ProviderSelector    │ Grid menu with official ANSI logos,         │
│                      │ model sub-selection, pricing — premium      │
│                      │ visual polish for multi-provider tools      │
│──────────────────────┼─────────────────────────────────────────────│
│  APIKeyInput         │ Secure paste, mask/unmask, validate,        │
│                      │ env var suggestion — enterprise-grade       │
│──────────────────────┼─────────────────────────────────────────────│
│  Input+              │ Multi-line, vim keybindings, history         │
│                      │ search, @-references — power users         │
│──────────────────────┼─────────────────────────────────────────────│
│  AgentSwitcher       │ Tabbed persona switching, per-agent config   │
│                      │ — for teams running multiple agents         │
│──────────────────────┼─────────────────────────────────────────────│
│  TaskPanel           │ Plan → step → progress — professional UX   │
│──────────────────────┼─────────────────────────────────────────────│
│  Pre-built layouts   │ chat, IDE, minimal — immediate shipping     │
│──────────────────────┼─────────────────────────────────────────────│
│  Terminal Graphics   │ Sixel/Kitty/iTerm2 — technical moat         │
│  (Sixel/Kitty)       │ nobody else has this                        │
│                                                                    │
│  DEMOGRAPHIC: Startups building commercial agent products,         │
│  internal tool teams, open-source projects with funding.           │
│                                                                    │
│  GOAL: Revenue. $19/dev/mo is < 1 hour of an engineer's time.     │
│  The PRO widgets save 4-8 weeks of building. That's $15K-30K.     │
│  $19/mo is noise in that equation.                                 │
└────────────────────────────────────────────────────────────────────┘
```

### Enterprise Tier — The Scale Engine

Features for organizations with compliance, SSO, and admin needs:

```
┌────────────────────────────────────────────────────────────────────┐
│ ENTERPRISE — per-organization, annual contract                      │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│  Feature              │ Value Prop                                  │
│───────────────────────┼────────────────────────────────────────────│
│  SSO / SAML           │ Mandatory for enterprise deployment         │
│  Audit logging        │ Who used which widget in which project      │
│  License management   │ Centralized dev seat management             │
│  Priority support     │ SLA-backed, direct line to maintainers      │
│  Custom widgets       │ Bespoke components for their product        │
│  Compliance docs      │ SOC2, ISO27001 artifacts                    │
│  Source access        │ Full source code escrow                     │
│                                                                    │
│  DEMOGRAPHIC: Fortune 500, regulated industries (finance,           │
│  healthcare, defense), mega-corps deploying agents at scale.       │
│                                                                    │
│  GOAL: High-ACV contracts ($5K-50K/yr). Even 5-10 enterprise       │
│  customers = six-figure ARR.                                       │
└────────────────────────────────────────────────────────────────────┘
```

---

## Part 3: Why the Cut Line is Right

### The "Indie Maker's Principle"

The free/Pro cut line follows one rule:

> **Charge for things that are valuable to companies. Give away things that are valuable to individuals.**

```
Individual Hackers                          Companies
     │                                          │
     │   StreamingText ◄────────────────────────►│ (table stakes)
     │   Spinner      ◄────────────────────────►│ (table stakes)
     │   BasicInput   ◄────────────────────────►│ (table stakes)
     │   StatusBar    ◄────────────────────────►│ (table stakes)
     │                                           │
     │   ──────── CUT LINE ─────────────────►    │
     │                                           │
     │                     ThinkingBlock ◄───────│ (professional UX)
     │                     ToolCallCard  ◄───────│ (professional UX)
     │                     DiffView      ◄───────│ (production need)
     │                     ApprovalPrompt ◄──────│ (enterprise safety)
     │                     ProviderSelector ◄────│ (polish/branding)
     │                     APIKeyInput    ◄──────│ (security)
     │                     Input+         ◄──────│ (power user)
     │                     AgentSwitcher  ◄──────│ (team workflow)
     │                     TaskPanel      ◄──────│ (project management)
     │                     TerminalGraphics ◄────│ (data analysis)
```

**An individual hacker building a personal assistant:** Free tier is sufficient. They don't need thinking blocks, diff views, or approval prompts. They chat with their agent.

**A startup shipping a commercial agent CLI:** They need all of it. Their users expect thinking blocks, diff views, approval prompts. Without these, their product looks amateur.

**An enterprise deploying agents to their engineering team:** They need SSO, audit logs, priority support. They'll pay $499/mo without blinking.

### The "If You Can't Build It Yourself" Principle

Each Pro widget represents 3-8 days of engineering time:

| Widget | Days | Cost | One-time vs $19/mo |
|---|---|---|---|---|
| ThinkingBlock | 4 | $4,000 | 210 months of PRO |
| ToolCallCard | 6 | $6,000 | 316 months of PRO |
| DiffView | 8 | $8,000 | 421 months of PRO |
| ApprovalPrompt | 4 | $4,000 | 210 months of PRO |
| ProviderSelector | 5 | $5,000 | 263 months of PRO |
| APIKeyInput | 3 | $3,000 | 158 months of PRO |
| Input+ | 6 | $6,000 | 316 months of PRO |
| TerminalGraphics | 10 | $10,000 | 526 months of PRO |
| **Total** | **46** | **$46,000** | **2,421 months of PRO** |

**At $19/dev/mo, a team would need to subscribe for 202 years to equal the cost of building these widgets once.** This is the value proposition.

---

## Part 4: Implementation

### Technical Approach: Cargo Feature Gates

```toml
# Cargo.toml
[features]
default = []
pro = ["dep:unit-ui-pro-license"]

[dependencies]
unit-ui-pro-license = { version = "1", optional = true }

[dependencies.unit-ui-core]
path = "core"
package = "unit-ui-core"

[dependencies.unit-ui-pro]
path = "pro"
package = "unit-ui-pro"
optional = true
```

```rust
// src/lib.rs — Free tier re-exports
pub mod widgets {
    mod streaming_text;
    mod spinner;
    mod basic_input;
    mod message_bubble;
    mod status_bar;

    #[cfg(feature = "pro")]
    mod thinking_block;
    #[cfg(feature = "pro")]
    mod tool_call_card;
    #[cfg(feature = "pro")]
    mod diff_view;
    #[cfg(feature = "pro")]
    mod approval_prompt;
    #[cfg(feature = "pro")]
    mod provider_selector;
    #[cfg(feature = "pro")]
    mod api_key_input;
}
```

**Usage:**

```bash
# Free (MIT) — no license key needed
cargo add unit-ui

# Pro — requires license key
cargo add unit-ui --features pro
UNIT_UI_LICENSE=xxxxx cargo build
```

### License Enforcement

We use a lightweight license key system:

1. **License key format:** JWT signed with our private key, containing `{ dev_count, expires_at, org, tier }`
2. **Validation:** At compile time via `build.rs`, the key is checked against the public key embedded in the crate
3. **Feature gate:** Pro modules only compile when a valid license key is present
4. **No phoning home:** License validation is offline — no network calls, no telemetry server
5. **Leak prevention:** Pro source is in a separate private crate (`unit-ui-pro`) pulled in via the `pro` feature

### Distribution

```
crates.io
├── unit-ui (MIT)
│   ├── StreamingText, Spinner, BasicInput, MessageBubble, StatusBar
│   └── Theme system, Unit.toml parser
│
├── unit-ui-pro (Commerical, private registry)
│   ├── ThinkingBlock, ToolCallCard, DiffView, ApprovalPrompt
│   ├── ProviderSelector, APIKeyInput, Input+
│   ├── AgentSwitcher, TaskPanel
│   └── TerminalGraphics (Sixel/Kitty)
│
└── unit-ui-enterprise (Commerical, private registry)
    ├── SSO/SAML, Audit logging, License management
    └── Priority support, Custom widget service
```

**Free crate:** Published to crates.io. Fully open source. MIT license. Any Rust developer can `cargo add unit-ui`.

**Pro crate:** Published to a private registry (or bundled as a workspace dependency). Customers get access after purchase. Source-available (can inspect, can't redistribute).

### Pricing

| Tier | Price | Target | Est. Addressable Market |
|---|---|---|---|
| **Free** | $0 | Everyone | All Rust developers building terminal apps |
| **Pro** | $19/dev/mo ($190/yr) | Startups, commercial products | ~500-2,000 teams x $2,280/yr = $1.1-4.6M |
| **Enterprise** | $499/org/mo ($5,988/yr) | Large organizations | ~50-200 orgs x $5,988/yr = $300K-1.2M |

**Conservative Year 1 Target:** 30 Pro subscribers + 3 Enterprise = ~$14.5K/mo ($174K ARR)

**Stretch Year 3 Target:** 500 Pro + 20 Enterprise = ~$19.5K/mo ($234K ARR)

---

## Part 5: Category Summary

### What Unit-UI Is (Category Classification)

```
        TERMINAL UI
            │
    ┌───────┴───────┐
    │               │
  Framework      Toolkit
  (Ratatui,      (Unit-UI)
   Ink,
   Bubble Tea)       │
               ┌────┴────┐
               │         │
           General    Domain-
           Widgets    Specific
           (Buttons,  (AI Agent)
            Inputs,    │
            Layouts)   │
                  ┌────┴────┐
                  │         │
              Free Tier  Pro Tier
              (MIT)      (Commercial)
```

**Unit-UI is a Domain-Specific Widget Toolkit for Terminal AI Agents, monetized through Open Core.**

- Not a framework (you own your architecture)
- Not a starter pack (you compose widgets, not clone a template)
- Not SaaS (no cloud, no API, no monthly usage fees)
- **A Rust crate** — `cargo add`, compile, ship

### The 3 Monetization Buckets

```
                  ┌─────────────────────────────┐
                  │      Unit-UI Revenue         │
                  │                              │
     ┌────────────┼─────────────────────────────┤
     │            │                             │
      │  70% Pro   │  $19/dev/mo subscription    │
     │            │  Self-serve, credit card     │
     │            │  Primary revenue driver      │
     │            │                             │
     ├────────────┼─────────────────────────────┤
     │            │                             │
     │  25% Ent.  │  $499/org/mo annual contract │
     │            │  Sales-assisted              │
     │            │  SSO, audit, compliance      │
     │            │                             │
     ├────────────┼─────────────────────────────┤
     │            │                             │
     │   5% Other │  Sponsors, consulting,       │
     │            │  custom widget development   │
     │            │  Supplemental only           │
     └────────────┴─────────────────────────────┘
```

---

## Part 6: Go-To-Market

### Audience Segments

| Segment | Size | Message | Channel |
|---|---|---|---|
| **Rust developers building agent CLIs** | ~2,000 teams | "Stop rebuilding the same widgets. `cargo add unit-ui`." | crates.io, r/rust, RustConf |
| **Startups shipping agent products** | ~200 companies | "Your CLI needs thinking blocks and diff views. 2 days to integrate vs 6 weeks to build." | HN, Twitter, YC |
| **Open source agent projects** | ~40 projects | "Aider, OpenCode, Goose — all rebuilding the same UI. Contribute to Unit-UI instead." | GitHub, Discord |
| **Enterprises adopting agent tools** | ~50 organizations | "SSO, audit, compliance. Standardized UI across all your agent tools." | Direct sales, partnerships |

### Conversion Funnel

```
                    ┌─────────────────────┐
                    │  Discover Unit-UI    │
                    │  (crates.io, HN,     │
                    │   Twitter, GitHub)   │
                    └──────────┬──────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │  cargo add unit-ui   │
                    │  Build basic CLI     │
                    │  with free widgets   │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │  "I need thinking   │
                    │  blocks / tool      │
                    │  calls / diffs"     │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │  cargo add unit-ui  │
                    │  --features pro     │
                    │  Enter license key  │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │  "My company needs  │
                    │  SSO and audit"     │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │  Enterprise license │
                    │  $499/org/mo        │
                    └─────────────────────┘
```

### The Viral Loop

```
               ┌──────────────────────┐
               │ Developer builds CLI │
               │ with Unit-UI Free    │
               └──────────┬───────────┘
                          │
                          ▼
               ┌──────────────────────┐
               │ Ships CLI, open      │
               │ sources it           │
               └──────────┬───────────┘
                          │
                          ▼
               ┌──────────────────────┐
               │ Another dev sees the │◄──── "Oh, that's
               │ CLI, wants a similar │      how they did
               │ one, uses Unit-UI    │      streaming text"
               └──────────┬───────────┘
                          │
                          ▼
               ┌──────────────────────┐
               │ Now 2 CLIs use       │
               │ Unit-UI. Network     │
               │ effect.              │
               └──────────────────────┘
```

The more CLIs use Unit-UI Free, the more developers see it, recognize the components, and use it themselves. Each GitHub repo that lists `unit-ui` as a dependency is free advertising.

---

## Part 7: Risk Analysis

| Risk | Severity | Mitigation |
|---|---|---|
| **Piracy** — Pro features used without license | Medium | Compile-time enforcement, private crate for pro source, no phoning home needed |
| **Competition** — assistant-ui adds Rust support | Low | Different runtime (JS vs Rust), first-mover advantage, 12-18 month head start |
| **Community backlash** — "open core is not open source" | Medium | Free tier is genuinely useful (not crippleware). MIT license. Clear delineation. |
| **Low conversion** — Free users never upgrade | Low | Pro features are visible in ecosystem (users see thinking blocks in other tools, want them) |
| **Ratatui loses dominance** — New TUI framework emerges | Medium | Write an adapter layer. Core widget logic is framework-independent. |
| **Macro uncertainty** — Agent CLI market contracts | Low | Widgets are useful for any streaming terminal UI (logs, CI output, data pipelines) |

---

## Summary

**Category:** Open-Core Domain-Specific Widget Toolkit

**Revenue Model:** Feature-gated commercial licensing (MUI X pattern)

**Tiers:**
- Free (MIT): StreamingText, Spinner, BasicInput, MessageBubble, StatusBar
- Pro ($19/dev/mo): ThinkingBlock, ToolCallCard, DiffView, ApprovalPrompt, ProviderSelector, APIKeyInput, Input+, AgentSwitcher, TaskPanel, TerminalGraphics
- Enterprise ($499/org/mo): SSO, audit, compliance, priority support

**The math:** $46,000 of engineering to build these widgets. $19/mo to buy them. 202 years of subscription to equal the build cost. This is not a hard sell.
