use std::io::stdout;
use std::time::Instant;

use crossterm::execute;
use crossterm::terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen};
use ratatui::backend::CrosstermBackend;
use ratatui::layout::{Constraint, Layout};
use ratatui::style::{Color, Style};
use ratatui::widgets::{Block, Borders, Paragraph};
use ratatui::Terminal;

use unit_ui::prelude::*;
use unit_ui::style::StyleToken;

fn style() -> StyleToken {
    StyleToken::builder()
        .accent(Color::Rgb(100, 180, 255))
        .text(Color::Rgb(220, 230, 240))
        .text_dim(Color::Rgb(100, 120, 140))
        .success(Color::Rgb(60, 200, 120))
        .surface(Color::Rgb(18, 22, 30))
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
    let mut frame = 0u64;
    let mut mode = 0u8;
    let mut input = String::new();

    let diff_text = "@@ -10,6 +10,8 @@\n fn process(items: &[Item]) -> Result<()> {\n+    let validated: Vec<_> = items.iter()\n+        .filter(|i| i.is_valid())\n     .map(|i| i.transform())\n     .collect();";

    let entries = [
        TimelineEntry::new("14:20:01", "📂", "file_read", "src/processor.rs"),
        TimelineEntry::new("14:20:03", "🔍", "analysis", "found 3 issues"),
        TimelineEntry::new("14:20:05", "✏️", "edit_file", "src/processor.rs"),
        TimelineEntry::new("14:20:07", "✓", "done", "refactor complete"),
    ];

    loop {
        frame += 1;
        terminal.draw(|f| {
            let area = f.area();
            f.render_widget(Paragraph::new("").style(Style::default().bg(s.surface)), area);

            let [top, timeline_area, mid, tool_area, input_area] = Layout::vertical([
                Constraint::Length(1), Constraint::Length(8), Constraint::Length(4),
                Constraint::Length(5), Constraint::Length(3),
            ]).areas(area);

            let chunks = Layout::horizontal([Constraint::Percentage(40), Constraint::Percentage(60)]).split(timeline_area);

            let bar = StatusBar::new().provider("Codex").model("o4-mini")
                .connection(ConnectionStatus::Connected).started_at(started)
                .style(s.clone());
            f.render_widget(&bar, top);

            let block = Block::default().borders(Borders::ALL).title(" Timeline ").border_style(Style::default().fg(s.text_dim));
            let inner = block.inner(chunks[0]);
            f.render_widget(&block, chunks[0]);
            f.render_widget(SessionTimeline::new().entries(&entries).style(s.clone()), inner);

            let diff_block = Block::default().borders(Borders::ALL).title(" Changes ").border_style(Style::default().fg(s.accent));
            let diff_inner = diff_block.inner(chunks[1]);
            f.render_widget(&diff_block, chunks[1]);
            f.render_widget(DiffView::new().diff(diff_text).file("src/processor.rs").style(s.clone()), diff_inner);

            let bubble = MessageBubble::new(
                match mode { 0 => "Suggest: add validation before transform", 1 => "Auto-edit: applying filter chain", _ => "Full-auto: running tests after edit" },
                Role::Assistant,
            ).style(s.clone());
            f.render_widget(&bubble, mid);

            let card = ToolCallCard::new().tool_name("shell_exec")
                .arguments("{\"cmd\": \"cargo test\"}")
                .status(ToolStatus::Running)
                .duration(std::time::Duration::from_secs(frame / 10))
                .style(s.clone());
            f.render_widget(&card, tool_area);

            let input_w = BasicInput::new(&input).placeholder("[suggest|auto-edit|full-auto] > ").style(s.clone());
            f.render_widget(&input_w, input_area);
        })?;

        if crossterm::event::poll(std::time::Duration::from_millis(80))? {
            if let crossterm::event::Event::Key(key) = crossterm::event::read()? {
                match key.code {
                    crossterm::event::KeyCode::Char('q') => break,
                    crossterm::event::KeyCode::Tab => mode = (mode + 1) % 3,
                    crossterm::event::KeyCode::Char(c) => input.push(c),
                    crossterm::event::KeyCode::Backspace => { input.pop(); }
                    _ => {}
                }
            }
        }
    }

    disable_raw_mode()?;
    execute!(terminal.backend_mut(), LeaveAlternateScreen)?;
    Ok(())
}
