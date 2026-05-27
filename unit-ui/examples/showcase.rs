use std::io;
use std::time::Duration;

use crossterm::event::{self, Event, KeyCode};
use ratatui::layout::{Constraint, Layout, Rect};
use ratatui::style::{Color, Style};
use ratatui::widgets::{Block, Borders, Paragraph};
use ratatui::{DefaultTerminal, Frame};

use unit_ui::prelude::*;

fn main() -> io::Result<()> {
    let terminal = ratatui::init();
    let result = run(terminal);
    ratatui::restore();
    result
}

fn run(mut terminal: DefaultTerminal) -> io::Result<()> {
    let accent = StyleToken::builder()
        .accent(providers::anthropic())
        .thinking(Color::Rgb(200, 170, 100))
        .build();

    let green = StyleToken::builder()
        .accent(providers::openai())
        .build();

    let blue = StyleToken::builder()
        .accent(providers::google())
        .build();

    let mut frame_count = 0;
    let mut visible = 0;
    let mut typing_chars: usize = 0;
    let mut phase = Phase::SpinnerDemo;
    let mut scroll_offset = 0;

    let response = "\
# Step 1 — Install Dependencies

Add `clap` for argument parsing and `anyhow` for error handling:

```toml
[dependencies]
clap = { version = \"4.5\", features = [\"derive\"] }
anyhow = \"1.0\"
```

# Step 2 — Define Your CLI

Create a struct that holds your arguments. Use derive macros for automatic parsing.

```rust
use clap::Parser;

#[derive(Parser)]
#[command(name = \"mycli\")]
struct Cli {
    input: String,
    #[arg(short, long)]
    verbose: bool,
}
```

# Step 3 — Implement the Logic

Write your main function with error handling:

```rust
fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();
    if cli.verbose {
        println!(\"Processing: {}\", cli.input);
    }
    // your logic here
    Ok(())
}
```

# Step 4 — Run It

```bash
cargo run -- --verbose hello
```

# Step 5 — Next Steps

Explore subcommands, shell completion, and custom validation.";

    loop {
        terminal.draw(|frame| {
            draw(
                frame, phase, frame_count, visible, typing_chars, scroll_offset, response,
                &accent, &green, &blue,
            )
        })?;

        if event::poll(Duration::from_millis(30))? {
            if let Event::Key(key) = event::read()? {
                match key.code {
                    KeyCode::Esc | KeyCode::Char('q') => break,
                    KeyCode::Char('1') => { phase = Phase::SpinnerDemo; scroll_offset = 0; }
                    KeyCode::Char('2') => { phase = Phase::StreamDemo; scroll_offset = 0; }
                    KeyCode::Char('3') => { phase = Phase::AllAtOnce; scroll_offset = 0; }
                    KeyCode::Up => scroll_offset = scroll_offset.saturating_sub(1),
                    KeyCode::Down => scroll_offset += 1,
                    _ => {}
                }
            }
        }

        frame_count += 1;

        match phase {
            Phase::SpinnerDemo => {
                if visible < response.chars().count() {
                    visible += 1;
                }
            }
            Phase::StreamDemo => {
                if typing_chars < response.len() {
                    typing_chars += 2;
                }
            }
            Phase::AllAtOnce => {
                if visible < response.chars().count() {
                    visible += 1;
                }
                if typing_chars < response.len() {
                    typing_chars += 2;
                }
            }
        }
    }
    Ok(())
}

#[derive(Clone, Copy, PartialEq)]
enum Phase {
    SpinnerDemo,
    StreamDemo,
    AllAtOnce,
}

#[allow(clippy::too_many_arguments)]
fn draw(
    frame: &mut Frame,
    phase: Phase,
    frame_count: usize,
    visible: usize,
    typing_chars: usize,
    scroll_offset: usize,
    response: &str,
    accent: &StyleToken,
    green: &StyleToken,
    blue: &StyleToken,
) {
    let [top, middle, bottom] = Layout::vertical([
        Constraint::Length(1),
        Constraint::Fill(1),
        Constraint::Length(3),
    ])
    .areas(frame.area());

    let top_bar = StatusBar::new()
        .provider("Anthropic")
        .model("claude-sonnet-4-20250514")
        .token_count(1423)
        .style(accent.clone());
    frame.render_widget(&top_bar, top);

    let [left, right] = Layout::horizontal([
        Constraint::Percentage(35),
        Constraint::Percentage(65),
    ])
    .areas(middle);

    draw_left_panel(frame, left, phase, frame_count, accent, green, blue);
    draw_right_panel(frame, right, phase, frame_count, visible, typing_chars, scroll_offset, response, accent, green);

    let help = BasicInput::new("Ask me to build something...")
        .placeholder("Type a message and press Enter...")
        .cursor_pos(0)
        .focused(true)
        .style(accent.clone());
    frame.render_widget(&help, bottom);
}

