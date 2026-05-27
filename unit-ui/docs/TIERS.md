# Unit-UI Tiers: Free vs Pro vs Enterprise

## Quick Decision Guide

| You are... | Start here | Upgrade when... |
|---|---|---|
| Building a personal agent CLI | **Free** | You want thinking blocks and tool call visualization |
| Shipping a commercial agent product | **Free → Pro** | Your users expect professional UX |
| Deploying agents to your engineering team | **Pro → Enterprise** | You need SSO, audit, and compliance |

---

## Free (MIT) — $0

### Who this is for

Individual developers, open-source projects, hobby agents, prototyping. Anyone building a basic chat interface with an LLM.

### What you get

```
StreamingText   → Character-by-character token rendering with word-wrap
Spinner         → Indeterminate progress indicator (multiple frame styles)
BasicInput      → Single-line text input with editing and clipboard
MessageBubble   → Chat message display with role coloring (user/assistant/system)
StatusBar       → Lightweight bar showing provider, connection status, elapsed time
Unit.toml       → Theme and configuration parser
```

### Why it's free

These widgets are the absolute minimum to converse with an LLM in the terminal. Without them, your agent CLI doesn't function. No one should pay for the basics.

**We want 100% of Rust agent CLIs to start here.** Every `cargo add unit-ui` is a seed. When you outgrow the free tier, Pro is a natural upgrade — not a bait-and-switch.

### Limitations (by design)

