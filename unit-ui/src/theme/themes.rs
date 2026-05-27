use ratatui::style::Color;

use crate::style::StyleToken;

/// A named theme with an associated [`StyleToken`] palette.
///
/// # Example
///
/// ```rust
/// use unit_ui::theme::themes;
/// let t = themes::from_name("Dracula").unwrap();
/// assert_eq!(t.name, "Dracula");
/// ```
#[derive(Debug, Clone)]
pub struct Theme {
    /// The human-readable theme name (e.g. `"Dracula"`, `"Nord"`).
    pub name: &'static str,
    /// The full colour palette for this theme.
    pub palette: StyleToken,
}

/// Returns every built-in theme as a `Vec`.
pub fn all() -> Vec<Theme> {
    vec![
        dracula(),
        nord(),
        catppuccin_mocha(),
        catppuccin_latte(),
        solarized_dark(),
        solarized_light(),
        gruvbox_dark(),
        gruvbox_light(),
        monokai(),
        tokyo_night(),
        tokyo_night_day(),
        ayu_dark(),
        ayu_light(),
        one_dark(),
        one_light(),
        everforest_dark(),
        everforest_light(),
        kanagawa(),
        kanagawa_lotus(),
        rose_pine(),
        rose_pine_dawn(),
        material_darker(),
        material_ocean(),
        material_palenight(),
        github_dark(),
        github_light(),
        synthwave84(),
        cyberpunk(),
        moonlight(),
        night_owl(),
        aurora(),
        hack_the_box(),
        doom_emacs(),
        onedark_pro(),
        japanish(),
        forest(),
        marine(),
        candy(),
        blood(),
        ocean(),
    ]
}

/// Looks up a built-in theme by name (case-insensitive).
///
/// Returns `None` if no theme matches.
pub fn from_name(name: &str) -> Option<Theme> {
    all().into_iter().find(|t| t.name.eq_ignore_ascii_case(name))
}

pub fn dracula() -> Theme {
    Theme {
        name: "Dracula",
        palette: StyleToken::builder()
            .text(Color::Rgb(248, 248, 242))
            .text_dim(Color::Rgb(98, 114, 164))
            .accent(Color::Rgb(189, 147, 249))
            .surface(Color::Rgb(40, 42, 54))
            .error(Color::Rgb(255, 85, 85))
            .success(Color::Rgb(80, 250, 123))
            .thinking(Color::Rgb(241, 250, 140))
            .provider(Color::Rgb(139, 133, 255))
            .build(),
    }
}

pub fn nord() -> Theme {
    Theme {
        name: "Nord",
        palette: StyleToken::builder()
            .text(Color::Rgb(236, 239, 244))
            .text_dim(Color::Rgb(143, 188, 187))
            .accent(Color::Rgb(136, 192, 208))
            .surface(Color::Rgb(46, 52, 64))
            .error(Color::Rgb(191, 97, 106))
            .success(Color::Rgb(163, 190, 140))
            .thinking(Color::Rgb(235, 203, 139))
            .provider(Color::Rgb(129, 161, 193))
            .build(),
    }
}

pub fn catppuccin_mocha() -> Theme {
    Theme {
        name: "Catppuccin Mocha",
        palette: StyleToken::builder()
            .text(Color::Rgb(205, 214, 244))
            .text_dim(Color::Rgb(147, 153, 178))
            .accent(Color::Rgb(203, 166, 247))
            .surface(Color::Rgb(30, 30, 46))
            .error(Color::Rgb(243, 139, 168))
            .success(Color::Rgb(166, 227, 161))
            .thinking(Color::Rgb(249, 226, 175))
            .provider(Color::Rgb(137, 180, 250))
            .build(),
    }
}

pub fn catppuccin_latte() -> Theme {
    Theme {
        name: "Catppuccin Latte",
        palette: StyleToken::builder()
            .text(Color::Rgb(76, 79, 105))
            .text_dim(Color::Rgb(156, 160, 176))
            .accent(Color::Rgb(136, 57, 239))
            .surface(Color::Rgb(239, 241, 245))
            .error(Color::Rgb(210, 15, 57))
            .success(Color::Rgb(64, 160, 43))
            .thinking(Color::Rgb(223, 142, 29))
            .provider(Color::Rgb(30, 102, 245))
            .build(),
    }
}

