# Creating Minecraft Servers

NexCraft replaces the generic app marketplace with a **Prism-Launcher-style Minecraft builder**. Open the **Minecraft** menu (URL `/#/minecraft`) to get started. There are three sources in the left sidebar:

- **Custom** — build a fresh server for any Minecraft version.
- **CurseForge** — search and install CurseForge modpacks.
- **Modrinth** — search and install Modrinth modpacks.

## Custom (Vanilla / loaders / server software)

1. Select **Custom**.
2. Pick a **mod loader** from the row of icons:
   - **Vanilla** — the official Mojang server.
   - **Paper**, **Purpur**, **Folia** — high-performance server software (downloaded as a ready-to-run jar from their official APIs).
   - **Fabric**, **Forge**, **NeoForge**, **Quilt** — modloaders (the daemon runs the official installer/bootstrap).
3. Choose a **Minecraft version** from the list. Versions are pulled live — Mojang's manifest for Vanilla/loaders, and each project's API for Paper/Purpur/Folia. Tick **Show snapshots** to include non-release versions.
4. Click **Install**, set an **instance name** and **max memory**, and confirm.

The daemon downloads the server, runs any loader bootstrap, assigns a free port, and writes the start command for you.

## CurseForge / Modrinth modpacks

1. Select **CurseForge** or **Modrinth** and search (or browse the popular list).
2. Click a pack to open its detail dialog — description, tags, supported versions, and a **Version** picker.
3. Choose a version, accept the **Minecraft EULA**, set memory, and **Install**.

What happens under the hood:

- **CurseForge:** NexCraft installs the pack's **server pack** file. Packs without a server pack are shown disabled ("no server pack").
- **Modrinth:** NexCraft installs the full **`.mrpack`** server files (mods + overrides).
- The correct **mod loader and version** are resolved automatically from the pack metadata, and a matching **Java** version is provisioned if needed.
- Known **client-only mods** that crash dedicated servers (e.g. `e4mc` shipped in client optimization packs) are stripped automatically.
- A **server icon** is generated from the pack's logo, and the **EULA** is accepted on your behalf.

After install, NexCraft routes you to the instance's console to watch the bootstrap and start the server.

## Starting the server

On the instance terminal, click **Start**. NexCraft shows **"Instance is starting…"** while the server boots and only flips to **Running** once the server actually reports it's ready — so the status reflects reality, not just that the process launched.

## Notes

- All servers run in **host / general process mode**. Running servers inside Docker containers is not supported in NexCraft.
- Ports are auto-assigned from 25565 upward so multiple servers don't collide. You can change them later in the server's `server.properties` (Config Files) or instance settings.
- The **start command** is generated for you but is editable under **Instance Settings → Startup Command** if you need to tweak it.
