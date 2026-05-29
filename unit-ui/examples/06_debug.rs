use std::io::stdout;
use std::time::Instant;

use crossterm::execute;
use crossterm::terminal::{
    disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen,
};
use ratatui::backend::CrosstermBackend;
use ratatui::layout::{Constraint, Layout, Rect};
use ratatui::prelude::Widget;
use ratatui::style::{Color, Style};
use ratatui::widgets::{Block, Borders, Paragraph};
use ratatui::Terminal;

use unit_ui::prelude::*;
use unit_ui::style::StyleToken;

fn style() -> StyleToken {
    StyleToken::builder()
        .accent(Color::Rgb(100, 200, 255))
        .text(Color::Rgb(200, 215, 230))
        .text_dim(Color::Rgb(100, 120, 140))
        .success(Color::Rgb(60, 220, 130))
        .surface(Color::Rgb(20, 25, 35))
        .error(Color::Rgb(255, 80, 80))
        .thinking(Color::Rgb(200, 190, 90))
        .build()
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    enable_raw_mode()?;
    let mut terminal = Terminal::new(CrosstermBackend::new(stdout()))?;
    execute!(terminal.backend_mut(), EnterAlternateScreen)?;

    let s = style();
    let started = Instant::now();
    let mut frame_count: usize = 0;
    let mut log_entries: Vec<(&'static str, Color)> = vec![
        ("[INFO] Debug console started", Color::Rgb(100, 200, 255)),
        ("[INFO] Connected to backend", Color::Rgb(60, 220, 130)),
    ];

    loop {
        frame_count += 1;
        if frame_count % 15 == 0 {
            let entry = if frame_count % 30 == 0 {
                (
                    "[ERROR] Connection timeout on request #42",
                    Color::Rgb(255, 80, 80),
                )
            } else if frame_count % 20 == 0 {
                ("[WARN] Memory usage exceeds 80%", Color::Rgb(200, 190, 90))
            } else {
                ("[INFO] Processing task...", Color::Rgb(100, 200, 255))
            };
            log_entries.push(entry);
        }

        terminal.draw(|f| {
            let area = f.area();
            let bg = Style::default().bg(s.surface);
            f.render_widget(Paragraph::new("").style(bg), area);

            let [top, mid, bot] = Layout::vertical([
                Constraint::Length(1),
                Constraint::Min(1),
                Constraint::Length(3),
            ])
            .areas(area);

            let bar = StatusBar::new()
                .provider("Debug Console")
                .model("diagnostic")
                .connection(if frame_count % 30 < 25 {
                    ConnectionStatus::Connected
                } else {
                    ConnectionStatus::Disconnected
                })
                .started_at(started)
                .style(s.clone());
            f.render_widget(&bar, top);

            let block = Block::default()
                .borders(Borders::ALL)
                .border_style(Style::default().fg(s.accent))
                .title(" Diagnostics ");
            let inner = block.inner(mid);
            block.render(mid, f.buffer_mut());

            let top_line = format!(
                "Frame: {} | Entries: {} | Status: {}",
                frame_count,
                log_entries.len(),
                if frame_count % 30 < 25 {
                    "RUNNING"
                } else {
                    "RECONNECTING"
                }
            );
            let header = Paragraph::new(top_line).style(Style::default().fg(s.thinking));
            f.render_widget(
                &header,
                Rect {
                    x: inner.x + 1,
                    y: inner.y,
                    width: inner.width.saturating_sub(2),
                    height: 1,
                },
            );

            let spinner = Spinner::new()
                .label("monitoring")
                .frame_index(frame_count)
                .style(s.clone());
            f.render_widget(
                &spinner,
                Rect {
                    x: inner.x + 1,
                    y: inner.y + 1,
                    width: inner.width.saturating_sub(2),
                    height: 1,
                },
            );

            let mut y = inner.y + 3;
            for &(msg, color) in log_entries
                .iter()
                .rev()
                .take((inner.height - 3) as usize)
                .rev()
            {
                if y >= inner.bottom() {
                    break;
                }
                let line = Paragraph::new(msg).style(Style::default().fg(color));
                f.render_widget(
                    &line,
                    Rect {
                        x: inner.x + 1,
                        y,
                        width: inner.width.saturating_sub(2),
                        height: 1,
                    },
                );
                y += 1;
            }

            let input = BasicInput::new("")
                .placeholder("Debug command...")
                .style(s.clone());
            f.render_widget(&input, bot);
        })?;

        if crossterm::event::poll(std::time::Duration::from_millis(100))? {
            if let crossterm::event::Event::Key(key) = crossterm::event::read()? {
                if key.code == crossterm::event::KeyCode::Char('q') {
                    break;
                }
            }
        }
    }

    disable_raw_mode()?;
    execute!(terminal.backend_mut(), LeaveAlternateScreen)?;
    Ok(())
}
