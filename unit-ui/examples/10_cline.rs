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
        .accent(Color::Rgb(50, 150, 255))
        .text(Color::Rgb(220, 230, 240))
        .text_dim(Color::Rgb(110, 120, 140))
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
    let mut approved = false;
    let mut input = String::new();
    let mut code = String::from("import React from 'react';\n\nexport function Button({ onClick, children }) {\n  return <button onClick={onClick}>{children}</button>;\n}");

    let diff_text = "@@ -1,5 +1,7 @@\n import React from 'react';\n+import { useState } from 'react';\n \n-export function Button({ onClick, children }) {\n-  return <button onClick={onClick}>{children}</button>;\n+export function Button({ onClick, children, variant = 'primary' }) {\n+  const [loading, setLoading] = useState(false);\n+  return <button className={variant} onClick={onClick}>{children}</button>;\n }";

    let entries = [
        TimelineEntry::new("08:30:01", "🌐", "browser", "opened localhost:3000"),
        TimelineEntry::new("08:30:03", "📸", "screenshot", "captured UI state"),
        TimelineEntry::new("08:30:05", "🔍", "lsp", "TypeScript errors: 0"),
    ];

    loop {
        frame += 1;
        terminal.draw(|f| {
            let area = f.area();
            f.render_widget(
                Paragraph::new("").style(Style::default().bg(s.surface)),
                area,
            );

            let [top, left, right, approval_area, input_area] = Layout::vertical([
                Constraint::Length(1),
                Constraint::Min(5),
                Constraint::Length(8),
                Constraint::Length(5),
                Constraint::Length(3),
            ])
            .areas(area);

            let chunks =
                Layout::horizontal([Constraint::Percentage(55), Constraint::Percentage(45)])
                    .split(left);

            let bar = StatusBar::new()
                .provider("Cline")
                .model("claude-sonnet")
                .connection(ConnectionStatus::Connected)
                .started_at(started)
                .model("browser + LSP")
                .style(s.clone());
            f.render_widget(&bar, top);

            let editor_block = Block::default()
                .borders(Borders::ALL)
                .title(" Button.tsx ")
                .border_style(Style::default().fg(s.accent));
            let editor_inner = editor_block.inner(chunks[0]);
            f.render_widget(&editor_block, chunks[0]);
            let mut ml = MultiLineInput::new()
                .text(&code)
                .show_line_numbers(true)
                .style(s.clone());
            f.render_widget(&mut ml, editor_inner);

            let diff_block = Block::default()
                .borders(Borders::ALL)
                .title(" Proposed Changes ")
                .border_style(Style::default().fg(s.success));
            let diff_inner = diff_block.inner(chunks[1]);
            f.render_widget(&diff_block, chunks[1]);
            f.render_widget(
                DiffView::new()
                    .diff(diff_text)
                    .file("src/Button.tsx")
                    .style(s.clone()),
                diff_inner,
            );

            let mut stream =
                StreamingText::new("Adding variant prop and loading state to Button component...")
                    .typing_speed(2)
                    .style(s.clone());
            f.render_widget(&mut stream, approval_area);

            let prompt = ApprovalPrompt::new()
                .tool_name("edit_file")
                .args("src/Button.tsx")
                .reason("Add variant prop and loading state")
                .status(if approved {
                    ApprovalStatus::Approved
                } else {
                    ApprovalStatus::Pending
                })
                .style(s.clone());
            let prompt_area = ratatui::layout::Rect {
                x: input_area.x,
                y: input_area.y.saturating_sub(5),
                width: input_area.width,
                height: 5,
            };
            f.render_widget(&prompt, prompt_area);

            let input_w = BasicInput::new(&input)
                .placeholder("Describe UI changes...")
                .style(s.clone());
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
