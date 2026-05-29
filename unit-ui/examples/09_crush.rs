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
        .accent(Color::Rgb(255, 160, 200))
        .text(Color::Rgb(230, 220, 230))
        .text_dim(Color::Rgb(130, 120, 130))
        .success(Color::Rgb(60, 200, 120))
        .surface(Color::Rgb(26, 22, 28))
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

    let spinner_frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

    loop {
        frame += 1;
        terminal.draw(|f| {
            let area = f.area();
            f.render_widget(Paragraph::new("").style(Style::default().bg(s.surface)), area);

            let [top, left, right, input_area] = Layout::vertical([
                Constraint::Length(1), Constraint::Min(5), Constraint::Length(12), Constraint::Length(3),
            ]).areas(area);

            let chunks = Layout::horizontal([Constraint::Percentage(40), Constraint::Percentage(60)]).split(left);

            let bar = StatusBar::new().provider("Crush").model("charmbracelet")
                .connection(ConnectionStatus::Connected).started_at(started)
                .style(s.clone());
            f.render_widget(&bar, top);

            let bubble = MessageBubble::new("Crush — beautiful terminal AI\nBuilt with Charm's bubbletea ecosystem\nMinimal, elegant, purposeful.", Role::Assistant).style(s.clone());
            f.render_widget(&bubble, chunks[0]);

            let spin = Spinner::new().frame_index((frame as usize) % spinner_frames.len()).label("thinking").style(s.clone());
            let spin_area = ratatui::layout::Rect { x: chunks[1].x, y: chunks[1].y, width: chunks[1].width, height: 3 };
            f.render_widget(&spin, spin_area);

            let tb = ThinkingDots::new().frame_index(frame as usize).style(s.clone());
            let dots_area = ratatui::layout::Rect { x: chunks[1].x, y: chunks[1].y + 3, width: 5, height: 1 };
            f.render_widget(&tb, dots_area);

            let md = MarkdownBlock::new().content("## Crush Design Principles\n\n1. **Minimal** — only what's needed\n2. **Beautiful** — Charm aesthetic\n3. **Fast** — Go-powered rendering\n4. **Composable** — bubbletea components\n\n> Less is more.")
                .style(s.clone());
            let md_area = ratatui::layout::Rect { x: chunks[1].x, y: chunks[1].y + 4, width: chunks[1].width, height: 8 };
            f.render_widget(&md, md_area);

            let tb2 = ThinkingBlock::new().label("Designing")
                .state(ThinkingState::Thinking).expanded(true)
                .frame_index(frame as usize)
                .elapsed(std::time::Duration::from_millis(frame * 30))
                .content("Applying Charm design system:\n- Lipgloss for styling\n- Bubbles for components\n- Whisper for AI integration")
                .style(s.clone());
            f.render_widget(&tb2, right);

            let input_w = BasicInput::new(&input).placeholder("Ask Crush...").style(s.clone());
            f.render_widget(&input_w, input_area);
        })?;

        if crossterm::event::poll(std::time::Duration::from_millis(80))? {
            if let crossterm::event::Event::Key(key) = crossterm::event::read()? {
                match key.code {
                    crossterm::event::KeyCode::Char('q') => break,
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
