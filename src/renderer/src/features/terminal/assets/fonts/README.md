# Terminal symbol font

`SymbolsNerdFontMono-Regular.woff2` is a symbols-only fallback. OpenWaggle
loads it lazily for terminal panes and places it after the user's selected text
font, so it fills missing prompt and devicon glyphs without replacing the
user's text face or its metrics.

- Upstream project: [Nerd Fonts](https://github.com/ryanoasis/nerd-fonts)
- Upstream release: [Nerd Fonts Symbols Only 3.4.0](https://github.com/ryanoasis/nerd-fonts/releases/download/v3.4.0/NerdFontsSymbolsOnly.zip)
- Font metadata: `Version 001.000;Nerd Fonts 3.4.0`, family `Symbols Nerd Font Mono`
- Browser conversion source: [T3 Code terminal asset](https://github.com/pingdotgg/t3code/tree/5192f777fe54c2a2a359f6c25ecf5fbde46d49b0/apps/web/src/terminal/ghostty/fonts)
- SHA-256: `a8e2fc5ae3c2525812151b95da80c5beab0befa84aca84fc33aaed94317502df`
- License: MIT; see `LICENSE` in this directory

The upstream symbols aggregate includes glyphs from multiple projects. Its
source and attribution index is maintained in the Nerd Fonts
[`src/glyphs` catalog](https://github.com/ryanoasis/nerd-fonts/tree/v3.4.0/src/glyphs).
