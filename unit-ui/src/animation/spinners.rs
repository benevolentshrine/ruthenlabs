/// 10-frame braille dot spinner.
pub fn braille() -> Vec<&'static str> {
    vec!["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
}

/// 8-frame block dot spinner.
pub fn dots() -> Vec<&'static str> {
    vec!["⣾", "⣽", "⣻", "⢿", "⡿", "⣟", "⣯", "⣷"]
}

/// 4-frame rotating line spinner.
pub fn line() -> Vec<&'static str> {
    vec!["-", "\\", "|", "/"]
}

/// 6-frame arc spinner.
pub fn arc() -> Vec<&'static str> {
    vec!["◜", "◠", "◝", "◞", "◡", "◟"]
}

/// 12-frame clock face spinner (uses emoji).
pub fn clock() -> Vec<&'static str> {
    vec![
        "🕐", "🕑", "🕒", "🕓", "🕔", "🕕", "🕖", "🕗", "🕘", "🕙", "🕚", "🕛",
    ]
}

/// 8-frame braille bounce spinner.
pub fn bounce() -> Vec<&'static str> {
    vec!["⠁", "⠂", "⠄", "⡀", "⢀", "⠠", "⠐", "⠈"]
}

/// 8-frame expanding block pulse.
pub fn pulse() -> Vec<&'static str> {
    vec!["█", "▇", "▆", "▅", "▄", "▃", "▂", "▁"]
}
