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
        .accent(Color::Rgb(0, 200, 200))
        .text(Color::Rgb(220, 220, 240))
        .text_dim(Color::Rgb(100, 120, 140))
        .success(Color::Rgb(60, 200, 120))
        .surface(Color::Rgb(18, 22, 28))
        .thinking(Color::Rgb(200, 180, 80))
        .error(Color::Rgb(220, 60, 60))
        .build()
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    enable_raw_mode()?;
    let mut terminal = Terminal::new(CrosstermBackend::new(stdout()))?;
    execute!(terminal.backend_mut(), EnterAlternateScreen)?;

    let s = style();
    let started = Instant::now();
    let mut frame = 0u64;
    let mut agent_frames = [0usize; 3];
    let agents = [("search", "Reading files..."), ("analyze", "Parsing AST..."), ("generate", "Writing output...")];
    let events = [
        TimelineEntry::new("10:32:15", "🚀", "spawned", "3 agents deployed"),
        TimelineEntry::new("10:32:16", "🔍", "agent_0: searching", "src/**/*.rs"),
        TimelineEntry::new("10:32:17", "📊", "agent_1: analyzing", "47 files scanned"),
    ];

    loop {
        frame += 1;
        for i in 0..3 { agent_frames[i] = (agent_frames[i] + 1) % 6; }
        terminal.draw(|f| {
            let area = f.area();
            f.render_widget(Paragraph::new("").style(Style::default().bg(s.surface)), area);

            let [top, agents_area, tl, bot] = Layout::vertical([
                Constraint::Length(1), Constraint::Length(3), Constraint::Min(3), Constraint::Length(1),
            ]).areas(area);

            let bar = StatusBar::new().provider("Conductor").model("3 agents")
                .connection(ConnectionStatus::Connected).started_at(started)
                .style(s.clone());
            f.render_widget(&bar, top);

            let agent_panels = Layout::horizontal([Constraint::Ratio(1, 3); 3]).split(agents_area);
            for (i, (area, (name, label))) in agent_panels.iter().zip(agents.iter()).enumerate() {
                let block = Block::default().borders(Borders::ALL)
                    .title(*name).border_style(Style::default().fg(s.text_dim));
                let inner = block.inner(*area);
                f.render_widget(&block, *area);
                f.render_widget(Spinner::new().frame_index(agent_frames[i]).label(*label).style(s.clone()), inner);
            }

            let entries: Vec<TimelineEntry> = events.iter().cloned().chain([
                TimelineEntry::new("10:32:18", "⚡", "agent_0: tool_call", "grep 'fn main'"),
                TimelineEntry::new("10:32:19", "✓", "agent_0: done", "3 matches found"),
            ]).collect();
            f.render_widget(SessionTimeline::new().entries(&entries).style(s.clone()), tl);

            let card = ToolCallCard::new().tool_name("batch_analyze")
                .arguments("{\"agents\": 3, \"task\": \"codebase audit\"}")
                .status(ToolStatus::Running).duration(Duration::from_secs(frame / 10))
                .style(s.clone());
            f.render_widget(&card, bot);
        })?;

        if crossterm::event::poll(std::time::Duration::from_millis(80))? {
            if let crossterm::event::Event::Key(k) = crossterm::event::read()? {
                if k.code == crossterm::event::KeyCode::Char('q') { break; }
            }
        }
    }

    disable_raw_mode()?;
    execute!(terminal.backend_mut(), LeaveAlternateScreen)?;
    Ok(())
}