- Single-line input only (no multi-line, no vim bindings)
- No thinking block visualization (thinking output shown as raw text)
- No tool call formatting (tool calls shown as raw JSON)
- No diff view (can't review code changes inline)
- No approval prompt (no inline yes/no with context)
- Text-only provider names (no logos, no grid selector)
- No terminal graphics (Sixel/Kitty/iTerm2)
- No pre-built layouts

### License

**MIT.** Use it in any project, commercial or not. No restrictions. No license key. No telemetry.

```
cargo add unit-ui
```

---

## Pro ($19/dev/mo or $190/dev/yr) — The Professional Polish

### Who this is for

Startups and companies shipping commercial agent products. Teams that need their CLI to look professional, not hobbyist. Anyone whose users expect thinking blocks, diff views, and approval prompts.

### What you get (everything in Free, plus)

```
ThinkingBlock        → Collapsible reasoning section with animation, timer, word count
                     → The #1 requested feature across ALL agent CLIs
                     → Configurable default collapse, streaming toggle

ToolCallCard         → Formatted JSON args with syntax highlighting
                     → Expandable/collapsible results
                     → Status badges (running, success, failed, cancelled)
                     → Timing per tool call

DiffView             → Side-by-side AND unified layout
                     → Syntax highlighting (syntect-based)
                     → Line numbers, change counts (+/-)
                     → Hunk navigation with keyboard shortcuts

ApprovalPrompt       → Yes/no/cancel with keyboard shortcuts (Y/n/c)
                     → Risk level indicator (low/medium/high/critical)
                     → Inline diff preview
                     → Cost estimate display
                     → File path listing

ProviderSelector     → Grid menu with official ANSI logos (20+ providers)
                     → Model sub-selection per provider
                     → Token pricing display
                     → Search/filter

APIKeyInput          → Secure paste (masked input, no echo)
                     → Mask/unmask toggle
                     → Validation (format check, live test)
                     → Clipboard integration
                     → Environment variable suggestion

Input+               → Multi-line editor
                     → Vim keybindings (insert/normal mode)
                     → History search (Ctrl+R)
                     → @-reference autocomplete
                     → Syntax highlighting in editor

AgentSwitcher        → Tabbed persona switching
                     → Per-agent configuration
                     → Session count and memory indicator

TaskPanel            → Ordered step list
                     → Current step highlighting
                     → Completion checkmarks
                     → Estimated vs actual timing

TerminalGraphics     → Sixel, Kitty, and iTerm2 image protocols
                     → Image rendering in-line with text
                     → Automatic protocol detection

Pre-built layouts    → Chat layout, IDE layout, Minimal layout
                     → One-line setup for common patterns
```

### Why it costs money

Each Pro widget represents 4-8 days of engineering time. Together, they'd cost **$51,000 and 10 weeks to build from scratch.** Pro is $19/month.

These widgets are what separate "works" from "looks like a shipped product." Your users notice the difference:

| Without Pro | With Pro |
|---|---|
| Raw JSON tool output | Formatted cards with status badges |
| Uncollapsible thinking text | Animated block with timer |
| No inline diff review | Side-by-side syntax-highlighted diffs |
| No approval context | Risk level + diff preview + cost |
| Text-only provider names | Grid of official brand logos |
| Plain text input | Vim bindings, history, autocomplete |

### License

**Commercial license.** Per-developer subscription. Includes all updates during subscription period. [Private registry access]($unit-ui-pro). Source-available (inspect, don't redistribute).

```
cargo add unit-ui --features pro
UNIT_UI_LICENSE=xxxxx cargo build
```

### Pricing

| Billing | Price | Savings |
|---|---|---|
| Monthly | $19/dev/month | — |
| Annual | $190/dev/year (~$15.83/mo) | ~17% |
| Lifetime (single major version) | $299/developer | One-time |

---

## Enterprise ($499/org/month) — The Organizational Standard

### Who this is for

Organizations deploying agent CLIs to engineering teams. Regulated industries (finance, healthcare, defense). Companies that need SSO, audit trails, and compliance documentation.

### What you get (everything in Pro, plus)

```
SSO / SAML           → Single sign-on with any identity provider
                     → Okta, Azure AD, Google Workspace, OneLogin

Audit logging        → Who used which widget in which project
                     → Timestamped, immutable log stream
                     → Integration with SIEM tools

License management   → Centralized seat assignment
                     → Usage dashboard
                     → Automated provisioning/deprovisioning

Priority support     → SLA-backed (4-hour response, 24-hour resolution)
                     → Direct line to maintainers via Slack/Discord
                     → Quarterly business reviews

Custom widgets       → Bespoke components built for your product
                     → 20 hours of custom development included per quarter

Compliance docs      → SOC 2 Type II report
                     → ISO 27001 certification artifacts
                     → Data processing agreement (DPA)
```

### Why it costs money

Enterprise features are not about widgets — they're about governance. SSO, audit, and compliance are mandatory for regulated industries but expensive to build and maintain. The $499 flat rate covers unlimited developers, which is cheaper than per-seat alternatives at scale.

### License

**Enterprise license.** Per-organization, annual contract. Includes everything in Pro plus SSO, audit, and compliance. Custom terms available.

```
Contact sales@unit-ui.dev for Enterprise setup
```

### Pricing

| Billing | Price | Equivalent per dev (50 devs) |
|---|---|---|
| Monthly (annual commit) | $499/month | $9.98/dev/month |
| Annual | $5,988/year | $9.98/dev/month |

Compare: GitLab Ultimate at 50 seats = $1,950/month ($39/seat). GitHub Enterprise at 50 seats = $1,050/month ($21/seat). **Unit-UI Enterprise at 50 seats = $499/month flat.**

---

## Feature Comparison Table

| Widget / Feature | Free | Pro | Enterprise |
|---|---|---|---|
| **StreamingText** | ✅ | ✅ | ✅ |
| **Spinner** | ✅ | ✅ | ✅ |
| **BasicInput** | ✅ | ✅ | ✅ |
| **MessageBubble** | ✅ | ✅ | ✅ |
| **StatusBar** | ✅ | ✅ | ✅ |
| **Unit.toml parser** | ✅ | ✅ | ✅ |
| **Theme system** | ✅ | ✅ | ✅ |
| **ThinkingBlock** | ❌ | ✅ | ✅ |
| **ToolCallCard** | ❌ | ✅ | ✅ |
| **DiffView** | ❌ | ✅ | ✅ |
| **ApprovalPrompt** | ❌ | ✅ | ✅ |
| **ProviderSelector** | ❌ | ✅ | ✅ |
| **Provider logos (20+)** | ❌ | ✅ | ✅ |
| **APIKeyInput** | ❌ | ✅ | ✅ |
| **Input+ (multi-line)** | ❌ | ✅ | ✅ |
| **AgentSwitcher** | ❌ | ✅ | ✅ |
| **TaskPanel** | ❌ | ✅ | ✅ |
| **TerminalGraphics** | ❌ | ✅ | ✅ |
| **Pre-built layouts** | ❌ | ✅ | ✅ |
| **SSO / SAML** | ❌ | ❌ | ✅ |
| **Audit logging** | ❌ | ❌ | ✅ |
| **License management** | ❌ | ❌ | ✅ |
| **Priority support (SLA)** | ❌ | ❌ | ✅ |
| **Custom widgets** | ❌ | ❌ | ✅ |
| **Compliance docs** | ❌ | ❌ | ✅ |

---

## Price / Value Summary

| Tier | Price | Value | Best for |
|---|---|---|---|
| **Free** | $0 | $5,000+ of widgets | Individuals, OSS, prototyping |
| **Pro** | $19/dev/mo | $51,000+ of widgets | Commercial products, startups |
| **Enterprise** | $499/org/mo | $51,000+ + SSO + audit + compliance | Regulated orgs, teams >20 |

**At $19/dev/month, Pro pays for itself in the first hour of engineering time it saves.**

---

## FAQ

**Can I try Pro before buying?**
Yes. Every Pro widget is available in the repository as source-available. You can inspect the code, build it locally. You need a license to ship it in a commercial product.

**Is the free tier "crippleware"?**
No. The free tier is genuinely useful. StreamingText, Spinner, BasicInput, MessageBubble, and StatusBar are enough to build a functional chat CLI. The Pro tier adds polish that commercial products need.

**Can I use Pro in an open-source project?**
Yes, if you have a Pro license. The Pro license allows use in any project — commercial or open source — by the licensed developer.

**Do you offer educational / non-profit discounts?**
Yes. 50% discount for students, educators, and registered non-profits. Contact sales@unit-ui.dev.

**What happens if I stop paying for Pro?**
Your license expires. You keep the last version of Pro you downloaded (perpetual use, no ransom). But you won't get updates or new widgets.

**How does license enforcement work?**
Compile-time check via build.rs. The license key (JWT signed with our private key) is validated against a public key embedded in the crate. No phoning home, no telemetry, no network calls.

---

*Questions? sales@unit-ui.dev*
