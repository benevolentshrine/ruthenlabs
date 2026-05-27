use std::io;
use std::time::Duration;

use crossterm::event::{self, Event, KeyCode};
use ratatui::layout::{Constraint, Layout};
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
    let tokens = StyleToken::builder()
        .accent(Color::Rgb(0, 200, 120))
        .thinking(Color::Rgb(200, 180, 80))
        .build();

    let mut visible = 0;
    let response = "To create a Rust project, you use `cargo new`. This initializes a new directory with a Cargo.toml file and a src directory containing a hello world program.";

    loop {
        terminal.draw(|frame| draw(frame, &response, visible, &tokens))?;

        if event::poll(Duration::from_millis(30))? {
            if let Event::Key(key) = event::read()? {
                match key.code {
                    KeyCode::Esc | KeyCode::Char('q') => break,
                    KeyCode::Right => visible = (visible + 1).min(response.len()),
                    KeyCode::Left => visible = visible.saturating_sub(1),
                    _ => {}
                }
            }
        } else {
            if visible < response.len() {
                visible = (visible + 1).min(response.len());
            }
        }
    }
    Ok(())
}

fn draw(frame: &mut Frame, content: &str, visible: usize, tokens: &StyleToken) {
    let [top, bottom] = Layout::vertical([
        Constraint::Fill(1),
        Constraint::Length(1),
    ])
    .areas(frame.area());

    let widget = StreamingText::new(content)
        .thinking("The user wants to create a new Rust project. Let me think about the recommended approach...")
        .visible_chars(visible)
        .style(tokens.clone());

    let block = Block::default()
        .title(" StreamingText ")
        .borders(Borders::ALL)
        .style(Style::default().fg(tokens.accent));
    let inner = block.inner(top);
    frame.render_widget(block, top);
    frame.render_widget(&widget, inner);

    let help = Paragraph::new("← → to adjust  |  auto-scrolls  |  q to quit")
        .style(Style::default().fg(tokens.text_dim));
    frame.render_widget(help, bottom);
}
