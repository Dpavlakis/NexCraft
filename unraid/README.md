# NexCraft on Unraid (Community Applications)

NexCraft ships as **two containers**: `NexCraft-Web` (the dashboard) and
`NexCraft-Daemon` (runs the servers). The templates here are the Unraid
Community Applications (CA) templates that pull the published images:

- `ghcr.io/dpavlakis/nexcraft-web:latest`
- `ghcr.io/dpavlakis/nexcraft-daemon:latest`

## 1. Publish the images (one-time per release)

The `.github/workflows/docker.yml` workflow builds + pushes both images to
GHCR. Trigger it by **publishing a GitHub Release** (tag e.g. `v1.0.0`), pushing
a `v*` tag, or running it manually from the **Actions** tab.

Then make the packages **public** (one-time): GitHub → your profile →
**Packages** → `nexcraft-web` and `nexcraft-daemon` → **Package settings** →
**Change visibility → Public**. (Unraid users can't pull a private package.)

## 2. Test the templates locally before submitting

On the Unraid server, copy both XML files into the user-templates folder:

```bash
cp nexcraft-web.xml nexcraft-daemon.xml /boot/config/plugins/dockerMan/templates-user/
```

Then **Docker tab → Add Container → Template** dropdown → pick `NexCraft-Web` /
`NexCraft-Daemon`. Install the daemon first, then the web, open `:23333`, finish
first-time setup, and add the daemon node (`:24444`) if it isn't auto-detected
(its access key is in `daemon/data/Config/global.json`).

## 3. Submit to Community Applications

CA is a moderated, central feed — you request inclusion of this repo:

1. Create a **support thread** on the Unraid forums for NexCraft.
2. Open a request/PR at <https://github.com/selfhosters/unRAID-CA-templates>
   (the standard "add my templates to CA" repo), pointing at this `unraid/`
   folder, with the support-thread link.
3. A CA moderator vets it (public image, valid template, icon, support thread).
   Once approved it appears in the **Apps** tab.

## Notes

- **Networking:** templates default to **bridge** with published ports
  (23333 / 24444) so they work for everyone. Advanced users can switch to a
  custom/macvlan network with static IPs.
- **Icon:** currently the SVG logo. If CA doesn't render it, add a 256×256
  `icon.png` to the repo and point `<Icon>` at it.
- **Backups:** the daemon template has an optional separate-share backup mount;
  leave it blank to keep backups inside appdata.
