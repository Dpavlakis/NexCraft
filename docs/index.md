---
layout: home

hero:
  name: "NexCraft"
  text: "Minecraft server control panel"
  tagline: A self-hosted web panel with a built-in modpack installer & manager — search, install, build, and run Minecraft servers from one dashboard.
  image:
    src: /nexcraft_logo.svg
    alt: NexCraft
  actions:
    - theme: brand
      text: Get Started
      link: /installation
    - theme: alt
      text: Creating Servers
      link: /creating-servers
    - theme: alt
      text: View on GitHub
      link: https://github.com/Dpavlakis/NexCraft

features:
  - title: Modpack browser
    details: CurseForge / Modrinth / Custom, with live search, version pickers, and one-click install as a runnable server.
  - title: Every major loader
    details: Vanilla, Paper, Purpur, Folia, Fabric, Forge, NeoForge, Quilt — accurate versions pulled from official APIs.
  - title: Update & Reset
    details: Bump an installed pack to a newer version, or rebuild an instance — auto-backup first, world preserved.
  - title: Auto-Java
    details: Provisions a matching JRE (Adoptium / Azul Zulu) per pack, and auto-fixes Java-version mismatches on launch.
  - title: Backups
    details: Manual and scheduled backups with restore and exclusions, built on a reliable overwrite-safe extractor.
  - title: Players & Metrics
    details: RCON online list with op / kick / ban, plus per-instance CPU / RAM / player charts with zoom.
---

> NexCraft is built on the open-source [MCSManager](https://github.com/MCSManager/MCSManager) panel. For a general-purpose, multi-game / commercial panel, see upstream MCSManager and its docs at <https://docs.mcsmanager.com/>.
