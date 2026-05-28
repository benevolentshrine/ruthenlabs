use std::io::stdout;
use std::time::Instant;

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
        .accent(Color::Rgb(0, 180, 140))
        .text(Color::Rgb(220, 230, 230))
        .text_dim(Color::Rgb(110, 140, 140))
        .success(Color::Rgb(60, 200, 120))
        .surface(Color::Rgb(18, 26, 24))
        .thinking(Color::Rgb(180, 180, 100))
        .error(Color::Rgb(220, 60, 60))
        .build()
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    enable_raw_mode()?;
    let mut terminal = Terminal::new(CrosstermBackend::new(stdout()))?;
    execute!(terminal.backend_mut(), EnterAlternateScreen)?;

    let s = style();
    let started = Instant::now();
    let mut _frame = 0u64;
    let mut selected = 0u16;
    let sessions = [
        ("2026-05-28", "Refactor auth module", 12, 3, "Completed"),
        ("2026-05-27", "Add payment gateway", 8, 1, "Completed"),
        ("2026-05-27", "Fix login timeout", 5, 2, "Completed"),
        ("2026-05-26", "Update dependencies", 3, 0, "Failed"),
        ("2026-05-25", "API rate limiting", 7, 1, "In progress"),
    ];

    loop {
        _frame += 1;
        terminal.draw(|f| {
            let area = f.area();
            f.render_widget(Paragraph::new("").style(Style::default().bg(s.surface)), area);

            let [top, main, _bot] = Layout::vertical([
                Constraint::Length(1), Constraint::Min(3), Constraint::Length(1),
            ]).areas(area);

            let chunks = Layout::horizontal([Constraint::Percentage(40), Constraint::Percentage(60)]).split(main);
            let left = chunks[0];
            let right = if area.width > 70 { chunks[1] } else { Rect::default() };

            let bar = StatusBar::new().provider("Session Explorer")
                .connection(ConnectionStatus::Connected).started_at(started)
                .model(&format!("{}/{} sessions", selected + 1, sessions.len()))
                .style(s.clone());
            f.render_widget(&bar, top);

            let block = Block::default().borders(Borders::ALL)
                .title(" History ").border_style(Style::default().fg(s.text_dim));
            let inner = block.inner(left);
            f.render_widget(&block, left);

            let details: Vec<String> = sessions.iter().map(|(_, _, tools, _, _)| format!("{} tools", tools)).collect();
            let entries: Vec<_> = sessions.iter().enumerate().map(|(i, (date, _title, _tools, _errs, status))| {
                TimelineEntry::new(date, if status == &"Completed" { "✓" } else { "✗" }, _title, &details[i])
            }).collect();
            f.render_widget(SessionTimeline::new().entries(&entries).scroll_offset(selected).style(s.clone()), inner);

            let rblock = Block::default().borders(Borders::ALL)
                .title(" Details ").border_style(Style::default().fg(s.accent));
            let rinner = rblock.inner(right);
            f.render_widget(&rblock, right);

            let (_, title, tools, errors, status) = sessions[selected as usize];
            let detail = format!("# {}\n\n**Status:** {}\n\n**Tools used:** {}\n**Errors:** {}\n\n## Reasoning\n\nThe session analyzed the codebase and applied changes across {} files. {} error(s) were encountered and resolved.",
                title, status, tools, errors, tools, errors);
            f.render_widget(MarkdownBlock::new().content(&detail).style(s.clone()), rinner);
        })?;

        if crossterm::event::poll(std::time::Duration::from_millis(80))? {
            if let crossterm::event::Event::Key(key) = crossterm::event::read()? {
                match key.code {
                    crossterm::event::KeyCode::Char('q') => break,
                    crossterm::event::KeyCode::Up => { selected = selected.saturating_sub(1); }
                    crossterm::event::KeyCode::Down => { selected = (selected + 1).min(sessions.len() as u16 - 1); }
                    _ => {}
                }
            }
        }
    }

    disable_raw_mode()?;
    execute!(terminal.backend_mut(), LeaveAlternateScreen)?;
    Ok(())
}
