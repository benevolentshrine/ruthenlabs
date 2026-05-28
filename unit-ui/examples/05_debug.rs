use std::io::stdout;
use std::time::{Duration, Instant};

use crossterm::execute;
use crossterm::terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen};
use ratatui::backend::CrosstermBackend;
use ratatui::layout::{Constraint, Layout, Rect};
use ratatui::style::{Color, Style};
use ratatui::widgets::{Block, Borders, Paragraph};
use ratatui::Terminal;

use unit_ui::prelude::*;
use unit_ui::style::StyleToken;

fn style() -> StyleToken {
    StyleToken::builder()
        .accent(Color::Rgb(200, 80, 60))
        .text(Color::Rgb(230, 230, 230))
        .text_dim(Color::Rgb(130, 130, 130))
        .success(Color::Rgb(60, 200, 120))
        .surface(Color::Rgb(28, 24, 22))
        .thinking(Color::Rgb(200, 180, 80))
        .error(Color::Rgb(255, 80, 60))
        .build()
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    enable_raw_mode()?;
    let mut terminal = Terminal::new(CrosstermBackend::new(stdout()))?;
    execute!(terminal.backend_mut(), EnterAlternateScreen)?;

    let s = style();
    let started = Instant::now();
    let mut frame = 0u64;
    let mut input_text = String::new();
    let logs = [
        "[ERROR] src/db.rs:42 — connection timeout after 30s",
        "[WARN]  src/cache.rs:17 — stale entry detected, evicting",
        "[INFO]  src/api.rs:83 — retry attempt 2/3",
        "[DEBUG] src/db.rs:55 — opening new connection pool",
        "[ERROR] src/auth.rs:12 — token expired, refreshing",
    ];

    loop {
        frame += 1;
        terminal.draw(|f| {
            let area = f.area();
            f.render_widget(Paragraph::new("").style(Style::default().bg(s.surface)), area);

            let [top, main, side, bot] = Layout::vertical([
                Constraint::Length(1), Constraint::Min(5), Constraint::Length(6), Constraint::Length(3),
            ]).areas(area);

            let chunks = Layout::horizontal([Constraint::Percentage(55), Constraint::Percentage(45)]).split(main);
            let left = chunks[0];
            let right = if area.width > 80 { chunks[1] } else { Rect::default() };

            let bar = StatusBar::new().provider("Debug Console")
                .connection(ConnectionStatus::Connected).started_at(started)
                .token_count(frame).style(s.clone());
            f.render_widget(&bar, top);

            let block = Block::default().borders(Borders::ALL)
                .title(" Logs ").border_style(Style::default().fg(s.text_dim));
            let inner = block.inner(left);
            f.render_widget(&block, left);
            let log_block = Block::default().borders(Borders::ALL)
                .border_style(Style::default().fg(s.text_dim));
            let log_inner = log_block.inner(Rect { x: inner.x, y: inner.y, width: inner.width, height: inner.height });
            f.render_widget(&log_block, Rect { x: inner.x, y: inner.y, width: inner.width, height: inner.height });
            for (i, log) in logs.iter().enumerate() {
                let y = log_inner.y + i as u16;
                if y >= log_inner.bottom() { break; }
                let color = if log.starts_with("[ERROR]") { s.error }
                    else if log.starts_with("[WARN]") { s.thinking }
                    else { s.text_dim };
                f.render_widget(Paragraph::new(*log).style(Style::default().fg(color)),
                    Rect { x: log_inner.x, y, width: log_inner.width, height: 1 });
            }

            let card = ToolCallCard::new().tool_name("diagnose")
                .arguments("{\"target\": \"db\", \"timeout\": 30}")
                .status(match frame % 12 { 0..=4 => ToolStatus::Running, 5..=8 => ToolStatus::Success, _ => ToolStatus::Error })
                .duration(Duration::from_secs(frame / 10))
                .result(if frame % 12 > 8 { "Error: connection refused\nRetry scheduled in 5s" } else { "OK: 3 connections active" })
                .style(s.clone());
            f.render_widget(&card, right);

            let entries = [
                TimelineEntry::new("+0.0s", "🚨", "error", "db connection timeout"),
                TimelineEntry::new("+2.3s", "🔄", "retry", "attempt 2/3"),
                TimelineEntry::new("+5.1s", "✓", "resolved", "connection pool reset"),
            ];
            f.render_widget(SessionTimeline::new().entries(&entries).style(s.clone()), side);

            f.render_widget(BasicInput::new(&input_text).placeholder("debug> ").style(s.clone()), bot);
        })?;

        if crossterm::event::poll(std::time::Duration::from_millis(80))? {
            if let crossterm::event::Event::Key(key) = crossterm::event::read()? {
                match key.code {
                    crossterm::event::KeyCode::Char('q') => break,
                    crossterm::event::KeyCode::Char(c) => input_text.push(c),
                    crossterm::event::KeyCode::Enter => input_text.clear(),
                    crossterm::event::KeyCode::Backspace => { input_text.pop(); }
                    _ => {}
                }
            }
        }
    }

    disable_raw_mode()?;
    execute!(terminal.backend_mut(), LeaveAlternateScreen)?;
    Ok(())
}
