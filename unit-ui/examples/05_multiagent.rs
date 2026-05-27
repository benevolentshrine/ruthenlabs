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
        .accent(Color::Rgb(255, 130, 80))
        .text(Color::Rgb(240, 230, 220))
        .text_dim(Color::Rgb(150, 130, 120))
        .success(Color::Rgb(80, 220, 130))
        .surface(Color::Rgb(35, 28, 25))
        .error(Color::Rgb(240, 80, 80))
        .thinking(Color::Rgb(210, 180, 70))
        .build()
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    enable_raw_mode()?;
    let mut terminal = Terminal::new(CrosstermBackend::new(stdout()))?;
    execute!(terminal.backend_mut(), EnterAlternateScreen)?;

    let s = style();
    let started = Instant::now();
    let mut frame_count: usize = 0;
    let agents_data = [
        ("Researcher", "gathering data..."),
        ("Coder", "writing implementation..."),
        ("Reviewer", "checking quality..."),
        ("Deployer", "preparing release..."),
    ];

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
                .provider("Multi-Agent").model("orchestrator")
                .connection(ConnectionStatus::Connected).started_at(started)
                .token_count(frame_count as u64).style(s.clone());
            f.render_widget(&bar, top);

            let [left, right] = Layout::horizontal([
                Constraint::Percentage(55), Constraint::Percentage(45),
            ]).areas(main);

            let agents_block = Block::default().borders(Borders::ALL)
                .border_style(Style::default().fg(s.accent))
                .title(" Parallel Agents ");
            let ai = agents_block.inner(left);
            agents_block.render(left, f.buffer_mut());

            for (i, (name, status)) in agents_data.iter().enumerate() {
                let y = ai.y + 1 + i as u16 * 3;
                let spinner = Spinner::new().label(*name).frame_index(frame_count + i * 3).style(s.clone());
                f.render_widget(&spinner, Rect { x: ai.x + 1, y, width: ai.width.saturating_sub(2), height: 1 });
                let dots = ThinkingDots::new().label(*status).frame_index(frame_count).style(s.clone());
                f.render_widget(&dots, Rect { x: ai.x + 2, y: y + 1, width: ai.width.saturating_sub(3), height: 1 });
                let progress = Paragraph::new(format!("[{}%]", ((frame_count + i * 7) % 100).to_string()))
                    .style(Style::default().fg(s.success));
                f.render_widget(&progress, Rect { x: ai.x + 2, y: y + 2, width: ai.width.saturating_sub(3), height: 1 });
            }

            let log_block = Block::default().borders(Borders::ALL)
                .border_style(Style::default().fg(s.text_dim))
                .title(" Agent Log ");
            let li = log_block.inner(right);
            log_block.render(right, f.buffer_mut());

            let log_lines = [
                format!("[Researcher] found 12 sources"),
                format!("[Coder] wrote 3 files"),
                format!("[Reviewer] no issues found"),
                format!("[Deployer] build #{} queued", frame_count / 10),
            ];
            for (i, log) in log_lines.iter().enumerate() {
                let y = li.y + 1 + i as u16;
                let line = Paragraph::new(log.as_str()).style(Style::default().fg(s.text_dim));
                f.render_widget(&line, Rect { x: li.x + 1, y, width: li.width.saturating_sub(2), height: 1 });
            }

            let input = BasicInput::new("").placeholder("Orchestrator prompt...").style(s.clone());
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
