use std::io::stdout;
use std::time::{Duration, Instant};

use crossterm::execute;
use crossterm::terminal::{
    disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen,
};
use ratatui::backend::CrosstermBackend;
use ratatui::layout::{Constraint, Layout, Rect};
use ratatui::style::{Color, Style};
use ratatui::widgets::{Block, Borders, Paragraph};
use ratatui::Terminal;

use unit_ui::prelude::*;
use unit_ui::style::StyleToken;

fn style() -> StyleToken {
    StyleToken::builder()
        .accent(Color::Rgb(140, 200, 60))
        .text(Color::Rgb(220, 230, 220))
        .text_dim(Color::Rgb(120, 140, 120))
        .success(Color::Rgb(60, 200, 120))
        .surface(Color::Rgb(22, 28, 22))
        .thinking(Color::Rgb(180, 200, 80))
        .error(Color::Rgb(220, 80, 60))
        .build()
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    enable_raw_mode()?;
    let mut terminal = Terminal::new(CrosstermBackend::new(stdout()))?;
    execute!(terminal.backend_mut(), EnterAlternateScreen)?;

    let s = style();
    let started = Instant::now();
    let mut frame = 0u64;
    let services = [
        ("api", "healthy"),
        ("db", "degraded"),
        ("cache", "healthy"),
        ("queue", "healthy"),
    ];
    let entries = [
        TimelineEntry::new("10:32:15", "🟢", "api", "200 OK — 12ms"),
        TimelineEntry::new("10:32:16", "🟡", "db", "connection pool 80%"),
        TimelineEntry::new("10:32:17", "🟢", "cache", "hit ratio 94%"),
        TimelineEntry::new("10:32:18", "🔴", "db", "query timeout 5s"),
    ];

    loop {
        frame += 1;
        terminal.draw(|f| {
            let area = f.area();
            f.render_widget(
                Paragraph::new("").style(Style::default().bg(s.surface)),
                area,
            );

            let [top, services_area, card_area, tl_area] = Layout::vertical([
                Constraint::Length(1),
                Constraint::Length(3),
                Constraint::Length(4),
                Constraint::Min(2),
            ])
            .areas(area);

            let bar = StatusBar::new()
                .provider("System Monitor")
                .connection(ConnectionStatus::Connected)
                .started_at(started)
                .token_count(frame)
                .style(s.clone());
            f.render_widget(&bar, top);

            let panels = Layout::horizontal([Constraint::Ratio(1, 4); 4]).split(services_area);

            for (i, (area, (name, status))) in panels.iter().zip(services.iter()).enumerate() {
                let block = Block::default()
                    .borders(Borders::ALL)
                    .title(*name)
                    .border_style(Style::default().fg(s.text_dim));
                let inner = block.inner(*area);
                f.render_widget(&block, *area);

                let color = if *status == "healthy" {
                    s.success
                } else {
                    s.thinking
                };
                f.render_widget(
                    Paragraph::new(*status).style(Style::default().fg(color)),
                    inner,
                );

                let dot_frame = (frame as usize + i * 2) % 6;
                f.render_widget(
                    ThinkingDots::new().frame_index(dot_frame).style(s.clone()),
                    Rect {
                        x: inner.x,
                        y: inner.y + 1,
                        width: inner.width,
                        height: 1,
                    },
                );
            }

            let card = ToolCallCard::new()
                .tool_name("health_check")
                .arguments("{\"endpoints\": [\"api\", \"db\", \"cache\", \"queue\"]}")
                .status(ToolStatus::Running)
                .duration(Duration::from_millis(frame * 20))
                .result("3/4 healthy — db degraded")
                .style(s.clone());
            f.render_widget(&card, card_area);

            f.render_widget(
                SessionTimeline::new().entries(&entries).style(s.clone()),
                tl_area,
            );
        })?;

        if crossterm::event::poll(std::time::Duration::from_millis(80))? {
            if let crossterm::event::Event::Key(k) = crossterm::event::read()? {
                if k.code == crossterm::event::KeyCode::Char('q') {
                    break;
                }
            }
        }
    }

    disable_raw_mode()?;
    execute!(terminal.backend_mut(), LeaveAlternateScreen)?;
    Ok(())
}
