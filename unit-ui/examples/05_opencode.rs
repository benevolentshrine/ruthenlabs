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
        .accent(Color::Rgb(0, 200, 200))
        .text(Color::Rgb(220, 230, 230))
        .text_dim(Color::Rgb(110, 120, 130))
        .success(Color::Rgb(60, 200, 120))
        .surface(Color::Rgb(18, 22, 28))
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
    let mut input = String::new();
    let mut code = String::from("fn main() {\n    let x = 42;\n    println!(\"{}\", x);\n}");

    let entries = [
        TimelineEntry::new("11:00:01", "🔗", "lsp", "connected to rust-analyzer"),
        TimelineEntry::new("11:00:03", "📂", "file_open", "src/main.rs"),
        TimelineEntry::new("11:00:05", "🔍", "diagnostics", "0 errors, 1 warning"),
    ];

    loop {
        frame += 1;
        terminal.draw(|f| {
            let area = f.area();
            f.render_widget(Paragraph::new("").style(Style::default().bg(s.surface)), area);

            let [top, left, right_top, right_bot, input_area] = Layout::vertical([
                Constraint::Length(1), Constraint::Min(5), Constraint::Length(6), Constraint::Length(6), Constraint::Length(3),
            ]).areas(area);

            let chunks = Layout::horizontal([Constraint::Percentage(55), Constraint::Percentage(45)]).split(left);

            let bar = StatusBar::new().provider("OpenCode").model("claude-opus")
                .connection(ConnectionStatus::Connected).started_at(started)
                .model("75+ providers").style(s.clone());
            f.render_widget(&bar, top);

            let editor_block = Block::default().borders(Borders::ALL).title(" src/main.rs ").border_style(Style::default().fg(s.accent));
            let editor_inner = editor_block.inner(chunks[0]);
            f.render_widget(&editor_block, chunks[0]);
            let mut ml = MultiLineInput::new().text(&code).show_line_numbers(true).style(s.clone());
            f.render_widget(&mut ml, editor_inner);

            let block = Block::default().borders(Borders::ALL).title(" Timeline ").border_style(Style::default().fg(s.text_dim));
            let inner = block.inner(chunks[1]);
            f.render_widget(&block, chunks[1]);
            f.render_widget(SessionTimeline::new().entries(&entries).style(s.clone()), inner);

            let tb = ThinkingBlock::new().label("Analyzing")
                .state(ThinkingState::Thinking).expanded(true)
                .frame_index(frame as usize)
                .elapsed(std::time::Duration::from_millis(frame * 30))
                .content("LSP analysis: 1 warning on line 2\nConsider using a named constant instead of magic number 42")
                .style(s.clone());
            f.render_widget(&tb, right_top);

            let card = ToolCallCard::new().tool_name("lsp_diagnostics")
                .arguments("{\"file\": \"src/main.rs\"}")
                .status(ToolStatus::Success).duration(std::time::Duration::from_secs(1))
                .result("0 errors, 1 warning")
                .style(s.clone());
            f.render_widget(&card, right_bot);

            let mut stream = StreamingText::new("OpenCode supports 75+ LLM providers\nLSP integration for type-safe refactors\nParallel agents for multi-file edits\nSession persistence across disconnects")
                .typing_speed(2).style(s.clone());
            f.render_widget(&mut stream, input_area);
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
