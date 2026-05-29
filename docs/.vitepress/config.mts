import { defineConfig } from "vitepress";

// NexCraft documentation site.
// Built and deployed by .github/workflows/docs.yml to GitHub Pages
// (https://dpavlakis.github.io/NexCraft/). Project Pages → base must match the repo name.
export default defineConfig({
  title: "NexCraft",
  description:
    "A Minecraft-focused server control panel with a built-in modpack installer & manager.",
  base: "/NexCraft/",
  lang: "en-US",
  cleanUrls: true,
  lastUpdated: true,

  // Don't turn helper READMEs into routes.
  srcExclude: ["images/README.md"],

  head: [
    ["link", { rel: "icon", type: "image/svg+xml", href: "/NexCraft/nexcraft_logo.svg" }]
  ],

  themeConfig: {
    logo: "/nexcraft_logo.svg",
    siteTitle: "NexCraft",

    nav: [
      { text: "Home", link: "/" },
      { text: "Guide", link: "/installation" },
      { text: "FAQ", link: "/faq" },
      { text: "GitHub", link: "https://github.com/Dpavlakis/NexCraft" }
    ],

    sidebar: [
      {
        text: "Guide",
        items: [
          { text: "Introduction", link: "/introduction" },
          { text: "Installation", link: "/installation" },
          { text: "Creating Minecraft Servers", link: "/creating-servers" },
          { text: "Updating & Resetting Modpacks", link: "/modpacks" },
          { text: "Managing an Instance", link: "/managing-instances" },
          { text: "Troubleshooting / FAQ", link: "/faq" }
        ]
      }
    ],

    socialLinks: [{ icon: "github", link: "https://github.com/Dpavlakis/NexCraft" }],

    search: {
      provider: "local"
    },

    editLink: {
      pattern: "https://github.com/Dpavlakis/NexCraft/edit/main/docs/:path",
      text: "Edit this page on GitHub"
    },

    footer: {
      message:
        'Built on the open-source <a href="https://github.com/MCSManager/MCSManager">MCSManager</a> panel.',
      copyright: "NexCraft — a Minecraft-focused fork of MCSManager."
    }
  }
});
