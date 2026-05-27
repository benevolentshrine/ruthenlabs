use std::io;
use std::time::Duration;

use crossterm::event::{self, Event, KeyCode};
use ratatui::layout::{Constraint, Layout};
use ratatui::style::Style;
use ratatui::prelude::Stylize;
use ratatui::widgets::{Block, Borders, Gauge};
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
        .accent(providers::ollama())
        .build();

    let mut frame_count: usize = 0;
    let mut progress: u16 = 0;

    loop {
        terminal.draw(|frame| draw(frame, frame_count, progress, &tokens))?;

        if event::poll(Duration::from_millis(80))? {
            if let Event::Key(key) = event::read()? {
                if matches!(key.code, KeyCode::Esc | KeyCode::Char('q')) {
                    break;
                }
            }
        }

        frame_count += 1;
        if progress < 100 {
            progress += 1;
        }
    }
    Ok(())
}

fn draw(frame: &mut Frame, frame_count: usize, progress: u16, tokens: &StyleToken) {
    let block = Block::default()
        .title(" Model Puller CLI ")
        .borders(Borders::ALL)
        .style(Style::default().fg(tokens.accent));
    let inner = block.inner(frame.area());
    frame.render_widget(block, frame.area());

    let [spinner_area, model1, model2, model3, gauge_area, status_area] = Layout::vertical([
        Constraint::Length(1),
        Constraint::Length(1),
        Constraint::Length(1),
        Constraint::Length(1),
        Constraint::Length(1),
        Constraint::Length(1),
    ])
    .areas(inner);

    let main_spinner = Spinner::new()
        .label("Pulling models...")
        .frame_index(frame_count)
        .frames(spinners::dots())
        .style(tokens.clone());
    frame.render_widget(&main_spinner, spinner_area);

    let m1_spinner = Spinner::new()
        .label("qwen2.5-coder:7b  ██████████░░░░░░  62%  (412 MB / 664 MB)")
        .frame_index(frame_count)
        .frames(spinners::braille())
        .style(tokens.clone());
    frame.render_widget(&m1_spinner, model1);

    let m2_spinner = Spinner::new()
        .label("llama3.2:3b      ████████████████░░  81%  (1.2 GB / 1.5 GB)")
        .frame_index(frame_count)
        .frames(spinners::braille())
        .style(tokens.clone());
    frame.render_widget(&m2_spinner, model2);

    let m3_spinner = Spinner::new()
        .label("nomic-embed-text  ████████░░░░░░░░  40%  (128 MB / 320 MB)")
        .frame_index(frame_count)
        .frames(spinners::arc())
        .style(tokens.clone());
    frame.render_widget(&m3_spinner, model3);

    let gauge = Gauge::default()
        .percent(progress)
        .fg(tokens.accent)
        .bg(tokens.surface)
        .label(format!("Overall: {}%", progress));
    frame.render_widget(gauge, gauge_area);

    let bar = StatusBar::new()
        .provider("Ollama")
        .model("3 models downloading")
        .token_count(progress as u64 * 24)
        .style(tokens.clone());
    frame.render_widget(&bar, status_area);
}
