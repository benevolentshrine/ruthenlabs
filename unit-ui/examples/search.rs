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
        .accent(Color::Rgb(0, 180, 200))
        .success(Color::Rgb(60, 200, 120))
        .build();

    let mut visible_results = 0;
    let mut frame_count = 0;

    let search_results = "\
src/main.rs:12:    let result = calculate()?;
src/main.rs:45:    // FIXME: handle error case
src/lib.rs:23:    fn calculate() -> Result<i32, Error> {
src/lib.rs:67:    let result = calculate();
src/lib.rs:89:    // TODO: add caching
tests/integration.rs:34:    let result = calculate().unwrap();
─────────────────────────────────────
6 matches found in 3 files
Search took 0.342s";

    loop {
        terminal.draw(|frame| {
            draw(frame, frame_count, visible_results, search_results, &tokens)
        })?;

        if event::poll(Duration::from_millis(25))? {
            if let Event::Key(key) = event::read()? {
                if matches!(key.code, KeyCode::Esc | KeyCode::Char('q')) {
                    break;
                }
            }
        }

        frame_count += 1;
        if visible_results < search_results.len() {
            visible_results += 2;
        }
    }
    Ok(())
}

fn draw(
    frame: &mut Frame,
    _frame_count: usize,
    visible_results: usize,
    results: &str,
    tokens: &StyleToken,
) {
    let [top, bottom] = Layout::vertical([
        Constraint::Fill(1),
        Constraint::Length(1),
    ])
    .areas(frame.area());

    let block = Block::default()
        .title(" Search CLI ")
        .borders(Borders::ALL)
        .style(Style::default().fg(tokens.accent));
    let inner = block.inner(top);
    frame.render_widget(block, top);

    let [left, right] = Layout::horizontal([
        Constraint::Percentage(40),
        Constraint::Percentage(60),
    ])
    .areas(inner);

    let input_block = Block::default()
        .title(" query ")
        .borders(Borders::ALL)
        .style(Style::default().fg(tokens.text_dim));
    let input_inner = input_block.inner(left);
    frame.render_widget(input_block, left);

    let search_input = BasicInput::new("fn calculate")
        .focused(true)
        .style(tokens.clone());
    frame.render_widget(&search_input, input_inner);

    let results_block = Block::default()
        .title(" results ")
        .borders(Borders::ALL)
        .style(Style::default().fg(tokens.success));
    let results_inner = results_block.inner(right);
    frame.render_widget(results_block, right);

    let stream = StreamingText::new(results)
        .visible_chars(visible_results)
        .style(tokens.clone());
    frame.render_widget(&stream, results_inner);

    let help = Paragraph::new("Streaming search results  |  q to quit")
        .style(Style::default().fg(tokens.text_dim));
    frame.render_widget(help, bottom);
}
