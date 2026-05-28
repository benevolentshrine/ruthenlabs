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
        .accent(Color::Rgb(200, 160, 80))
        .text(Color::Rgb(230, 230, 220))
        .text_dim(Color::Rgb(120, 120, 130))
        .success(Color::Rgb(60, 200, 120))
        .surface(Color::Rgb(26, 24, 22))
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
    let mut approved = false;
    let mut phase = 0u8;

    let diff_text = "@@ -1,3 +1,5 @@\n fn main() {\n+    let config = load_config();\n+    validate(&config);\n     run();\n }";

    loop {
        frame += 1;
        terminal.draw(|f| {
            let area = f.area();
            f.render_widget(Paragraph::new("").style(Style::default().bg(s.surface)), area);

            let [top, thinking_area, mid, diff_area, approval_area, input_area] = Layout::vertical([
                Constraint::Length(1), Constraint::Length(6), Constraint::Length(4),
                Constraint::Length(6), Constraint::Length(4), Constraint::Length(3),
            ]).areas(area);

            let bar = StatusBar::new().provider("Claude").model("Sonnet 4")
                .connection(ConnectionStatus::Connected).started_at(started)
                .token_count(frame * 12).style(s.clone());
            f.render_widget(&bar, top);

            let tb = ThinkingBlock::new().label("Planning refactor")
                .state(if frame % 20 < 15 { ThinkingState::Thinking } else { ThinkingState::Completed })
                .expanded(true).frame_index(frame as usize)
                .elapsed(std::time::Duration::from_millis(frame * 50))
                .content("Analyzing main.rs for missing validation...\nFound 2 issues: unchecked config, no validation.\nPlan: add load_config() and validate() calls.")
                .style(s.clone());
            f.render_widget(&tb, thinking_area);

            let bubble = MessageBubble::new("I'll add config loading and validation to main.rs.", Role::Assistant).style(s.clone());
            f.render_widget(&bubble, mid);

            let block = Block::default().borders(Borders::ALL).title(" Diff ").border_style(Style::default().fg(s.text_dim));
            let inner = block.inner(diff_area);
            f.render_widget(&block, diff_area);
            f.render_widget(DiffView::new().diff(diff_text).file("src/main.rs").style(s.clone()), inner);

            let prompt = ApprovalPrompt::new().tool_name("edit_file")
                .args("src/main.rs")
                .reason("Add config loading and validation")
                .status(if approved { ApprovalStatus::Approved } else { ApprovalStatus::Pending })
                .style(s.clone());
            f.render_widget(&prompt, approval_area);

            let input_w = BasicInput::new(&input).placeholder("Describe what to build...").style(s.clone());
            f.render_widget(&input_w, input_area);
        })?;

        if crossterm::event::poll(std::time::Duration::from_millis(80))? {
            if let crossterm::event::Event::Key(key) = crossterm::event::read()? {
                match key.code {
                    crossterm::event::KeyCode::Char('q') => break,
                    crossterm::event::KeyCode::Enter => { approved = !approved; phase = (phase + 1) % 3; }
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