pub fn solarized_dark() -> Theme {
    Theme {
        name: "Solarized Dark",
        palette: StyleToken::builder()
            .text(Color::Rgb(131, 148, 150))
            .text_dim(Color::Rgb(88, 110, 117))
            .accent(Color::Rgb(38, 139, 210))
            .surface(Color::Rgb(0, 43, 54))
            .error(Color::Rgb(220, 50, 47))
            .success(Color::Rgb(133, 153, 0))
            .thinking(Color::Rgb(181, 137, 0))
            .provider(Color::Rgb(211, 54, 130))
            .build(),
    }
}

pub fn solarized_light() -> Theme {
    Theme {
        name: "Solarized Light",
        palette: StyleToken::builder()
            .text(Color::Rgb(88, 110, 117))
            .text_dim(Color::Rgb(131, 148, 150))
            .accent(Color::Rgb(38, 139, 210))
            .surface(Color::Rgb(253, 246, 227))
            .error(Color::Rgb(220, 50, 47))
            .success(Color::Rgb(133, 153, 0))
            .thinking(Color::Rgb(181, 137, 0))
            .provider(Color::Rgb(211, 54, 130))
            .build(),
    }
}

pub fn gruvbox_dark() -> Theme {
    Theme {
        name: "Gruvbox Dark",
        palette: StyleToken::builder()
            .text(Color::Rgb(235, 219, 178))
            .text_dim(Color::Rgb(146, 131, 116))
            .accent(Color::Rgb(254, 128, 25))
            .surface(Color::Rgb(40, 40, 40))
            .error(Color::Rgb(251, 73, 52))
            .success(Color::Rgb(184, 187, 38))
            .thinking(Color::Rgb(250, 189, 47))
            .provider(Color::Rgb(131, 165, 152))
            .build(),
    }
}

pub fn gruvbox_light() -> Theme {
    Theme {
        name: "Gruvbox Light",
        palette: StyleToken::builder()
            .text(Color::Rgb(60, 56, 54))
            .text_dim(Color::Rgb(146, 131, 116))
            .accent(Color::Rgb(254, 128, 25))
            .surface(Color::Rgb(251, 241, 199))
            .error(Color::Rgb(204, 36, 29))
            .success(Color::Rgb(152, 151, 26))
            .thinking(Color::Rgb(215, 153, 33))
            .provider(Color::Rgb(104, 157, 106))
            .build(),
    }
}

pub fn monokai() -> Theme {
    Theme {
        name: "Monokai",
        palette: StyleToken::builder()
            .text(Color::Rgb(248, 248, 242))
            .text_dim(Color::Rgb(117, 113, 94))
            .accent(Color::Rgb(166, 226, 46))
            .surface(Color::Rgb(39, 40, 34))
            .error(Color::Rgb(249, 38, 114))
            .success(Color::Rgb(166, 226, 46))
            .thinking(Color::Rgb(253, 151, 31))
            .provider(Color::Rgb(102, 217, 239))
            .build(),
    }
}

pub fn tokyo_night() -> Theme {
    Theme {
        name: "Tokyo Night",
        palette: StyleToken::builder()
            .text(Color::Rgb(192, 202, 245))
            .text_dim(Color::Rgb(120, 130, 175))
            .accent(Color::Rgb(122, 162, 247))
            .surface(Color::Rgb(26, 27, 38))
            .error(Color::Rgb(247, 118, 142))
            .success(Color::Rgb(158, 206, 106))
            .thinking(Color::Rgb(224, 175, 104))
            .provider(Color::Rgb(137, 180, 250))
            .build(),
    }
}

pub fn tokyo_night_day() -> Theme {
    Theme {
        name: "Tokyo Night Day",
        palette: StyleToken::builder()
            .text(Color::Rgb(54, 59, 79))
            .text_dim(Color::Rgb(140, 143, 161))
            .accent(Color::Rgb(52, 99, 217))
            .surface(Color::Rgb(233, 235, 244))
            .error(Color::Rgb(210, 50, 70))
            .success(Color::Rgb(80, 140, 30))
            .thinking(Color::Rgb(190, 130, 40))
            .provider(Color::Rgb(79, 107, 237))
            .build(),
    }
}

