use std::io::stdout;
use std::time::Instant;

use crossterm::execute;
use crossterm::terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen};
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
        .accent(Color::Rgb(255, 180, 50))
        .text(Color::Rgb(220, 230, 220))
        .text_dim(Color::Rgb(120, 140, 120))
        .success(Color::Rgb(80, 220, 130))
        .surface(Color::Rgb(22, 30, 22))
        .error(Color::Rgb(240, 80, 80))
        .thinking(Color::Rgb(200, 180, 80))
        .build()
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    enable_raw_mode()?;
    let mut terminal = Terminal::new(CrosstermBackend::new(stdout()))?;
    execute!(terminal.backend_mut(), EnterAlternateScreen)?;

    let s = style();
    let started = Instant::now();
    let mut frame_count: usize = 0;

    loop {
        frame_count += 1;
        terminal.draw(|f| {
            let area = f.area();
            let bg = Style::default().bg(s.surface);
            f.render_widget(Paragraph::new("").style(bg), area);

            let [top, main, bot] = Layout::vertical([
                Constraint::Length(1), Constraint::Min(1), Constraint::Length(3),
            ]).areas(area);

            let bar = StatusBar::new()
                .provider("Dashboard").model("monitor-v1")
                .connection(if frame_count % 60 < 55 { ConnectionStatus::Connected } else { ConnectionStatus::Connecting })
                .started_at(started).token_count(frame_count as u64 * 10)
                .style(s.clone());
            f.render_widget(&bar, top);

            let [left, right] = Layout::horizontal([
                Constraint::Percentage(50), Constraint::Percentage(50),
            ]).areas(main);

            let left_block = Block::default().borders(Borders::ALL)
                .border_style(Style::default().fg(s.accent))
                .title(" Agents ");
            let li = left_block.inner(left);
            left_block.render(left, f.buffer_mut());

            let agents = ["Research", "Code", "Review", "Deploy"];
            for (i, name) in agents.iter().enumerate() {
                let y = li.y + 1 + i as u16 * 2;
                let spinner = Spinner::new().label(*name).frame_index(frame_count).style(s.clone());
                f.render_widget(&spinner, Rect { x: li.x + 1, y, width: li.width.saturating_sub(2), height: 1 });
                let dots = ThinkingDots::new().label("processing").frame_index(frame_count).style(s.clone());
                f.render_widget(&dots, Rect { x: li.x + 1, y: y + 1, width: li.width.saturating_sub(2), height: 1 });
            }

            let right_block = Block::default().borders(Borders::ALL)
                .border_style(Style::default().fg(s.text_dim))
                .title(" Activity ");
            let ri = right_block.inner(right);
            right_block.render(right, f.buffer_mut());

            let logs = [
                "✓ Connected to API server",
                "▶ Running research task...",
                "✓ Code generation complete",
                "▶ Running tests...",
                "⚠ Memory usage: 72%",
            ];
            for (i, log) in logs.iter().enumerate() {
                let y = ri.y + 1 + i as u16;
                let color = if log.starts_with("✓") { s.success } else if log.starts_with("⚠") { s.thinking } else { s.text_dim };
                let line = Paragraph::new(*log).style(Style::default().fg(color));
                f.render_widget(&line, Rect { x: ri.x + 1, y, width: ri.width.saturating_sub(2), height: 1 });
            }

            let input = BasicInput::new("").placeholder("Enter command...").style(s.clone());
            f.render_widget(&input, bot);
        })?;

        if crossterm::event::poll(std::time::Duration::from_millis(100))? {
            if let crossterm::event::Event::Key(key) = crossterm::event::read()? {
                if key.code == crossterm::event::KeyCode::Char('q') { break; }
            }
        }
    }

    disable_raw_mode()?;
    execute!(terminal.backend_mut(), LeaveAlternateScreen)?;
    Ok(())
}
