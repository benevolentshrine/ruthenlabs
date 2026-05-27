use std::io;
use std::time::Duration;

use crossterm::event::{self, Event, KeyCode};
use ratatui::layout::{Constraint, Layout, Rect};
use ratatui::style::{Color, Style};
use ratatui::widgets::{Block, Borders, Paragraph};
use ratatui::{DefaultTerminal, Frame};

use unit_ui::prelude::*;

const RESPONSE: &str = "\
Let me help you build that Rust CLI tool.

First, create a new project:

```bash
cargo new my-cli
cd my-cli
```

Add the dependencies you need:

```toml
[dependencies]
clap = { version = \"4.5\", features = [\"derive\"] }
anyhow = \"1.0\"
```

Here's a basic argument parser:

```rust
use clap::Parser;

#[derive(Parser)]
#[command(name = \"my-cli\")]
#[command(about = \"A cool CLI tool\")]
struct Cli {
    #[arg(short, long)]
    name: String,

    #[arg(short, long, default_value_t = 1)]
    count: u32,
}

fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();
    for i in 0..cli.count {
        println!(\"Hello {} #{}\", cli.name, i + 1);
    }
    Ok(())
}
```

Run it:

```bash
cargo run -- --name World --count 3
```

You should see:

```text
Hello World #1
Hello World #2
Hello World #3
```

Let me also check for any common issues I should flag.";

const THINKING: &str = "The user wants to build a Rust CLI tool from scratch. I should provide a complete walkthrough with clap for argument parsing, anyhow for error handling, and a working example they can run immediately. Let me also include run instructions.";

fn main() -> io::Result<()> {
    let terminal = ratatui::init();
    let result = run(terminal);
    ratatui::restore();
    result
}

fn run(mut terminal: DefaultTerminal) -> io::Result<()> {
    let tokens = StyleToken::builder()
        .accent(providers::anthropic())
        .thinking(Color::Rgb(180, 150, 200))
        .build();

    let mut frame_count = 0;
    let mut visible = 0;
    let mut state = State::Thinking;
    let mut input_visible = String::from("build a rust cli tool");

    loop {
        terminal.draw(|frame| {
            draw(frame, &mut state, frame_count, visible, &input_visible, &tokens)
        })?;

        if event::poll(Duration::from_millis(20))? {
            if let Event::Key(key) = event::read()? {
                match key.code {
                    KeyCode::Esc | KeyCode::Char('q') => break,
                    KeyCode::Enter => {
                        match state {
                            State::Done => {
                                state = State::Thinking;
                                visible = 0;
                                frame_count = 0;
                            }
                            State::Thinking => {}
                            State::Streaming => {}
                        }
                    }
                    KeyCode::Char(c) => input_visible.push(c),
                    KeyCode::Backspace => { input_visible.pop(); }
                    _ => {}
                }
            }
        }

        frame_count += 1;

        match state {
            State::Thinking => {
                if frame_count > 20 {
                    state = State::Streaming;
                }
            }
            State::Streaming => {
                if visible < RESPONSE.chars().count() {
                    visible += 2;
                } else {
                    state = State::Done;
                }
            }
            State::Done => {}
        }
    }
    Ok(())
}

#[derive(PartialEq)]
enum State {
    Thinking,
    Streaming,
    Done,
}

fn draw(
    frame: &mut Frame,
    state: &State,
    frame_count: usize,
    visible: usize,
    input: &str,
    tokens: &StyleToken,
) {
    let [header, main, footer, status_line] = Layout::vertical([
        Constraint::Length(5),
        Constraint::Fill(1),
        Constraint::Length(3),
        Constraint::Length(1),
    ])
    .areas(frame.area());

    draw_header(frame, header, state, frame_count, tokens);
    draw_main(frame, main, state, visible, tokens);
    draw_footer(frame, footer, input, tokens);
    draw_status(frame, status_line, tokens);
}

fn draw_header(
    frame: &mut Frame,
    area: Rect,
    state: &State,
    frame_count: usize,
    tokens: &StyleToken,
) {
    let block = Block::default()
        .title(" Assistant CLI ")
        .borders(Borders::ALL)
        .style(Style::default().fg(tokens.accent));
    let inner = block.inner(area);
    frame.render_widget(block, area);

    let [status_area, history_area] = Layout::vertical([
        Constraint::Length(1),
        Constraint::Length(1),
    ])
    .areas(inner);

    match state {
        State::Thinking => {
            let spinner = Spinner::new()
                .label(format!("Thinking about your request..."))
                .frame_index(frame_count)
                .frames(spinners::dots())
                .style(tokens.clone());
            frame.render_widget(&spinner, status_area);
        }
        State::Streaming => {
            let spinner = Spinner::new()
                .label("Responding...")
                .frame_index(frame_count % 3)
                .frames(spinners::pulse())
                .style(tokens.clone());
            frame.render_widget(&spinner, status_area);
        }
        State::Done => {
            let done = Paragraph::new(" Response complete • Press Enter for new query • q to quit")
                .style(Style::default().fg(tokens.success));
            frame.render_widget(done, status_area);
        }
    }

    let history = MessageBubble::new("how do i make a rust cli?", Role::User)
        .style(tokens.clone());
    frame.render_widget(&history, history_area);
}

fn draw_main(
    frame: &mut Frame,
    area: Rect,
    state: &State,
    visible: usize,
    tokens: &StyleToken,
) {
    let block = Block::default()
        .title(" response ")
        .borders(Borders::ALL)
        .style(Style::default().fg(tokens.accent));
    let inner = block.inner(area);
    frame.render_widget(block, area);

    match state {
        State::Thinking => {
            let text = Paragraph::new("Analyzing your question...")
                .style(Style::default().fg(tokens.text_dim));
            frame.render_widget(text, inner);
        }
        State::Streaming | State::Done => {
            let thought = THINKING;
            let widget = StreamingText::new(RESPONSE)
                .thinking(thought)
                .visible_chars(visible)
                .style(tokens.clone());
            frame.render_widget(&widget, inner);
        }
    }
}

fn draw_footer(
    frame: &mut Frame,
    area: Rect,
    input: &str,
    tokens: &StyleToken,
) {
    let block = Block::default()
        .title(" input ")
        .borders(Borders::ALL)
        .style(Style::default().fg(tokens.accent));
    let inner = block.inner(area);
    frame.render_widget(block, area);

    let widget = BasicInput::new(input)
        .placeholder("Ask me anything about coding...")
        .focused(true)
        .style(tokens.clone());
    frame.render_widget(&widget, inner);
}

fn draw_status(
    frame: &mut Frame,
    area: Rect,
    tokens: &StyleToken,
) {
    let bar = StatusBar::new()
        .provider("Anthropic")
        .model("claude-sonnet-4-20250514")
        .token_count(847)
        .style(tokens.clone());
    frame.render_widget(&bar, area);
}
