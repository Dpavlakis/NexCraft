# NexCraft brand font

Place the **Minecrafter** font here as `minecrafter.ttf`:

```
frontend/public/fonts/minecrafter.ttf
```

Download it from https://www.fontspace.com/minecrafter-font-f123510 (extract the `.ttf`
from the zip and rename it to `minecrafter.ttf`).

The header brand ("NexCraft") and the `.nexcraft-brand-text` class use this font via the
`@font-face` in `src/assets/global.scss`. Until the file is present, the brand text falls
back to a system font (everything still works — it just isn't the pixel font).
