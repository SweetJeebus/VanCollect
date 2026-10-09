import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import * as Recollect from './recollect.js';

const FETCH_INTERVAL_S = 6 * 60 * 60;
const RETRY_INTERVAL_S = 15 * 60;
const TICK_INTERVAL_S = 5 * 60;
const MENU_PICKUPS = 6;

function dot(color) {
    return new St.Widget({
        style_class: 'garbage-day-dot',
        style: `background-color: ${color};`,
        y_align: Clutter.ActorAlign.CENTER,
    });
}

const GarbageIndicator = GObject.registerClass(
class GarbageIndicator extends PanelMenu.Button {
    _init(ext) {
        super._init(0.5, 'Garbage Day');
        this._ext = ext;
        this._settings = ext.getSettings();
        this._session = Recollect.newSession();
        this._cancellable = new Gio.Cancellable();
        this._schedule = null;
        this._lastError = null;
        this._fetchTimer = 0;

        const box = new St.BoxLayout({style_class: 'panel-status-menu-box garbage-day-box'});
        box.add_child(new St.Icon({icon_name: 'user-trash-symbolic', style_class: 'system-status-icon'}));
        this._dots = new St.BoxLayout({style_class: 'garbage-day-dots', y_align: Clutter.ActorAlign.CENTER});
        box.add_child(this._dots);
        this._label = new St.Label({style_class: 'garbage-day-label', y_align: Clutter.ActorAlign.CENTER});
        box.add_child(this._label);
        this.add_child(box);

        try {
            const cached = this._settings.get_string('cache');
            if (cached)
                this._schedule = JSON.parse(cached);
        } catch (e) {
            console.warn(`garbage-day: ignoring bad cache: ${e.message}`);
        }

        this._settingsIds = ['place-id', 'service-id'].map(key =>
            this._settings.connect(`changed::${key}`, () => {
                this._schedule = null;
                this._settings.set_string('cache', '');
                this._refresh();
            }));
        this._settingsIds.push(this._settings.connect('changed::address-name', () => this._render()));

        this._tickId = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, TICK_INTERVAL_S, () => {
            this._render();
            this._maybeNotify();
            return GLib.SOURCE_CONTINUE;
        });

        this._render();
        this._refresh();
    }

    get _configured() {
        return this._settings.get_string('place-id') !== '';
    }

    _scheduleFetch(seconds) {
        if (this._fetchTimer)
            GLib.source_remove(this._fetchTimer);
        this._fetchTimer = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, seconds, () => {
            this._fetchTimer = 0;
            this._refresh();
            return GLib.SOURCE_REMOVE;
        });
    }

    async _refresh() {
        if (!this._configured) {
            this._render();
            return;
        }
        try {
            this._schedule = await Recollect.fetchSchedule(this._session,
                this._settings.get_string('place-id'),
                this._settings.get_int('service-id'),
                this._cancellable);
            this._lastError = null;
            this._settings.set_string('cache', JSON.stringify(this._schedule));
            this._scheduleFetch(FETCH_INTERVAL_S);
        } catch (e) {
            if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                return;
            console.warn(`garbage-day: fetch failed: ${e.message}`);
            this._lastError = e.message;
            this._scheduleFetch(RETRY_INTERVAL_S);
        }
        this._render();
        this._maybeNotify();
    }

    _upcoming() {
        const today = Recollect.localDay(0);
        return (this._schedule?.pickups ?? []).filter(p => p.day >= today);
    }

    _render() {
        this._dots.destroy_all_children();
        this.remove_style_class_name('garbage-day-soon');

        if (!this._configured) {
            this._label.text = 'Set address';
        } else {
            const next = this._upcoming()[0];
            if (next) {
                next.items.forEach(i => this._dots.add_child(dot(i.color)));
                this._label.text = Recollect.relativeDayLabel(next.day);
                if (next.day <= Recollect.localDay(1))
                    this.add_style_class_name('garbage-day-soon');
            } else {
                this._label.text = this._schedule ? 'None' : '…';
            }
        }
        this._buildMenu();
    }

    _buildMenu() {
        this.menu.removeAll();

        if (!this._configured) {
            this.menu.addMenuItem(new PopupMenu.PopupMenuItem('No address set', {reactive: false}));
        } else {
            const header = new PopupMenu.PopupMenuItem(
                this._settings.get_string('address-name') || 'Collection schedule', {reactive: false});
            header.label.add_style_class_name('garbage-day-header');
            this.menu.addMenuItem(header);

            const pickups = this._upcoming().slice(0, MENU_PICKUPS);
            if (pickups.length === 0) {
                this.menu.addMenuItem(new PopupMenu.PopupMenuItem(
                    this._schedule ? 'No pickups in the next few weeks' : 'Loading…', {reactive: false}));
            }
            for (const p of pickups) {
                const item = new PopupMenu.PopupBaseMenuItem({reactive: false});
                const when = new St.Label({
                    text: `${Recollect.longDayLabel(p.day)}`,
                    style_class: 'garbage-day-when',
                    y_align: Clutter.ActorAlign.CENTER,
                });
                item.add_child(when);
                const dots = new St.BoxLayout({style_class: 'garbage-day-dots', y_align: Clutter.ActorAlign.CENTER});
                p.items.forEach(i => dots.add_child(dot(i.color)));
                item.add_child(dots);
                item.add_child(new St.Label({
                    text: p.items.map(i => i.subject).join(', '),
                    y_align: Clutter.ActorAlign.CENTER,
                }));
                const rel = Recollect.relativeDayLabel(p.day);
                if (rel === 'Today' || rel === 'Tomorrow')
                    when.add_style_class_name('garbage-day-soon');
                this.menu.addMenuItem(item);
            }

            const today = Recollect.localDay(0);
            const lastShown = pickups.at(-1)?.day ?? today;
            const holidays = (this._schedule?.holidays ?? [])
                .filter(h => h.endDay >= today && h.day <= lastShown);
            if (holidays.length) {
                this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem('Holidays (schedule shifted)'));
                for (const h of holidays) {
                    this.menu.addMenuItem(new PopupMenu.PopupMenuItem(
                        `${Recollect.longDayLabel(h.day)} — ${h.subject}`, {reactive: false}));
                }
            }

            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            let status;
            if (this._lastError)
                status = 'Update failed — showing cached schedule';
            else if (this._schedule?.fetched)
                status = `Updated ${GLib.DateTime.new_from_iso8601(this._schedule.fetched, null)?.to_local().format('%b %-d, %H:%M') ?? ''}`;
            if (status) {
                const s = new PopupMenu.PopupMenuItem(status, {reactive: false});
                s.label.add_style_class_name('garbage-day-status');
                this.menu.addMenuItem(s);
            }
            this.menu.addAction('Refresh', () => this._refresh());
        }
        this.menu.addAction('Settings…', () => this._ext.openPreferences());
    }

    _maybeNotify() {
        if (!this._configured || !this._settings.get_boolean('reminder-enabled'))
            return;
        const now = GLib.DateTime.new_now_local();
        if (now.get_hour() < this._settings.get_int('reminder-hour'))
            return;
        const tomorrow = Recollect.localDay(1);
        const p = this._upcoming().find(x => x.day === tomorrow);
        if (!p || this._settings.get_string('last-notified') === tomorrow)
            return;
        this._settings.set_string('last-notified', tomorrow);
        Main.notify('Garbage day tomorrow',
            `Put out: ${p.items.map(i => i.subject).join(', ')}`);
    }

    destroy() {
        this._cancellable.cancel();
        if (this._fetchTimer)
            GLib.source_remove(this._fetchTimer);
        this._fetchTimer = 0;
        if (this._tickId)
            GLib.source_remove(this._tickId);
        this._tickId = 0;
        this._settingsIds.forEach(id => this._settings.disconnect(id));
        this._session.abort();
        super.destroy();
    }
});

export default class GarbageDayExtension extends Extension {
    enable() {
        this._indicator = new GarbageIndicator(this);
        // Sit just to the right of system-monitor-next if it's in the panel.
        const box = Main.panel._rightBox;
        const sysmon = Main.panel.statusArea['system-monitor'];
        const idx = sysmon ? box.get_children().indexOf(sysmon.container) : -1;
        Main.panel.addToStatusArea(this.uuid, this._indicator, idx >= 0 ? idx + 1 : 1, 'right');
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}