pub fn ayu_dark() -> Theme {
    Theme {
        name: "Ayu Dark",
        palette: StyleToken::builder()
            .text(Color::Rgb(203, 204, 198))
            .text_dim(Color::Rgb(115, 118, 121))
            .accent(Color::Rgb(255, 178, 55))
            .surface(Color::Rgb(15, 17, 18))
            .error(Color::Rgb(255, 92, 92))
            .success(Color::Rgb(139, 188, 86))
            .thinking(Color::Rgb(255, 178, 55))
            .provider(Color::Rgb(115, 193, 220))
            .build(),
    }
}

pub fn ayu_light() -> Theme {
    Theme {
        name: "Ayu Light",
        palette: StyleToken::builder()
            .text(Color::Rgb(92, 95, 98))
            .text_dim(Color::Rgb(166, 168, 166))
            .accent(Color::Rgb(255, 149, 39))
            .surface(Color::Rgb(250, 250, 250))
            .error(Color::Rgb(230, 60, 60))
            .success(Color::Rgb(120, 180, 60))
            .thinking(Color::Rgb(255, 149, 39))
            .provider(Color::Rgb(60, 140, 190))
            .build(),
    }
}

pub fn one_dark() -> Theme {
    Theme {
        name: "One Dark",
        palette: StyleToken::builder()
            .text(Color::Rgb(171, 178, 191))
            .text_dim(Color::Rgb(92, 99, 112))
            .accent(Color::Rgb(97, 175, 239))
            .surface(Color::Rgb(40, 44, 52))
            .error(Color::Rgb(224, 108, 117))
            .success(Color::Rgb(152, 195, 121))
            .thinking(Color::Rgb(229, 192, 123))
            .provider(Color::Rgb(198, 120, 221))
            .build(),
    }
}

pub fn one_light() -> Theme {
    Theme {
        name: "One Light",
        palette: StyleToken::builder()
            .text(Color::Rgb(64, 71, 86))
            .text_dim(Color::Rgb(160, 164, 173))
            .accent(Color::Rgb(52, 119, 205))
            .surface(Color::Rgb(250, 250, 250))
            .error(Color::Rgb(200, 60, 70))
            .success(Color::Rgb(120, 160, 70))
            .thinking(Color::Rgb(190, 140, 60))
            .provider(Color::Rgb(170, 80, 190))
            .build(),
    }
}

pub fn everforest_dark() -> Theme {
    Theme {
        name: "Everforest Dark",
        palette: StyleToken::builder()
            .text(Color::Rgb(211, 198, 170))
            .text_dim(Color::Rgb(128, 125, 113))
            .accent(Color::Rgb(179, 190, 133))
            .surface(Color::Rgb(47, 53, 45))
            .error(Color::Rgb(218, 114, 101))
            .success(Color::Rgb(179, 190, 133))
            .thinking(Color::Rgb(214, 174, 118))
            .provider(Color::Rgb(131, 177, 159))
            .build(),
    }
}

pub fn everforest_light() -> Theme {
    Theme {
        name: "Everforest Light",
        palette: StyleToken::builder()
            .text(Color::Rgb(92, 93, 82))
            .text_dim(Color::Rgb(155, 150, 132))
            .accent(Color::Rgb(141, 155, 88))
            .surface(Color::Rgb(253, 246, 227))
            .error(Color::Rgb(190, 80, 70))
            .success(Color::Rgb(141, 155, 88))
            .thinking(Color::Rgb(190, 140, 70))
            .provider(Color::Rgb(100, 140, 120))
            .build(),
    }
}

pub fn kanagawa() -> Theme {
    Theme {
        name: "Kanagawa",
        palette: StyleToken::builder()
            .text(Color::Rgb(220, 215, 186))
            .text_dim(Color::Rgb(120, 125, 115))
            .accent(Color::Rgb(231, 173, 154))
            .surface(Color::Rgb(31, 33, 38))
            .error(Color::Rgb(201, 94, 92))
            .success(Color::Rgb(127, 179, 127))
            .thinking(Color::Rgb(217, 188, 109))
            .provider(Color::Rgb(151, 180, 191))
            .build(),
    }
}

