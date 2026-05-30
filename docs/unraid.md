# Running NexCraft on Unraid

NexCraft ships two Docker images that you can run on Unraid with ready-made
Community Applications templates:

- `ghcr.io/dpavlakis/nexcraft-web` — the dashboard (web UI + API)
- `ghcr.io/dpavlakis/nexcraft-daemon` — the agent that runs your servers

You run **both**. The daemon does the work; the web panel is the dashboard.
Restarting or updating the panel never touches your running servers.

## 1. Add the templates

The templates aren't on the Community Applications store, so grab them from the
repository. Open a terminal on your Unraid box and run:

```bash
cd /boot/config/plugins/dockerMan/templates-user/
wget -O nexcraft-web.xml    https://raw.githubusercontent.com/Dpavlakis/NexCraft/main/unraid/nexcraft-web.xml
wget -O nexcraft-daemon.xml https://raw.githubusercontent.com/Dpavlakis/NexCraft/main/unraid/nexcraft-daemon.xml
```

## 2. Add the containers from the templates

In the Unraid web UI: **Docker** tab → **Add Container** → open the **Template**
dropdown at the top and pick **NexCraft-Daemon** (under *User templates*). The
image and paths come pre-filled — review them and click **Apply**. Unraid pulls
the image and starts it.

Then repeat for **NexCraft-Web**. Install the daemon first, then the web panel.

### What the templates set up

- **Ports:** Web UI on **23333**, daemon RPC on **24444**.
- **Data:** under `/mnt/user/appdata/nexcraft/...` by default — your instances,
  settings and the daemon access key persist here across updates.
- **Backups (daemon):** the **Backups** field defaults to
  `/mnt/user/Backup/Minecraft` so instance backups land on a dedicated share.
  Point it anywhere you like, or clear it to keep backups inside the Data volume.

## 3. First-time setup

1. Open `http://<server-ip>:23333/` and create your admin account.
2. If the panel doesn't auto-detect the daemon, go to **Daemons → Add** and
   point it at the daemon's address (`<server-ip>:24444`) using its access key.
3. Find the access key in the **NexCraft-Daemon** container's **logs**: click the
   container → **Logs**, and copy the value on the **Access Key:** line near the
   top.
4. Once the node shows **online**, you're ready to
   [create your first server](creating-servers.md).

## 4. Updating

When a new image is published, Unraid shows **"update ready"** for the container
on the **Docker** tab (use **Check for Updates** to refresh). Click it to pull
the new image and recreate the container — your data and daemon pairing persist.

## Notes

- **Networking:** the templates use **bridge** with published ports, which works
  for everyone. Advanced users can switch to a custom or macvlan network with
  static IPs.
- **Backups share:** if you point the daemon's Backups field at a dedicated
  share, that share must exist first.
- This is a personal project shared for others to use — support is best-effort.
  Issues and feedback are welcome on
  [GitHub](https://github.com/Dpavlakis/NexCraft/issues).
