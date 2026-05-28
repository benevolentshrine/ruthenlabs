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
        .accent(Color::Rgb(200, 80, 180))
        .text(Color::Rgb(230, 220, 230))
        .text_dim(Color::Rgb(120, 110, 120))
        .success(Color::Rgb(60, 200, 120))
        .surface(Color::Rgb(24, 20, 24))
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
    let mut input = String::new();

    loop {
        frame += 1;
        terminal.draw(|f| {
            let area = f.area();
            f.render_widget(Paragraph::new("").style(Style::default().bg(s.surface)), area);

            let [top, blocks_area, stream_area, input_area] = Layout::vertical([
                Constraint::Length(1), Constraint::Min(5), Constraint::Length(6), Constraint::Length(3),
            ]).areas(area);

            let chunks = Layout::horizontal([Constraint::Percentage(50), Constraint::Percentage(50)]).split(blocks_area);

            let bar = StatusBar::new().provider("Warp").model("agent-mode")
                .connection(ConnectionStatus::Connected).started_at(started)
                .style(s.clone());
            f.render_widget(&bar, top);

            let bubble = MessageBubble::new("Block 1: $ cargo build\nCompiling unit-ui v0.1.0\nFinished dev [unoptimized] target(s)", Role::System).style(s.clone());
            f.render_widget(&bubble, chunks[0]);

            let tb = ThinkingDots::new().frame_index(frame as usize).style(s.clone());
            let dots_area = ratatui::layout::Rect { x: chunks[1].x, y: chunks[1].y, width: 3, height: 1 };
            f.render_widget(&tb, dots_area);

            let block = Block::default().borders(Borders::ALL).title(" Warp Agent ").border_style(Style::default().fg(s.accent));
            let inner = block.inner(chunks[1]);
            f.render_widget(&block, chunks[1]);
            let md = MarkdownBlock::new().content("## Agent Mode Active\n\nAnalyzing terminal output...\n\n**Suggestion:** Run `cargo test` to verify\n**Status:** Ready to execute")
                .style(s.clone());
            f.render_widget(&md, inner);

            let tb2 = ThinkingBlock::new().label("Planning")
                .state(ThinkingState::Thinking).expanded(true)
                .frame_index(frame as usize)
                .elapsed(std::time::Duration::from_millis(frame * 35))
                .content("Detected successful build.\nRecommending: run test suite.\nAlternative: deploy to staging.")
                .style(s.clone());
            f.render_widget(&tb2, stream_area);

            let input_w = BasicInput::new(&input).placeholder("Ask Warp AI...").style(s.clone());
            f.render_widget(&input_w, input_area);
        })?;

        if crossterm::event::poll(std::time::Duration::from_millis(80))? {
            if let crossterm::event::Event::Key(key) = crossterm::event::read()? {
                match key.code {
                    crossterm::event::KeyCode::Char('q') => break,
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