pub fn kanagawa_lotus() -> Theme {
    Theme {
        name: "Kanagawa Lotus",
        palette: StyleToken::builder()
            .text(Color::Rgb(80, 70, 70))
            .text_dim(Color::Rgb(150, 140, 135))
            .accent(Color::Rgb(190, 100, 80))
            .surface(Color::Rgb(245, 235, 220))
            .error(Color::Rgb(170, 60, 60))
            .success(Color::Rgb(90, 140, 80))
            .thinking(Color::Rgb(170, 130, 60))
            .provider(Color::Rgb(100, 130, 150))
            .build(),
    }
}

pub fn rose_pine() -> Theme {
    Theme {
        name: "Rose Pine",
        palette: StyleToken::builder()
            .text(Color::Rgb(224, 222, 244))
            .text_dim(Color::Rgb(144, 140, 170))
            .accent(Color::Rgb(235, 188, 186))
            .surface(Color::Rgb(35, 33, 54))
            .error(Color::Rgb(235, 111, 146))
            .success(Color::Rgb(62, 207, 142))
            .thinking(Color::Rgb(246, 193, 119))
            .provider(Color::Rgb(156, 207, 216))
            .build(),
    }
}

pub fn rose_pine_dawn() -> Theme {
    Theme {
        name: "Rose Pine Dawn",
        palette: StyleToken::builder()
            .text(Color::Rgb(87, 82, 104))
            .text_dim(Color::Rgb(152, 147, 165))
            .accent(Color::Rgb(180, 140, 175))
            .surface(Color::Rgb(250, 244, 237))
            .error(Color::Rgb(180, 80, 100))
            .success(Color::Rgb(40, 160, 100))
            .thinking(Color::Rgb(190, 140, 60))
            .provider(Color::Rgb(100, 150, 170))
            .build(),
    }
}

pub fn material_darker() -> Theme {
    Theme {
        name: "Material Darker",
        palette: StyleToken::builder()
            .text(Color::Rgb(238, 238, 238))
            .text_dim(Color::Rgb(136, 136, 136))
            .accent(Color::Rgb(130, 177, 255))
            .surface(Color::Rgb(30, 30, 30))
            .error(Color::Rgb(255, 100, 100))
            .success(Color::Rgb(195, 232, 141))
            .thinking(Color::Rgb(255, 203, 107))
            .provider(Color::Rgb(199, 146, 234))
            .build(),
    }
}

pub fn material_ocean() -> Theme {
    Theme {
        name: "Material Ocean",
        palette: StyleToken::builder()
            .text(Color::Rgb(197, 215, 222))
            .text_dim(Color::Rgb(119, 138, 155))
            .accent(Color::Rgb(130, 177, 255))
            .surface(Color::Rgb(15, 22, 33))
            .error(Color::Rgb(255, 100, 100))
            .success(Color::Rgb(195, 232, 141))
            .thinking(Color::Rgb(255, 203, 107))
            .provider(Color::Rgb(199, 146, 234))
            .build(),
    }
}

pub fn material_palenight() -> Theme {
    Theme {
        name: "Material Palenight",
        palette: StyleToken::builder()
            .text(Color::Rgb(208, 207, 220))
            .text_dim(Color::Rgb(139, 137, 158))
            .accent(Color::Rgb(130, 177, 255))
            .surface(Color::Rgb(41, 44, 60))
            .error(Color::Rgb(255, 100, 100))
            .success(Color::Rgb(195, 232, 141))
            .thinking(Color::Rgb(255, 203, 107))
            .provider(Color::Rgb(199, 146, 234))
            .build(),
    }
}

pub fn github_dark() -> Theme {
    Theme {
        name: "GitHub Dark",
        palette: StyleToken::builder()
            .text(Color::Rgb(230, 237, 243))
            .text_dim(Color::Rgb(145, 152, 161))
            .accent(Color::Rgb(88, 166, 255))
            .surface(Color::Rgb(22, 27, 34))
            .error(Color::Rgb(248, 81, 73))
            .success(Color::Rgb(63, 185, 80))
            .thinking(Color::Rgb(210, 153, 34))
            .provider(Color::Rgb(210, 153, 34))
            .build(),
    }
}

