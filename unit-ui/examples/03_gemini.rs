use std::io::stdout;
use std::time::Instant;

use crossterm::execute;
use crossterm::terminal::{
    disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen,
};
use ratatui::backend::CrosstermBackend;
use ratatui::layout::{Constraint, Layout};
use ratatui::style::{Color, Style};
use ratatui::widgets::{Block, Borders, Paragraph};
use ratatui::Terminal;

use unit_ui::prelude::*;
use unit_ui::style::StyleToken;

fn style() -> StyleToken {
    StyleToken::builder()
        .accent(Color::Rgb(66, 133, 244))
        .text(Color::Rgb(230, 230, 230))
        .text_dim(Color::Rgb(120, 130, 140))
        .success(Color::Rgb(52, 168, 83))
        .surface(Color::Rgb(20, 22, 28))
        .thinking(Color::Rgb(251, 188, 4))
        .error(Color::Rgb(234, 67, 53))
        .build()
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    enable_raw_mode()?;
    let mut terminal = Terminal::new(CrosstermBackend::new(stdout()))?;
    execute!(terminal.backend_mut(), EnterAlternateScreen)?;

    let s = style();
    let started = Instant::now();
    let mut frame = 0u64;
    let mut selected = 0u16;
    let mut input = String::new();

    let sessions = [
        (
            "Search results for 'auth middleware'",
            "Found 12 relevant files across 3 repositories",
        ),
        ("1M token context loaded", "Entire codebase indexed in 4.2s"),
        (
            "Google Search grounding",
            "Latest docs for ratatui 0.29 fetched",
        ),
    ];

    let entries = [
        TimelineEntry::new("09:15:01", "🔍", "search", "ratatui best practices"),
        TimelineEntry::new("09:15:03", "📚", "context", "1M tokens loaded"),
        TimelineEntry::new("09:15:05", "🌐", "grounding", "fetched docs.ratatui.rs"),
        TimelineEntry::new("09:15:08", "✏️", "edit", "src/widgets/mod.rs"),
    ];

    loop {
        frame += 1;
        terminal.draw(|f| {
            let area = f.area();
            f.render_widget(Paragraph::new("").style(Style::default().bg(s.surface)), area);

            let [top, left, right, input_area] = Layout::vertical([
                Constraint::Length(1), Constraint::Min(5), Constraint::Length(8), Constraint::Length(3),
            ]).areas(area);

            let chunks = Layout::horizontal([Constraint::Percentage(50), Constraint::Percentage(50)]).split(left);

            let bar = StatusBar::new().provider("Gemini").model("2.5 Pro")
                .connection(ConnectionStatus::Connected).started_at(started)
                .model(&format!("{}k ctx", 1000))
                .style(s.clone());
            f.render_widget(&bar, top);

            let mut stream = StreamingText::new("Gemini CLI — 1,000 free requests/day\nLargest context window: 1M tokens\nGoogle Search grounding for live docs\nPlan Mode for step-by-step reasoning")
                .typing_speed(2).style(s.clone());
            f.render_widget(&mut stream, chunks[0]);

            let block = Block::default().borders(Borders::ALL).title(" Session Timeline ").border_style(Style::default().fg(s.text_dim));
            let inner = block.inner(chunks[1]);
            f.render_widget(&block, chunks[1]);
            f.render_widget(SessionTimeline::new().entries(&entries).scroll_offset(selected).style(s.clone()), inner);

            let md = MarkdownBlock::new().content("# Search Results\n\n**12 files** found across 3 repos\n\n- `src/auth.rs` — middleware\n- `src/middleware.rs` — handlers\n- `tests/auth_test.rs` — tests\n\n> Grounded from docs.ratatui.rs")
                .style(s.clone());
            f.render_widget(&md, right);

            let tb = ThinkingDots::new().frame_index(frame as usize).style(s.clone());
            let dot_area = ratatui::layout::Rect { x: input_area.x, y: input_area.y, width: 3, height: 1 };
            f.render_widget(&tb, dot_area);

            let input_w = BasicInput::new(&input).placeholder("Ask Gemini...").style(s.clone());
            f.render_widget(&input_w, input_area);
        })?;

        if crossterm::event::poll(std::time::Duration::from_millis(80))? {
            if let crossterm::event::Event::Key(key) = crossterm::event::read()? {
                match key.code {
                    crossterm::event::KeyCode::Char('q') => break,
                    crossterm::event::KeyCode::Up => {
                        selected = selected.saturating_sub(1);
                    }
                    crossterm::event::KeyCode::Down => {
                        selected = (selected + 1).min(sessions.len() as u16 - 1);
                    }
                    crossterm::event::KeyCode::Char(c) => input.push(c),
                    crossterm::event::KeyCode::Backspace => {
                        input.pop();
                    }
                    _ => {}
                }
            }
        }
    }

    disable_raw_mode()?;
    execute!(terminal.backend_mut(), LeaveAlternateScreen)?;
    Ok(())
}
