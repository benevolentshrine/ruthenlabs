# Getting Started with Unit-UI

## 5 Minutes to a Working Agent CLI

This guide shows you how to go from zero to a functioning agent CLI using Unit-UI widgets. No framework, no boilerplate, no lock-in.

---

## Installation

```bash
cargo add unit-ui ratatui crossterm
```

This adds the free tier (MIT). All widgets are available immediately.

---

## Minimal Chat App (Free Tier)

```rust
use unit_ui::prelude::*;
use ratatui::{Terminal, layout::*, widgets::*};
use crossterm::event::{self, Event, KeyCode};

fn main() -> color_eyre::Result<()> {
    let terminal = ratatui::init();
    let mut streaming = StreamingText::new().speed(Speed::Smooth);
    let mut status = StatusBar::new().provider("claude-sonnet-4");

    loop {
        terminal.draw(|frame| {
            let [chat_area, status_area] =
                Layout::vertical([Constraint::Fill(1), Constraint::Length(1)])
                    .areas(frame.area());
            streaming.render(chat_area, frame.buffer_mut());
            status.render(status_area, frame.buffer_mut());
        })?;

        if let Event::Key(key) = event::read()? {
            if key.code == KeyCode::Esc { break; }
            streaming.handle_key(key);
        }
    }

    ratatui::restore();
    Ok(())
}
```

5 widgets, 30 lines, one file. You have a streaming chat CLI.

---

## Adding Pro Widgets

```bash
cargo add unit-ui --features pro
export UNIT_UI_LICENSE=xxxxx
```

Now you have access to all Pro widgets:

```rust
use unit_ui::prelude::*;

fn build_agent_ui() -> impl UnitWidget {
    Layout::vertical([
        // Chat area with thinking blocks and tool calls
        StreamingText::new()
            .speed(Speed::Smooth)
            .thinking(ThinkingBlock::default().collapsed()),
        
        // Status bar with provider info
        StatusBar::new()
            .provider("claude-sonnet-4")
            .tokens(1542)
            .cost(0.02),
        
        // Input with vim bindings and history
        InputPlus::new()
            .vim_mode(true)
            .history_size(1000),
    ])
}
```

---

## Architecture Philosophy

Unit-UI is a **toolkit**, not a framework. This means:

### You Own Your Event Loop

```rust
// Your app, your loop
loop {
    // 1. Draw
    terminal.draw(|frame| {
        streaming.render(area, frame.buffer_mut());
        input.render(area, frame.buffer_mut());
    })?;
    
    // 2. Handle input
    match event::read()? {
        Event::Key(key) => {
            if input.focused() && input.handle_key(key) { continue; }
            if streaming.handle_key(key) { continue; }
            match key.code {
                KeyCode::Esc => break,
                _ => {}
            }
        }
        Event::Resize(..) => {} // handled automatically by Ratatui
    }
    
    // 3. Your business logic
    if let Some(response) = provider.complete(&input.value()) {
        streaming.stream(response);
    }
}
```

No hidden state. No opinionated architecture. You control everything.

### You Own Your State

Widgets take state as parameters — they don't hide mutations:

```rust
// You pass state each frame
streaming.render(frame.buffer_mut(), area, &StreamingState {
    content: &chat_history,
    cursor_pos: current_pos,
});
```

This means:
- You control persistence (save/restore threads)
- You control undo/history
- You can serialize/deserialize independently
- Testing is trivial (pure input → output)

### You Own Your Provider SDK

Unit-UI does not call LLMs. You bring your own provider:

```rust
// Your provider call
let response = anthropic::messages()
    .model("claude-sonnet-4")
    .stream(client.message(&chat_history))
    .await?;

// Feed tokens to Unit-UI
for token in response {
    streaming.push_token(token);
    streaming.request_redraw();
}
```

Any provider. Any SDK. Any async runtime.

---

## Theme System (Unit.toml)

Create a `Unit.toml` in your project root:

```toml
[theme]
schema = "catppuccin-mocha"

[theme.colors]
background = "#1e1e2e"
surface    = "#313244"
accent     = "#cba6f7"
text       = "#cdd6f4"
error      = "#f38ba8"
success    = "#a6e3a1"

[widgets.streaming_text]
speed = "smooth"

[widgets.diff_view]
layout = "side-by-side"
context_lines = 3
```

Unit-UI auto-detects `Unit.toml` in the current directory. No setup required.

---

## When to Upgrade

| Symptom | Upgrade to |
|---|---|
| "My users can't see what the agent is thinking" | **Pro** — ThinkingBlock |
| "Raw JSON tool calls look ugly" | **Pro** — ToolCallCard |
| "I need users to review code changes before applying" | **Pro** — DiffView + ApprovalPrompt |
| "Text-only provider selection looks amateur" | **Pro** — ProviderSelector |
| "My enterprise customer demands SSO" | **Enterprise** |
| "Legal needs audit logs for compliance" | **Enterprise** |

---

## Architecture Diagram

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

---

## Next Steps

1. `cargo add unit-ui` — start with free
2. Browse the [widget documentation](#)
3. When you hit a Pro feature you need, [get a license](https://unit-ui.dev/pricing)
4. Join [our Discord](https://discord.gg/unit-ui) for help and feedback

---

*Unit-UI. Stop rebuilding the terminal. Start shipping agents.*