pub fn github_light() -> Theme {
    Theme {
        name: "GitHub Light",
        palette: StyleToken::builder()
            .text(Color::Rgb(31, 35, 40))
            .text_dim(Color::Rgb(110, 119, 129))
            .accent(Color::Rgb(9, 105, 218))
            .surface(Color::Rgb(255, 255, 255))
            .error(Color::Rgb(207, 34, 46))
            .success(Color::Rgb(31, 136, 61))
            .thinking(Color::Rgb(154, 103, 0))
            .provider(Color::Rgb(154, 103, 0))
            .build(),
    }
}

pub fn synthwave84() -> Theme {
    Theme {
        name: "Synthwave84",
        palette: StyleToken::builder()
            .text(Color::Rgb(210, 200, 255))
            .text_dim(Color::Rgb(150, 130, 200))
            .accent(Color::Rgb(254, 114, 199))
            .surface(Color::Rgb(38, 35, 58))
            .error(Color::Rgb(255, 85, 85))
            .success(Color::Rgb(80, 250, 123))
            .thinking(Color::Rgb(241, 250, 140))
            .provider(Color::Rgb(139, 133, 255))
            .build(),
    }
}

pub fn cyberpunk() -> Theme {
    Theme {
        name: "Cyberpunk",
        palette: StyleToken::builder()
            .text(Color::Rgb(200, 200, 200))
            .text_dim(Color::Rgb(120, 120, 120))
            .accent(Color::Rgb(255, 0, 128))
            .surface(Color::Rgb(20, 20, 30))
            .error(Color::Rgb(255, 50, 50))
            .success(Color::Rgb(0, 255, 200))
            .thinking(Color::Rgb(255, 255, 0))
            .provider(Color::Rgb(0, 200, 255))
            .build(),
    }
}

pub fn moonlight() -> Theme {
    Theme {
        name: "Moonlight",
        palette: StyleToken::builder()
            .text(Color::Rgb(200, 210, 230))
            .text_dim(Color::Rgb(120, 135, 165))
            .accent(Color::Rgb(150, 180, 240))
            .surface(Color::Rgb(30, 35, 50))
            .error(Color::Rgb(230, 90, 100))
            .success(Color::Rgb(120, 200, 140))
            .thinking(Color::Rgb(220, 190, 110))
            .provider(Color::Rgb(170, 140, 220))
            .build(),
    }
}

pub fn night_owl() -> Theme {
    Theme {
        name: "Night Owl",
        palette: StyleToken::builder()
            .text(Color::Rgb(214, 222, 235))
            .text_dim(Color::Rgb(130, 145, 170))
            .accent(Color::Rgb(130, 170, 255))
            .surface(Color::Rgb(15, 20, 35))
            .error(Color::Rgb(255, 100, 120))
            .success(Color::Rgb(120, 210, 130))
            .thinking(Color::Rgb(255, 210, 100))
            .provider(Color::Rgb(190, 140, 255))
            .build(),
    }
}

pub fn aurora() -> Theme {
    Theme {
        name: "Aurora",
        palette: StyleToken::builder()
            .text(Color::Rgb(220, 235, 250))
            .text_dim(Color::Rgb(130, 160, 190))
            .accent(Color::Rgb(100, 220, 180))
            .surface(Color::Rgb(20, 30, 45))
            .error(Color::Rgb(255, 110, 110))
            .success(Color::Rgb(80, 220, 130))
            .thinking(Color::Rgb(220, 200, 100))
            .provider(Color::Rgb(160, 130, 240))
            .build(),
    }
}

pub fn hack_the_box() -> Theme {
    Theme {
        name: "Hack The Box",
        palette: StyleToken::builder()
            .text(Color::Rgb(0, 255, 0))
            .text_dim(Color::Rgb(0, 180, 0))
            .accent(Color::Rgb(0, 255, 100))
            .surface(Color::Rgb(0, 10, 0))
            .error(Color::Rgb(255, 0, 0))
            .success(Color::Rgb(0, 255, 0))
            .thinking(Color::Rgb(255, 255, 0))
            .provider(Color::Rgb(0, 200, 200))
            .build(),
    }
}

pub fn doom_emacs() -> Theme {
    Theme {
        name: "Doom Emacs",
        palette: StyleToken::builder()
            .text(Color::Rgb(210, 215, 225))
            .text_dim(Color::Rgb(130, 140, 155))
            .accent(Color::Rgb(82, 150, 230))
            .surface(Color::Rgb(30, 30, 40))
            .error(Color::Rgb(255, 80, 90))
            .success(Color::Rgb(120, 210, 120))
            .thinking(Color::Rgb(230, 200, 100))
            .provider(Color::Rgb(190, 130, 230))
            .build(),
    }
}

