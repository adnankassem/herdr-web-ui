### Fixed
- On Android the keyboard no longer shows its word-suggestion strip while typing in the terminal
  (the input line or the grid): those inputs now also say `autocomplete="off"`, the attribute Chrome
  turns into the keyboard's no-suggestions flag. The chat composer keeps its suggestions.
