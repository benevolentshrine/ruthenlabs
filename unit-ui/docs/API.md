# unit-ui — API Reference

> Designed for AI agents. Flat, complete, one pattern.

## Import

```rust
use unit_ui::prelude::*;
```

---

## `StreamingText`

Renders text with optional thinking block and typing animation.

```rust
StreamingText::new(content: &str) -> Self
    .thinking(text: &str) -> Self        // optional thinking block
    .visible_chars(n: usize) -> Self     // chars to show (default: all)
    .typing_speed(cps: u64) -> Self      // chars per sec (default: 50)
    .style(tokens: StyleToken) -> Self
```

Render: `frame.render_widget(&widget, area)`

---

## `Spinner`

An animated loading indicator.

```rust
Spinner::new() -> Self
    .frame_index(n: usize) -> Self          // current frame
    .frames(set: Vec<&str>) -> Self         // custom frames
    .label(text: impl Into<String>) -> Self // optional label
    .style(tokens: StyleToken) -> Self
```

Frame sets: `spinners::braille()`, `spinners::dots()`, `spinners::line()`, `spinners::arc()`, `spinners::clock()`, `spinners::bounce()`, `spinners::pulse()`

Render: `frame.render_widget(&widget, area)`

---

## `BasicInput`

A text input line.

```rust
BasicInput::new(value: &str) -> Self
    .placeholder(text: &str) -> Self
    .cursor_pos(n: usize) -> Self
    .focused(focused: bool) -> Self
    .style(tokens: StyleToken) -> Self
```

Render: `frame.render_widget(&widget, area)`

---

## `MessageBubble`

A chat message.

```rust
MessageBubble::new(content: &str, role: Role) -> Self
    .style(tokens: StyleToken) -> Self
```

Roles: `Role::User`, `Role::Assistant`, `Role::System`

Render: `frame.render_widget(&widget, area)`

---

## `StatusBar`

A bottom status bar showing provider, model, and token count.

```rust
StatusBar::new() -> Self
    .provider(name: impl Into<String>) -> Self
    .model(name: impl Into<String>) -> Self
    .token_count(n: u64) -> Self
    .style(tokens: StyleToken) -> Self
```

Render: `frame.render_widget(&widget, area)`

---

## StyleToken

A set of semantic colors. Pass to any widget via `.style()`.

### Fields

```
text      — main text color
text_dim  — muted/dim text
accent    — highlights, borders, cursor
surface   — background fill
error     — error messages
success   — success messages
thinking  — <think> block color
provider  — provider indicator
```

### Create

```rust
StyleToken::default()                                   // dark defaults
StyleToken::builder()
    .text(Color::Rgb(...))
    .accent(Color::Rgb(...))
    .thinking(Color::Rgb(...))
    .build()
```

### Presets

```rust
palette::dark()     // same as default
palette::light()    // light mode variant
palette::from_accent(Color::Rgb(0, 200, 120))  // derive from accent
```

### Provider Colors

```rust
providers::openai()     // green
providers::anthropic()  // purple
providers::ollama()     // teal
providers::google()     // blue
providers::meta()       // meta blue
providers::mistral()    // orange
providers::deepseek()   // blue
providers::codestral()  // pink
```

---

## Pattern Summary

Every widget follows:

```
WidgetName::new(required)
    .option(value)    // chain options
    .style(tokens)    // always last, always optional
```

Render by reference:

```
frame.render_widget(&widget, area);
```