pub fn onedark_pro() -> Theme {
    Theme {
        name: "OneDark Pro",
        palette: StyleToken::builder()
            .text(Color::Rgb(171, 178, 191))
            .text_dim(Color::Rgb(92, 99, 112))
            .accent(Color::Rgb(198, 120, 221))
            .surface(Color::Rgb(40, 44, 52))
            .error(Color::Rgb(224, 108, 117))
            .success(Color::Rgb(152, 195, 121))
            .thinking(Color::Rgb(229, 192, 123))
            .provider(Color::Rgb(97, 175, 239))
            .build(),
    }
}

pub fn japanish() -> Theme {
    Theme {
        name: "Japanish",
        palette: StyleToken::builder()
            .text(Color::Rgb(220, 215, 200))
            .text_dim(Color::Rgb(150, 140, 130))
            .accent(Color::Rgb(220, 80, 80))
            .surface(Color::Rgb(35, 30, 30))
            .error(Color::Rgb(200, 50, 50))
            .success(Color::Rgb(140, 180, 100))
            .thinking(Color::Rgb(200, 170, 80))
            .provider(Color::Rgb(180, 140, 200))
            .build(),
    }
}

pub fn forest() -> Theme {
    Theme {
        name: "Forest",
        palette: StyleToken::builder()
            .text(Color::Rgb(195, 205, 185))
            .text_dim(Color::Rgb(120, 135, 110))
            .accent(Color::Rgb(140, 195, 110))
            .surface(Color::Rgb(30, 40, 30))
            .error(Color::Rgb(200, 80, 70))
            .success(Color::Rgb(140, 195, 110))
            .thinking(Color::Rgb(200, 170, 90))
            .provider(Color::Rgb(110, 170, 140))
            .build(),
    }
}

pub fn marine() -> Theme {
    Theme {
        name: "Marine",
        palette: StyleToken::builder()
            .text(Color::Rgb(185, 210, 220))
            .text_dim(Color::Rgb(110, 145, 160))
            .accent(Color::Rgb(80, 180, 210))
            .surface(Color::Rgb(20, 35, 45))
            .error(Color::Rgb(220, 80, 80))
            .success(Color::Rgb(80, 200, 160))
            .thinking(Color::Rgb(200, 180, 90))
            .provider(Color::Rgb(140, 160, 210))
            .build(),
    }
}

pub fn candy() -> Theme {
    Theme {
        name: "Candy",
        palette: StyleToken::builder()
            .text(Color::Rgb(240, 220, 240))
            .text_dim(Color::Rgb(180, 140, 180))
            .accent(Color::Rgb(255, 100, 180))
            .surface(Color::Rgb(40, 25, 40))
            .error(Color::Rgb(255, 60, 100))
            .success(Color::Rgb(100, 230, 180))
            .thinking(Color::Rgb(255, 200, 100))
            .provider(Color::Rgb(180, 140, 255))
            .build(),
    }
}

pub fn blood() -> Theme {
    Theme {
        name: "Blood",
        palette: StyleToken::builder()
            .text(Color::Rgb(220, 180, 180))
            .text_dim(Color::Rgb(150, 100, 100))
            .accent(Color::Rgb(255, 50, 50))
            .surface(Color::Rgb(30, 10, 10))
            .error(Color::Rgb(255, 0, 0))
            .success(Color::Rgb(200, 100, 100))
            .thinking(Color::Rgb(255, 150, 50))
            .provider(Color::Rgb(200, 80, 80))
            .build(),
    }
}

pub fn ocean() -> Theme {
    Theme {
        name: "Ocean",
        palette: StyleToken::builder()
            .text(Color::Rgb(200, 220, 235))
            .text_dim(Color::Rgb(130, 155, 175))
            .accent(Color::Rgb(60, 160, 220))
            .surface(Color::Rgb(20, 35, 50))
            .error(Color::Rgb(230, 90, 90))
            .success(Color::Rgb(70, 200, 160))
            .thinking(Color::Rgb(210, 190, 90))
            .provider(Color::Rgb(120, 160, 220))
            .build(),
    }
}
