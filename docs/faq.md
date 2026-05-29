# Troubleshooting / FAQ

## A server won't start with `UnsupportedClassVersionError` (wrong Java version)

The pack needs a newer (or older) Java than the daemon's default. NexCraft tries to provision the right one automatically, but if it didn't:

1. Open the instance's **Java Manager**.
2. Pick the vendor (Adoptium / Azul Zulu) and the **major** version the pack needs (e.g. Java 17 for 1.18–1.20, Java 21+ for newer, Java 8 for very old packs).
3. Install a release and click **Use**, then start the server again.

The error message tells you the required class-file version, e.g. *class file version 65.0 = Java 21*, *69.0 = Java 25*.

## "This CurseForge modpack has no server pack"

That pack's author didn't publish a server pack file for the version you picked, so it can't be installed as a server. Try a different version of the pack, or use a pack that ships a server pack. (Modrinth packs use `.mrpack` and generally work.)

## The server starts but players can't connect

- Check the **port**. NexCraft auto-assigns a free port from 25565 up; confirm `server-port` in **Config Files → server.properties** and that the port is forwarded/allowed by your firewall.
- For modpacks, make sure the server fully reached **Running** (not still **Starting**).

## Status stays "Starting" forever

NexCraft holds the status at **Starting** until the server logs that it's ready (e.g. *Done (…)! For help…*). If it never flips:

- The server may have crashed during boot — check the console for errors.
- A safety timeout (15 min) will return it to a normal state; check the logs to see why it didn't come up.

## I deleted a running instance and nothing happened (older behavior)

Deleting a running instance now **force-stops it first, then deletes**. If you're on an old build, stop the server before deleting.

## The Minecraft page URL

The Minecraft builder lives at `/#/minecraft` (it was renamed from `/#/market`). Old `/#/market` links no longer resolve — use the **Minecraft** nav item.

## How is this different from MCSManager?

NexCraft is a Minecraft-focused fork of [MCSManager](https://github.com/MCSManager/MCSManager). The big additions are the modpack browser/installer, per-instance update and reset, auto-Java, and a streamlined Minecraft-only UI (no Docker-container instances, no Steam games). If you need Steam games, Docker-container instances, or commercial/multi-tenant hosting, use upstream MCSManager.

## Where do I report a bug?

Open an issue on the NexCraft repository: https://github.com/Dpavlakis/NexCraft/issues
