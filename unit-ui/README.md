# Unit-UI

**AI terminal widgets for Ratatui.** Streaming text, spinners, chat bubbles, input, status bars, slash menus, and more — composable widgets for building agent CLIs in Rust.

```rust
use unit_ui::prelude::*;

let input = BasicInput::new("").placeholder("Ask anything...");
let spinner = Spinner::new().label("Thinking...");
let status = StatusBar::new().provider("claude").connection(ConnectionStatus::Connected);
```

## Install

```sh
cargo add unit-ui
```

All free-tier widgets are MIT-licensed and available immediately. No config, no registration.

## Widgets (Free tier)

| Widget | Purpose |
|---|---|
| [`StreamingText`] | Character-by-character token rendering with word-wrap |
| [`Spinner`] | Indeterminate progress indicator (multiple frame styles) |
| [`BasicInput`] | Single-line text input with editing |
| [`MessageBubble`] | Chat message display with role coloring |
| [`StatusBar`] | Provider, connection status, elapsed time |
| [`ThinkingDots`] | Animated "..." thinking indicator |
| [`SlashOption`] | Slash-command completion menu |
| [`StyleToken`] | Builder-based multi-color theme token |

[`StreamingText`]: https://docs.rs/unit-ui/latest/unit_ui/widgets/streaming_text/struct.StreamingText.html
[`Spinner`]: https://docs.rs/unit-ui/latest/unit_ui/widgets/spinner/struct.Spinner.html
[`BasicInput`]: https://docs.rs/unit-ui/latest/unit_ui/widgets/input/struct.BasicInput.html
[`MessageBubble`]: https://docs.rs/unit-ui/latest/unit_ui/widgets/message/struct.MessageBubble.html
[`StatusBar`]: https://docs.rs/unit-ui/latest/unit_ui/widgets/status_bar/struct.StatusBar.html
[`ThinkingDots`]: https://docs.rs/unit-ui/latest/unit_ui/widgets/thinking_dots/struct.ThinkingDots.html
[`SlashOption`]: https://docs.rs/unit-ui/latest/unit_ui/widgets/slash_menu/struct.SlashOption.html
[`StyleToken`]: https://docs.rs/unit-ui/latest/unit_ui/style/token/struct.StyleToken.html

## Examples

Run any example with `cargo run --example <name>`:

| Example | Inspired by | Widgets used |
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

## Quick Start

```rust
use std::io::stdout;
use std::time::Instant;
use crossterm::execute;
use crossterm::terminal::{enable_raw_mode, EnterAlternateScreen};
use ratatui::{Terminal, backend::CrosstermBackend, layout::*, widgets::*, style::*};
use unit_ui::prelude::*;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    enable_raw_mode()?;
    let mut terminal = Terminal::new(CrosstermBackend::new(stdout()))?;
    execute!(terminal.backend_mut(), EnterAlternateScreen)?;

    let started = Instant::now();
    loop {
        terminal.draw(|f| {
            let [top, mid, bot] = Layout::vertical([
                Constraint::Length(1), Constraint::Min(1), Constraint::Length(3),
            ]).areas(f.area());

            let status = StatusBar::new()
                .provider("unit").model("v1")
                .connection(ConnectionStatus::Connected)
                .started_at(started);
            f.render_widget(&status, top);

            let bubble = MessageBubble::new("Hello! I'm Unit AI.", Role::Assistant);
            f.render_widget(&bubble, mid);

            let input = BasicInput::new("").placeholder("Ask anything...");
            f.render_widget(&input, bot);
        })?;

        if let crossterm::event::Event::Key(k) = crossterm::event::read()? {
            if k.code == crossterm::event::KeyCode::Char('q') { break; }
        }
    }
    Ok(())
}
```

## Runtime deps

unit-ui builds on [Ratatui](https://ratatui.rs) — bring your own terminal backend (crossterm, termion, termwiz).

## License

MIT OR Apache-2.0
