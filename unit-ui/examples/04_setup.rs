use std::io::stdout;
use std::time::{Duration, Instant};

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
        .accent(Color::Rgb(120, 90, 220))
        .text(Color::Rgb(230, 225, 240))
        .text_dim(Color::Rgb(130, 125, 150))
        .success(Color::Rgb(60, 200, 120))
        .surface(Color::Rgb(22, 20, 30))
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
    let mut step = 0u16;
    let mut input_text = String::new();
    let steps = ["Welcome", "Configure", "Verify", "Install", "Done"];

    loop {
        frame += 1;
        terminal.draw(|f| {
            let area = f.area();
            f.render_widget(Paragraph::new("").style(Style::default().bg(s.surface)), area);

            let [top, progress, body, bot] = Layout::vertical([
                Constraint::Length(1), Constraint::Length(1), Constraint::Min(2), Constraint::Length(3),
            ]).areas(area);

            let bar = StatusBar::new().provider("Setup Wizard")
                .model(&format!("Step {}/{}", step + 1, steps.len()))
                .connection(ConnectionStatus::Connected).started_at(started)
                .style(s.clone());
            f.render_widget(&bar, top);

            let prog_text = steps.iter().enumerate().map(|(i, name)| {
                if i < step as usize { format!(" ✓ {}", name) }
                else if i == step as usize { format!(" ▶ {}", name) }
                else { format!("   {}", name) }
            }).collect::<Vec<_>>().join("  ");
            f.render_widget(Paragraph::new(prog_text).style(Style::default().fg(s.accent)), progress);

            if step < 2 {
                let tb = ThinkingBlock::new().label(&format!("Preparing {}...", steps[step as usize]))
                    .state(ThinkingState::Thinking).expanded(true)
                    .frame_index(frame as usize).elapsed(Duration::from_millis(frame * 50))
                    .content("Analyzing system configuration...\nChecking dependencies...\nValidating environment...")
                    .style(s.clone());
                f.render_widget(&tb, body);
            } else if step == 2 {
                let prompt = ApprovalPrompt::new().tool_name("install_package")
                    .args("unit-ui 0.1.0\nratatui 0.29\ncrossterm 0.28")
                    .reason("Install required dependencies for your project")
                    .status(if frame % 10 < 7 { ApprovalStatus::Pending } else { ApprovalStatus::Approved })
                    .style(s.clone());
                f.render_widget(&prompt, body);
            } else if step == 3 {
                let block = Block::default().borders(Borders::ALL)
                    .border_style(Style::default().fg(s.success));
                let inner = block.inner(body);
                f.render_widget(&block, body);
                f.render_widget(
                    Paragraph::new("✓ Configuration saved\n✓ Dependencies installed\n✓ Project initialized")
                        .style(Style::default().fg(s.success)),
                    inner,
                );
            } else {
                let block = Block::default().borders(Borders::ALL)
                    .border_style(Style::default().fg(s.accent));
                let inner = block.inner(body);
                f.render_widget(&block, body);
                f.render_widget(Paragraph::new("Setup complete! Press Enter to restart or q to quit.")
                    .style(Style::default().fg(s.text)), inner);
            }

            f.render_widget(BasicInput::new(&input_text).placeholder("Enter value or press Enter to continue...").style(s.clone()), bot);
        })?;

        if crossterm::event::poll(std::time::Duration::from_millis(80))? {
            if let crossterm::event::Event::Key(key) = crossterm::event::read()? {
                match key.code {
                    crossterm::event::KeyCode::Char('q') => break,
                    crossterm::event::KeyCode::Enter => {
                        step = (step + 1) % steps.len() as u16;
                    }
                    crossterm::event::KeyCode::Char(c) => input_text.push(c),
                    crossterm::event::KeyCode::Backspace => {
                        input_text.pop();
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
