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
        .accent(Color::Rgb(255, 160, 0))
        .text_dim(Color::Rgb(100, 100, 120))
        .build();

    let mut frame_count = 0;

    loop {
        terminal.draw(|frame| draw(frame, frame_count, &tokens))?;

        if event::poll(Duration::from_millis(100))? {
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
    let big = Block::default()
        .title(" Monitor CLI ")
        .borders(Borders::ALL)
        .style(Style::default().fg(tokens.accent));
    let inner = big.inner(frame.area());
    frame.render_widget(big, frame.area());

    let [top, mid, bottom] = Layout::vertical([
        Constraint::Length(5),
        Constraint::Length(6),
        Constraint::Length(1),
    ])
    .areas(inner);

    let [cpu_area, mem_area, disk_area] = Layout::horizontal([
        Constraint::Percentage(33),
        Constraint::Percentage(33),
        Constraint::Percentage(34),
    ])
    .areas(top);

    let [svc1_area, svc2_area, svc3_area, svc4_area] = Layout::horizontal([
        Constraint::Percentage(25),
        Constraint::Percentage(25),
        Constraint::Percentage(25),
        Constraint::Percentage(25),
    ])
    .areas(mid);

    draw_cpu(frame, cpu_area, frame_count, tokens);
    draw_mem(frame, mem_area, frame_count, tokens);
    draw_disk(frame, disk_area, frame_count, tokens);
    draw_services(frame, svc1_area, svc2_area, svc3_area, svc4_area, frame_count, tokens);
    draw_status_bar(frame, bottom, tokens);
}

fn draw_cpu(frame: &mut Frame, area: Rect, frame_count: usize, tokens: &StyleToken) {
    let block = Block::default()
        .title(" CPU ")
        .borders(Borders::ALL)
        .style(Style::default().fg(tokens.accent));
    let inner = block.inner(area);
    frame.render_widget(block, area);

    let spinner = Spinner::new()
        .frame_index(frame_count)
        .frames(spinners::pulse())
        .label(format!("{}%", 42 + (frame_count % 20)))
        .style(tokens.clone());
    frame.render_widget(&spinner, inner);
}

fn draw_mem(frame: &mut Frame, area: Rect, frame_count: usize, tokens: &StyleToken) {
    let block = Block::default()
        .title(" MEM ")
        .borders(Borders::ALL)
        .style(Style::default().fg(tokens.accent));
    let inner = block.inner(area);
    frame.render_widget(block, area);

    let spinner = Spinner::new()
        .frame_index(frame_count)
        .frames(spinners::braille())
        .label(format!("{} GB / 32 GB", 12 + (frame_count % 4)))
        .style(tokens.clone());
    frame.render_widget(&spinner, inner);
}

fn draw_disk(frame: &mut Frame, area: Rect, frame_count: usize, tokens: &StyleToken) {
    let block = Block::default()
        .title(" DISK ")
        .borders(Borders::ALL)
        .style(Style::default().fg(tokens.accent));
    let inner = block.inner(area);
    frame.render_widget(block, area);

    let spinner = Spinner::new()
        .frame_index(frame_count)
        .frames(spinners::arc())
        .label(format!("{} GB / 256 GB", 180 + (frame_count % 8)))
        .style(tokens.clone());
    frame.render_widget(&spinner, inner);
}

fn draw_services(
    frame: &mut Frame,
    a: Rect, b: Rect, c: Rect, d: Rect,
    frame_count: usize,
    tokens: &StyleToken,
) {
    let s1 = Spinner::new()
        .label("sandbox")
        .frame_index(frame_count)
        .frames(spinners::bounce())
        .style(tokens.clone());
    frame.render_widget(&s1, a);

    let s2 = Spinner::new()
        .label("indexer")
        .frame_index(frame_count)
        .frames(spinners::bounce())
        .style(tokens.clone());
    frame.render_widget(&s2, b);

    let s3 = Spinner::new()
        .label("orchestrator")
        .frame_index(frame_count)
        .frames(spinners::bounce())
        .style(tokens.clone());
    frame.render_widget(&s3, c);

    let s4 = Spinner::new()
        .label("ollama")
        .frame_index(frame_count % 2)
        .frames(spinners::line())
        .style(tokens.clone());
    frame.render_widget(&s4, d);
}

fn draw_status_bar(frame: &mut Frame, area: Rect, tokens: &StyleToken) {
    let bar = StatusBar::new()
        .provider("Local")
        .model("Apple M4 · 32 GB")
        .token_count(0)
        .style(tokens.clone());
    frame.render_widget(&bar, area);
}
