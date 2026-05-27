use std::io;
use std::time::Duration;

use crossterm::event::{self, Event, KeyCode};
use ratatui::layout::{Constraint, Layout, Rect};
use ratatui::style::{Color, Style};
use ratatui::widgets::{Block, Borders};
use ratatui::{DefaultTerminal, Frame};

use unit_ui::prelude::*;

fn main() -> io::Result<()> {
    let terminal = ratatui::init();
    let result = run(terminal);
    ratatui::restore();
    result
}

fn run(mut terminal: DefaultTerminal) -> io::Result<()> {
    let bot = StyleToken::builder()
        .accent(providers::anthropic())
        .thinking(Color::Rgb(180, 160, 200))
        .build();

    let user_tokens = StyleToken::builder()
        .accent(providers::openai())
        .build();

    let status_tokens = StyleToken::builder()
        .accent(providers::ollama())
        .build();

    let mut frame_count: usize = 0;
    let mut visible_bot = 0;

    let bot_response = "\
To create a Rust CLI, you can use `clap` for argument parsing.

Here's a minimal example:

```rust
use clap::Parser;

#[derive(Parser)]
struct Args {
    name: String,
}

fn main() {
    let args = Args::parse();
    println!(\"Hello, {}!\", args.name);
}
```

Run it with `cargo run -- --name World`.";

    loop {
        terminal.draw(|frame| {
            draw(frame, frame_count, visible_bot, bot_response, &bot, &user_tokens, &status_tokens)
        })?;

        if event::poll(Duration::from_millis(40))? {
            if let Event::Key(key) = event::read()? {
                match key.code {
                    KeyCode::Esc | KeyCode::Char('q') => break,
                    KeyCode::Enter => visible_bot = 0,
                    _ => {}
                }
            }
        }

        frame_count += 1;
        if visible_bot < bot_response.len() {
            visible_bot += 2;
        }
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn draw(
    frame: &mut Frame,
    _frame_count: usize,
    visible_bot: usize,
    bot_response: &str,
    bot: &StyleToken,
    user_tokens: &StyleToken,
    status_tokens: &StyleToken,
) {
    let [header, chat, input_line, status_area] = Layout::vertical([
        Constraint::Length(3),
        Constraint::Fill(1),
        Constraint::Length(3),
        Constraint::Length(1),
    ])
    .areas(frame.area());

    draw_header(frame, header);
    draw_chat(frame, chat, visible_bot, bot_response, bot, user_tokens);
    draw_input(frame, input_line, user_tokens);
    draw_status(frame, status_area, status_tokens);
}

fn draw_header(frame: &mut Frame, area: Rect) {
    let block = Block::default()
        .title(" Chat CLI ")
        .borders(Borders::ALL)
        .style(Style::default().fg(providers::anthropic()));
    frame.render_widget(block, area);
}

fn draw_chat(
    frame: &mut Frame,
    area: Rect,
    visible_bot: usize,
    bot_response: &str,
    bot: &StyleToken,
    user_tokens: &StyleToken,
) {
    let block = Block::default()
        .borders(Borders::ALL)
        .style(Style::default().fg(user_tokens.accent));
    let inner = block.inner(area);
    frame.render_widget(block, area);

    let [user_msg, bot_msg] = Layout::vertical([
        Constraint::Length(1),
        Constraint::Fill(1),
    ])
    .areas(inner);

    let user_bubble = MessageBubble::new("how do i make a rust cli?", Role::User)
        .style(user_tokens.clone());
    frame.render_widget(&user_bubble, user_msg);

    let stream = StreamingText::new(bot_response)
        .thinking("The user wants a simple Rust CLI example. Let me think about the best approach using clap...")
        .visible_chars(visible_bot)
        .style(bot.clone());
    frame.render_widget(&stream, bot_msg);
}

fn draw_input(frame: &mut Frame, area: Rect, tokens: &StyleToken) {
    let input = BasicInput::new("")
        .placeholder("Type a message and press Enter...")
        .style(tokens.clone());
    frame.render_widget(&input, area);
}

fn draw_status(frame: &mut Frame, area: Rect, tokens: &StyleToken) {
    let bar = StatusBar::new()
        .provider("Anthropic")
        .model("claude-sonnet-4")
        .token_count(347)
        .style(tokens.clone());
    frame.render_widget(&bar, area);
}