#[allow(clippy::too_many_arguments)]
fn draw_left_panel(
    frame: &mut Frame,
    area: Rect,
    phase: Phase,
    frame_count: usize,
    accent: &StyleToken,
    green: &StyleToken,
    blue: &StyleToken,
) {
    let block = Block::default()
        .title(" Widgets ")
        .borders(Borders::ALL)
        .style(Style::default().fg(accent.accent));
    let inner = block.inner(area);
    frame.render_widget(block, area);

    let areas = Layout::vertical([
        Constraint::Length(2),
        Constraint::Length(2),
        Constraint::Length(2),
        Constraint::Fill(1),
    ])
    .split(inner);

    let spinner_label = match phase {
        Phase::SpinnerDemo => "Spinners Demo (7 frame sets) ▸",
        Phase::StreamDemo => "Spinners (idle)",
        Phase::AllAtOnce => "All spinners active ▸",
    };

    let mut spinner_line = String::new();
    let frame_sets = [
        spinners::line(),
        spinners::braille(),
        spinners::dots(),
        spinners::arc(),
        spinners::clock(),
        spinners::bounce(),
        spinners::pulse(),
    ];
    for set in frame_sets.iter() {
        let idx = if phase == Phase::AllAtOnce || phase == Phase::SpinnerDemo {
            frame_count % set.len()
        } else {
            0
        };
        spinner_line.push_str(set[idx]);
        spinner_line.push(' ');
    }

    let spinner1 = Spinner::new()
        .label(&spinner_line)
        .frame_index(frame_count)
        .frames(spinners::line())
        .style(accent.clone());
    frame.render_widget(&spinner1, areas[0]);

    let spinner2 = Spinner::new()
        .label(spinner_label)
        .frame_index(frame_count)
        .frames(spinners::braille())
        .style(green.clone());
    frame.render_widget(&spinner2, areas[1]);

    let msg_user = MessageBubble::new("how do i make a rust cli?", Role::User)
        .style(blue.clone());
    frame.render_widget(&msg_user, areas[2]);

    let msg_assistant = MessageBubble::new(
        "Use clap + anyhow. I'll show you step by step.",
        Role::Assistant,
    )
    .style(green.clone());
    frame.render_widget(&msg_assistant, areas[3]);
}

#[allow(clippy::too_many_arguments)]
fn draw_right_panel(
    frame: &mut Frame,
    area: Rect,
    phase: Phase,
    _frame_count: usize,
    visible: usize,
    typing_chars: usize,
    scroll_offset: usize,
    response: &str,
    accent: &StyleToken,
    green: &StyleToken,
) {
    let block = Block::default()
        .title(" StreamingText ")
        .borders(Borders::ALL)
        .style(Style::default().fg(accent.accent));
    let inner = block.inner(area);
    frame.render_widget(block, area);

    let [thinking_area, content_area, help_area] = Layout::vertical([
        Constraint::Length(4),
        Constraint::Fill(1),
        Constraint::Length(1),
    ])
    .areas(inner);

    let show_thinking = matches!(phase, Phase::StreamDemo | Phase::AllAtOnce);
    let show_content = matches!(phase, Phase::SpinnerDemo) || show_thinking;

    if show_thinking {
        let thinking_text = "\
The user is asking about Rust CLI development.
I will provide a complete guide covering project setup, dependencies, and code examples.";

        let stream = StreamingText::new(thinking_text)
            .typing_speed(80)
            .visible_chars(typing_chars)
            .style(accent.clone());
        frame.render_widget(&stream, thinking_area);
    }

    if show_content {
        let text_style = Style::default().fg(accent.text);
        let block2 = Block::default()
            .title(" response ")
            .borders(Borders::ALL)
            .style(Style::default().fg(green.accent));
        let inner2 = block2.inner(content_area);
        frame.render_widget(block2, content_area);

        match phase {
            Phase::SpinnerDemo => {
                let paragraph = Paragraph::new(response)
                    .style(text_style)
                    .scroll((scroll_offset as u16, 0));
                frame.render_widget(paragraph, inner2);
            }
            Phase::StreamDemo | Phase::AllAtOnce => {
                let stream = StreamingText::new(response)
                    .thinking("The user needs a complete walkthrough. Let me structure this with dependencies, code example, and run instructions.")
                    .visible_chars(visible)
                    .typing_speed(60)
                    .scroll_offset(scroll_offset)
                    .style(green.clone());
                frame.render_widget(&stream, inner2);
            }
        }
    }

    let nav = Paragraph::new(format!(
        "1: spinners  2: streaming  3: all  |  ↑↓: scroll ({})  |  q: quit",
        scroll_offset
    ))
    .style(Style::default().fg(accent.text_dim));
    frame.render_widget(nav, help_area);
}
