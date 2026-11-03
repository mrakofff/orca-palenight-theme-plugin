# Palenight for Orca

Material Palenight as an Orca plugin (`execution: data`, no code): app theme with editor code
colors (`tokenColors`) and a matching terminal palette.

The app theme sets 59 of Orca's public tokens: surfaces and text, sidebars, tabs and split dividers,
diff colors, git file-status colors and links. The values for tabs, diff, git status and links come
from the VS Code Palenight theme; tokens the theme leaves out fall back to Orca's own defaults.

## Try it

Orca → Settings → Plugins → **Development folders…** → add this folder. Orca watches the files
and reloads on change. Then pick **Palenight** as the Dark theme (and in the terminal theme list).

## Check

```sh
bun scripts/check.mjs
```

Stand-in for `orca plugin validate` (not available in every Orca build): token names, 6- or 8-digit
hex, file size, 4.5:1 text/surface pairs (including tabs and the host badge), the 3:1 floor for code
colors, links and git-status colors on their surface, and 2:1 for the active-tab indicator. Below
these Orca drops a value; for a failing text/surface pair it drops both colors, so a weak
`--muted-foreground` also throws out `--background` and the app canvas turns Orca-default black. Git-status colors must be opaque, or Orca drops them too.

## Limits

- Orca colors Monaco's built-in TypeScript/JavaScript tokenizer through a fixed token → scope map,
  so TS has fewer distinct colors than VS Code (no separate property/parameter colors).
- Selectors with spaces and `semanticTokenColors` are not read.
- The Palenight comment color `#676E95` is 2.76:1 on `#292D3E`; it is lifted to `#7A82A6` (3.62:1)
  so Orca does not discard it.

## Credits

Colors derive from [Material Palenight Theme](https://github.com/binhduc1211/daniel-material-palenight-theme)
by Binh Duc (MIT) and from [vscode-palenight-theme](https://github.com/whizkydee/vscode-palenight-theme)
by Olaolu Olawuyi (MIT); see `THIRD_PARTY_NOTICES.txt`.
