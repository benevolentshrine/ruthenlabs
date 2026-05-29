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
        .accent(Color::Rgb(160, 120, 255))
        .text(Color::Rgb(230, 220, 240))
        .text_dim(Color::Rgb(120, 110, 130))
        .success(Color::Rgb(60, 200, 120))
        .surface(Color::Rgb(22, 20, 28))
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
    let mut input = String::new();

    let commands = ["/mcp", "/recipe", "/subagent", "/configure", "/help"];

    let entries = [
        TimelineEntry::new("16:45:01", "🔌", "mcp", "github extension loaded"),
        TimelineEntry::new("16:45:03", "🤖", "subagent", "code-review spawned"),
        TimelineEntry::new("16:45:06", "📋", "recipe", "deploy-pipeline.yaml"),
    ];

    loop {
        frame += 1;
        terminal.draw(|f| {
            let area = f.area();
            f.render_widget(Paragraph::new("").style(Style::default().bg(s.surface)), area);

            let [top, left, right, input_area] = Layout::vertical([
                Constraint::Length(1), Constraint::Min(5), Constraint::Length(8), Constraint::Length(3),
            ]).areas(area);

            let chunks = Layout::horizontal([Constraint::Percentage(45), Constraint::Percentage(55)]).split(left);

            let bar = StatusBar::new().provider("Goose").model("claude-sonnet")
                .connection(ConnectionStatus::Connected).started_at(started)
                .model("70+ extensions").style(s.clone());
            f.render_widget(&bar, top);

            let bubble = MessageBubble::new("Goose — general-purpose AI agent\nMCP extensions for tools, APIs, databases\nSubagents for parallel task execution", Role::Assistant).style(s.clone());
            f.render_widget(&bubble, chunks[0]);

            let tb = ThinkingBlock::new().label("Orchestrating")
                .state(ThinkingState::Thinking).expanded(true)
                .frame_index(frame as usize)
                .elapsed(std::time::Duration::from_millis(frame * 45))
                .content("Running recipe: deploy-pipeline.yaml\nSubagent 1: code review (in progress)\nSubagent 2: test runner (queued)\nMCP: github extension connected")
                .style(s.clone());
            f.render_widget(&tb, chunks[1]);

            let card = ToolCallCard::new().tool_name("mcp_github")
                .arguments("{\"action\": \"create_pr\", \"repo\": \"project/app\"}")
                .status(if frame % 20 < 10 { ToolStatus::Running } else { ToolStatus::Success })
                .duration(std::time::Duration::from_secs(frame / 8))
                .result("PR #42 created: Add error handling")
                .style(s.clone());
            f.render_widget(&card, right);

            let prompt = ApprovalPrompt::new().tool_name("shell_exec")
                .args("cargo deploy --env staging")
                .reason("Deploy recipe requires shell access")
                .status(if approved { ApprovalStatus::Approved } else { ApprovalStatus::Pending })
                .style(s.clone());
            let prompt_area = ratatui::layout::Rect { x: input_area.x, y: input_area.y.saturating_sub(5), width: input_area.width, height: 5 };
            f.render_widget(&prompt, prompt_area);

            let input_w = BasicInput::new(&input).placeholder("/ for commands, or ask Goose...").style(s.clone());
            f.render_widget(&input_w, input_area);
        })?;

        if crossterm::event::poll(std::time::Duration::from_millis(80))? {
            if let crossterm::event::Event::Key(key) = crossterm::event::read()? {
                match key.code {
                    crossterm::event::KeyCode::Char('q') => break,
                    crossterm::event::KeyCode::Enter => approved = !approved,
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
