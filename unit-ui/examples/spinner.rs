use std::io;
use std::time::Duration;

use crossterm::event::{self, Event, KeyCode};
use ratatui::layout::{Constraint, Layout};
use ratatui::style::{Color, Style};
use ratatui::widgets::Paragraph;
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
        .accent(Color::Rgb(200, 140, 240))
        .build();

    let mut frame_count: usize = 0;

    loop {
        terminal.draw(|frame| draw(frame, frame_count, &tokens))?;

        if event::poll(Duration::from_millis(80))? {
            if let Event::Key(key) = event::read()? {
                if matches!(key.code, KeyCode::Esc | KeyCode::Char('q')) {
                    break;
                }
            }
        }
        frame_count += 1;
    }
    Ok(())
}

fn draw(frame: &mut Frame, frame_count: usize, tokens: &StyleToken) {
    let [top, bottom] = Layout::vertical([
        Constraint::Length(3),
        Constraint::Length(1),
    ])
    .areas(frame.area());

    let spinner = Spinner::new()
        .label("Thinking about your request...")
        .frame_index(frame_count)
        .style(tokens.clone());

    frame.render_widget(&spinner, top);

    let help = Paragraph::new("q to quit")
        .style(Style::default().fg(tokens.text_dim));
    frame.render_widget(help, bottom);
}
