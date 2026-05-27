# Unit-UI

[![Crates.io](https://img.shields.io/crates/v/unit-ui?logo=rust&style=flat-square&color=E05D44)](https://crates.io/crates/unit-ui)
[![License](https://img.shields.io/crates/l/unit-ui?style=flat-square&color=1370D3)](https://github.com/benevolentshrine/Ruthen-Labs/blob/main/unit-ui/LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/benevolentshrine/Ruthen-Labs/ci.yml?style=flat-square&logo=github)](https://github.com/benevolentshrine/Ruthen-Labs/actions)
[![Docs](https://img.shields.io/docsrs/unit-ui?style=flat-square&logo=rust)](https://docs.rs/unit-ui)

**AI terminal widgets for Ratatui** — composable, themed, drop-in widgets for building agent CLIs in Rust. Streaming text, spinners, chat bubbles, input fields, status bars, and slash menus — all from one crate.

```rust
use unit_ui::prelude::*;

let input = BasicInput::new("").placeholder("Ask anything...");
let spinner = Spinner::new().label("Thinking...");
let status = StatusBar::new()
    .provider("claude")
    .connection(ConnectionStatus::Connected);
```

## Install

```sh
cargo add unit-ui
```

Free-tier widgets are MIT-licensed and available immediately. No registration, no telemetry, no config.

## What is this?

Unit-UI gives you the UI primitives that every AI coding agent, CLI assistant, and terminal chat app needs. Instead of reimplementing streaming text rendering, thinking animations, or status bars for the Nth time, you pull them from a single crate and compose them with Ratatui's layout system.

**For new users:** You'll need [Ratatui](https://ratatui.rs) (0.29+) and a terminal backend like [crossterm](https://crates.io/crates/crossterm). Unit-UI sits on top of Ratatui — you build your layout with Ratatui's `Layout`, then render Unit-UI widgets into it.

**For pros:** The quick start below shows the exact pattern. Each widget uses a builder API, accepts a `StyleToken` for theming, and implements Ratatui's `Widget` trait. Wire them into your existing Ratatui app with zero surprises.

## Widgets

| Tier | Widget | Purpose |
|---|---|---|
| Free | [`StreamingText`] | Character-by-character token rendering with word-wrap |
| Free | [`Spinner`] | Indeterminate progress indicator (multiple frame styles) |
| Free | [`BasicInput`] | Single-line text input with editing and clipboard |
| Free | [`MessageBubble`] | Chat message with role coloring (user/assistant/system) |
| Free | [`StatusBar`] | Provider name, model, connection status, elapsed time |
| Free | [`ThinkingDots`] | Animated "..." thinking indicator |
| Free | [`SlashMenu`] | Slash-command completion menu |
| Pro  | [`ThinkingBlock`] | Collapsible reasoning block with state indicator |
| Pro  | [`ToolCallCard`] | Tool call card with args, status, duration, result |
| Pro  | [`DiffView`] | Unified diff viewer with +/- syntax coloring |
| Pro  | [`ApprovalPrompt`] | Permission dialog for tool execution approval |
| Pro  | [`MultiLineInput`] | Multi-line text area with line numbers |
| Pro  | [`SessionTimeline`] | Chronological event log with timestamps |
| Pro  | [`MarkdownBlock`] | Basic markdown renderer for assistant messages |
| —   | [`StyleToken`] | Builder-based multi-color theme token |

[`StreamingText`]: https://docs.rs/unit-ui/latest/unit_ui/widgets/streaming_text/struct.StreamingText.html
[`Spinner`]: https://docs.rs/unit-ui/latest/unit_ui/widgets/spinner/struct.Spinner.html
[`BasicInput`]: https://docs.rs/unit-ui/latest/unit_ui/widgets/input/struct.BasicInput.html
[`MessageBubble`]: https://docs.rs/unit-ui/latest/unit_ui/widgets/message/struct.MessageBubble.html
[`StatusBar`]: https://docs.rs/unit-ui/latest/unit_ui/widgets/status_bar/struct.StatusBar.html
[`ThinkingDots`]: https://docs.rs/unit-ui/latest/unit_ui/widgets/thinking_dots/struct.ThinkingDots.html
[`SlashMenu`]: https://docs.rs/unit-ui/latest/unit_ui/widgets/slash_menu/struct.SlashMenu.html
[`ThinkingBlock`]: https://docs.rs/unit-ui/latest/unit_ui/widgets/thinking_block/struct.ThinkingBlock.html
[`ToolCallCard`]: https://docs.rs/unit-ui/latest/unit_ui/widgets/tool_call_card/struct.ToolCallCard.html
[`DiffView`]: https://docs.rs/unit-ui/latest/unit_ui/widgets/diff_view/struct.DiffView.html
[`ApprovalPrompt`]: https://docs.rs/unit-ui/latest/unit_ui/widgets/approval_prompt/struct.ApprovalPrompt.html
[`MultiLineInput`]: https://docs.rs/unit-ui/latest/unit_ui/widgets/multi_line_input/struct.MultiLineInput.html
[`SessionTimeline`]: https://docs.rs/unit-ui/latest/unit_ui/widgets/session_timeline/struct.SessionTimeline.html
[`MarkdownBlock`]: https://docs.rs/unit-ui/latest/unit_ui/widgets/markdown_block/struct.MarkdownBlock.html
[`StyleToken`]: https://docs.rs/unit-ui/latest/unit_ui/style/token/struct.StyleToken.html

## Examples

Run any example with `cargo run -p unit-ui --example <name>`:

| Example | Inspired by | Widgets |
|---|---|---|
| `01_chat` | Claude Code / OpenCode | StatusBar, MessageBubble, BasicInput |
| `02_dashboard` | Sidecar / Hermes Dashboard | StatusBar, Spinner, ThinkingDots, BasicInput |
| `03_repl` | Aider | StatusBar, BasicInput |
| `04_session` | Agent Deck / Toad | StatusBar, MessageBubble, BasicInput |
| `05_multiagent` | Hermes Conductor | StatusBar, Spinner, ThinkingDots, BasicInput |
| `06_debug` | Codex verbose | StatusBar, Spinner, BasicInput |
| `07_wizard` | Setup installers | StatusBar, ThinkingDots, BasicInput |
| `08_minimal` | Zen / lightweight | MessageBubble, BasicInput |
| `09_ide` | Warp / VSCode terminal | StatusBar, MessageBubble, BasicInput |
| `10_retro` | Hack The Box | StatusBar, ThinkingDots, BasicInput |

Exit any example by pressing `q`.

## Quick Start

This minimal app shows a status bar, a chat bubble, and an input bar. It demonstrates the standard Ratatui + Unit-UI pattern:

1. Enable raw mode and enter the alternate screen
2. Create a terminal with crossterm
3. In a draw loop, split the screen with `Layout`, then render widgets
4. Listen for key events — `q` to quit, typing fills the input

```rust
use std::io::stdout;
use std::time::Instant;
use crossterm::execute;
use crossterm::terminal::{enable_raw_mode, EnterAlternateScreen};
use ratatui::{Terminal, backend::CrosstermBackend, layout::*, style::*, widgets::*};
use unit_ui::prelude::*;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    // 1. Enter terminal UI mode
    enable_raw_mode()?;
    let mut terminal = Terminal::new(CrosstermBackend::new(stdout()))?;
    execute!(terminal.backend_mut(), EnterAlternateScreen)?;

    let started = Instant::now();

    // 2. Draw loop — Ratatui calls your closure on every frame
    loop {
        terminal.draw(|f| {
            // Split the screen into three vertical sections
            let [top, mid, bot] = Layout::vertical([
                Constraint::Length(1),
                Constraint::Min(1),
                Constraint::Length(3),
            ])
            .areas(f.area());

            // Render a status bar at the top
            let status = StatusBar::new()
                .provider("unit-ui")
                .model("quickstart")
                .connection(ConnectionStatus::Connected)
                .started_at(started);
            f.render_widget(&status, top);

            // Render a chat bubble in the middle
            let bubble =
                MessageBubble::new("Hello! I'm Unit-UI.", Role::Assistant);
            f.render_widget(&bubble, mid);

            // Render a text input at the bottom
            let input = BasicInput::new("").placeholder("Ask anything...");
            f.render_widget(&input, bot);
        })?;

        // 3. Handle keyboard input
        if let crossterm::event::Event::Key(k) = crossterm::event::read()? {
            if k.code == crossterm::event::KeyCode::Char('q') {
                break;
            }
        }
    }

    Ok(())
}
```

Every unit-ui widget is a Ratatui `Widget` — you render it with `frame.render_widget(&widget, area)`. Build your own layouts with `Layout`, `Constraint`, and `Rect`, then drop in the widgets.

## Dependencies

| Crate | Role |
|---|---|
| [Ratatui](https://ratatui.rs) 0.29+ | Terminal UI framework |
| [crossterm](https://crates.io/crates/crossterm) 0.28+ | Terminal backend (bring your own) |
| serde + toml | Config file parsing (optional) |

Unit-UI doesn't lock you into crossterm — Ratatui supports termion and termwiz backends too.

## MSRV

Minimum supported Rust version: **1.75**.

## Changelog

See [CHANGELOG.md](./CHANGELOG.md).

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). All contributions welcome — bug reports, PRs, widget ideas, docs improvements.

## License

MIT OR Apache-2.0
