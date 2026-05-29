use std::io::stdout;
use std::time::Instant;

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
        .accent(Color::Rgb(255, 160, 60))
        .text(Color::Rgb(240, 240, 230))
        .text_dim(Color::Rgb(130, 130, 140))
        .success(Color::Rgb(60, 200, 120))
        .surface(Color::Rgb(30, 28, 26))
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
    let mut approved = false;
    let diff_text = "@@ -1,5 +1,7 @@\n fn calculate_total(items: &[Item]) -> f64 {\n-    items.iter().map(|i| i.price).sum()\n+    items.iter()\n+        .filter(|i| i.active)\n+        .map(|i| i.price * (1.0 - i.discount))\n+        .sum()\n }\n \n-pub fn main() {\n+pub fn run() {\n     let items = vec![\n-        Item { price: 10.0 },\n+        Item { price: 10.0, active: true, discount: 0.1 },\n     ];\n }";

    loop {
        frame += 1;
        terminal.draw(|f| {
            let area = f.area();
            f.render_widget(
                Paragraph::new("").style(Style::default().bg(s.surface)),
                area,
            );

            let [top, main, side, bot] = Layout::vertical([
                Constraint::Length(1),
                Constraint::Min(3),
                Constraint::Length(8),
                Constraint::Length(1),
            ])
            .areas(area);

            let chunks =
                Layout::horizontal([Constraint::Percentage(60), Constraint::Percentage(40)])
                    .split(main);
            let diff_area = chunks[0];
            let tl_area = if area.width > 80 {
                chunks[1]
            } else {
                Rect::default()
            };

            let bar = StatusBar::new()
                .provider("Review Bot")
                .connection(ConnectionStatus::Connected)
                .started_at(started)
                .style(s.clone());
            f.render_widget(&bar, top);

            let block = Block::default()
                .borders(Borders::ALL)
                .title(" Changes ")
                .border_style(Style::default().fg(s.text_dim));
            let inner = block.inner(diff_area);
            f.render_widget(&block, diff_area);
            f.render_widget(
                DiffView::new()
                    .diff(diff_text)
                    .file("src/checkout.rs")
                    .style(s.clone()),
                inner,
            );

            let entries = [
                TimelineEntry::new("10:32:15", "📂", "review_requested", "checkout.rs"),
                TimelineEntry::new("10:32:16", "🔍", "analyzing", "3 functions affected"),
                TimelineEntry::new("10:32:18", "⚡", "suggest_change", "line 4: add filter"),
                TimelineEntry::new(
                    "10:32:20",
                    if approved { "✓" } else { "◌" },
                    if approved {
                        "approved"
                    } else {
                        "awaiting_approval"
                    },
                    "",
                ),
            ];
            f.render_widget(
                SessionTimeline::new().entries(&entries).style(s.clone()),
                tl_area,
            );

            let prompt = ApprovalPrompt::new()
                .tool_name("edit_file")
                .args("src/checkout.rs")
                .reason("Add active filter and discount support")
                .status(if approved {
                    ApprovalStatus::Approved
                } else {
                    ApprovalStatus::Pending
                })
                .style(s.clone());
            f.render_widget(&prompt, side);

            let st = format!(
                " {} | arrows: toggle panels | Enter: approve | q: quit",
                if approved {
                    "✓ Approved"
                } else {
                    "◌ Pending"
                }
            );
            f.render_widget(
                Paragraph::new(st).style(Style::default().fg(s.text_dim)),
                bot,
            );
        })?;

        if crossterm::event::poll(std::time::Duration::from_millis(80))? {
            if let crossterm::event::Event::Key(key) = crossterm::event::read()? {
                match key.code {
                    crossterm::event::KeyCode::Char('q') => break,
                    crossterm::event::KeyCode::Enter => approved = !approved,
                    _ => {}
                }
            }
        }
    }

    disable_raw_mode()?;
    execute!(terminal.backend_mut(), LeaveAlternateScreen)?;
    Ok(())
}
