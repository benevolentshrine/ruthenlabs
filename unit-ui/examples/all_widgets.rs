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
    let tokens = StyleToken::builder()
        .accent(Color::Rgb(66, 133, 244))
        .build();

    let mut frame_count: usize = 0;
    let mut visible = 0;
    let response = "This example shows all unit-ui widgets together. Streaming text, spinners, chat bubbles, input fields, and a status bar.";

    loop {
        terminal.draw(|frame| draw(frame, frame_count, visible, &response, &tokens))?;

        if event::poll(Duration::from_millis(50))? {
            if let Event::Key(key) = event::read()? {
                match key.code {
                    KeyCode::Esc | KeyCode::Char('q') => break,
                    _ => {}
                }
            }
        }
        frame_count += 1;
        if visible < response.len() {
            visible += 1;
        }
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn draw(
    frame: &mut Frame,
    frame_count: usize,
    visible: usize,
    content: &str,
    tokens: &StyleToken,
) {
    let [top, mid, bottom] = Layout::vertical([
        Constraint::Length(6),
        Constraint::Fill(1),
        Constraint::Length(1),
    ])
    .areas(frame.area());

    let [left, right] = Layout::horizontal([Constraint::Percentage(50), Constraint::Percentage(50)])
        .areas(top);

    draw_streaming(frame, left, content, visible, tokens);
    draw_spinner_and_status(frame, right, frame_count, tokens);
    draw_input_and_messages(frame, mid, tokens);
    draw_status_bar(frame, bottom, tokens);
}

fn draw_streaming(frame: &mut Frame, area: Rect, content: &str, visible: usize, tokens: &StyleToken) {
    let block = Block::default()
        .title(" StreamingText ")
        .borders(Borders::ALL)
        .style(Style::default().fg(tokens.accent));
    let inner = block.inner(area);
    frame.render_widget(block, area);

    let widget = StreamingText::new(content)
        .thinking("Analyzing the request...")
        .visible_chars(visible)
        .style(tokens.clone());
    frame.render_widget(&widget, inner);
}

fn draw_spinner_and_status(frame: &mut Frame, area: Rect, frame_count: usize, tokens: &StyleToken) {
    let block = Block::default()
        .title(" Spinner + Status ")
        .borders(Borders::ALL)
        .style(Style::default().fg(tokens.accent));
    let inner = block.inner(area);
    frame.render_widget(block, area);

    let [spinner_area, _gap, _model_area] = Layout::vertical([
        Constraint::Length(1),
        Constraint::Length(1),
        Constraint::Length(1),
    ])
    .areas(inner);

    let spinner = Spinner::new()
        .label("Processing...")
        .frame_index(frame_count)
        .style(tokens.clone());
    frame.render_widget(&spinner, spinner_area);
}

fn draw_input_and_messages(frame: &mut Frame, area: Rect, tokens: &StyleToken) {
    let block = Block::default()
        .title(" Input + Messages ")
        .borders(Borders::ALL)
        .style(Style::default().fg(tokens.accent));
    let inner = block.inner(area);
    frame.render_widget(block, area);

    let msg = MessageBubble::new("Hello! How can I help?", Role::Assistant)
        .style(tokens.clone());
    frame.render_widget(&msg, inner);
}

fn draw_status_bar(frame: &mut Frame, area: Rect, tokens: &StyleToken) {
    let bar = StatusBar::new()
        .provider("Ollama")
        .model("qwen2.5-coder:7b")
        .token_count(1423)
        .style(tokens.clone());
    frame.render_widget(&bar, area);
}
