# VanCollect

A GNOME Shell extension (GNOME 46) that shows your next City of Vancouver garbage / green bin pickup in the top bar, using the public [ReCollect](https://recollect.net) API.

- Coloured dots for each pickup type (Garbage, Green Bin, Leaf Collection) plus the day: *Today*, *Tomorrow*, a weekday, or a date
- Click for the next six pickups and any upcoming holidays that shift the schedule
- Optional desktop notification the evening before pickup (default 18:00)
- Refreshes every 6 hours; caches the last schedule so it still works offline
- Places itself next to [system-monitor-next](https://github.com/mgalgs/gnome-shell-system-monitor-next-applet) if that's installed

## Install

```sh
git clone git@github.com:SweetJeebus/VanCollect.git
cd VanCollect
glib-compile-schemas schemas
ln -sfn "$PWD" ~/.local/share/gnome-shell/extensions/vancollect@sweetjeebus.github.io
```

Log out and back in (Wayland only picks up new extensions at login), then:

```sh
gnome-extensions enable vancollect@sweetjeebus.github.io
gnome-extensions prefs vancollect@sweetjeebus.github.io
```

In the preferences window, search for your street address and pick it from the results. That fills in the ReCollect place ID and service ID.

## Other cities

Any city on ReCollect should work: change **ReCollect area** under *Advanced* in the preferences, then search for your address.

## Layout

| File | Purpose |
| --- | --- |
| `recollect.js` | API client and event parsing (no Shell/GTK imports, shared by both sides) |
| `extension.js` | Top-bar indicator, menu, refresh timers, reminder |
| `prefs.js` | Preferences window with address search |
| `schemas/` | GSettings schema |
