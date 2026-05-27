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
        .accent(Color::Rgb(200, 120, 50))
        .thinking(Color::Rgb(180, 150, 80))
        .build();

    let mut visible = 0;
    let code = "\
fn fibonacci(n: u32) -> u32 {
    match n {
        0 => 0,
        1 => 1,
        _ => fibonacci(n - 1) + fibonacci(n - 2),
    }
}

fn main() {
    for i in 0..10 {
        println!(\"fib({}) = {}\", i, fibonacci(i));
    }
}";

    loop {
        terminal.draw(|frame| draw(frame, visible, code, &tokens))?;

        if event::poll(Duration::from_millis(30))? {
            if let Event::Key(key) = event::read()? {
                if matches!(key.code, KeyCode::Esc | KeyCode::Char('q')) {
                    break;
                }
            }
        }

        if visible < code.len() {
            visible += 1;
        }
    }
    Ok(())
}

fn draw(frame: &mut Frame, visible: usize, code: &str, tokens: &StyleToken) {
    let [top, bottom] = Layout::vertical([
        Constraint::Fill(1),
        Constraint::Length(1),
    ])
    .areas(frame.area());

    let block = Block::default()
        .title(" Code Assistant CLI ")
        .borders(Borders::ALL)
        .style(Style::default().fg(tokens.accent));
    let inner = block.inner(top);
    frame.render_widget(block, top);

    let stream = StreamingText::new(code)
        .thinking("The user wants a Fibonacci function in Rust. I'll provide a recursive implementation...")
        .visible_chars(visible)
        .style(tokens.clone());
    frame.render_widget(&stream, inner);

    let help = Paragraph::new("Streaming code review  |  q to quit")
        .style(Style::default().fg(tokens.text_dim));
    frame.render_widget(help, bottom);
}
