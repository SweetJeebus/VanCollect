import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import * as Recollect from './recollect.js';

export default class GarbageDayPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const session = Recollect.newSession();
        let cancellable = null;

        const page = new Adw.PreferencesPage();
        window.add(page);

        // --- Address ---
        const addrGroup = new Adw.PreferencesGroup({
            title: 'Address',
            description: 'Search for your address and pick it from the results.',
        });
        page.add(addrGroup);

        const current = new Adw.ActionRow({title: 'Current address'});
        const updateCurrent = () => {
            current.subtitle = settings.get_string('address-name') ||
                settings.get_string('place-id') || 'Not set';
        };
        updateCurrent();
        settings.connect('changed::address-name', updateCurrent);
        addrGroup.add(current);

        const search = new Adw.EntryRow({title: 'Search (e.g. 453 W 12th Ave)', show_apply_button: true});
        addrGroup.add(search);

        const resultsGroup = new Adw.PreferencesGroup({title: 'Results', visible: false});
        page.add(resultsGroup);
        let resultRows = [];

        const clearResults = () => {
            resultRows.forEach(r => resultsGroup.remove(r));
            resultRows = [];
        };
        const addInfoRow = text => {
            const row = new Adw.ActionRow({title: text});
            resultsGroup.add(row);
            resultRows.push(row);
        };

        const doSearch = async () => {
            const q = search.text.trim();
            if (!q)
                return;
            cancellable?.cancel();
            cancellable = new Gio.Cancellable();
            clearResults();
            resultsGroup.visible = true;
            addInfoRow('Searching…');
            try {
                const results = await Recollect.suggestAddresses(session,
                    settings.get_string('area'), q, cancellable);
                clearResults();
                if (results.length === 0)
                    addInfoRow('No matches');
                for (const r of results) {
                    const row = new Adw.ActionRow({title: r.name, activatable: true});
                    row.connect('activated', () => {
                        settings.set_string('address-name', r.name);
                        settings.set_int('service-id', r.serviceId);
                        settings.set_string('place-id', r.placeId);
                        clearResults();
                        resultsGroup.visible = false;
                        search.text = '';
                    });
                    resultsGroup.add(row);
                    resultRows.push(row);
                }
            } catch (e) {
                if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                    return;
                clearResults();
                addInfoRow(`Search failed: ${e.message}`);
            }
        };
        search.connect('apply', doSearch);
        search.connect('entry-activated', doSearch);

        // --- Reminder ---
        const remGroup = new Adw.PreferencesGroup({title: 'Reminder'});
        page.add(remGroup);

        const remSwitch = new Adw.SwitchRow({
            title: 'Notify the evening before',
            subtitle: 'Desktop notification when pickup is tomorrow',
        });
        settings.bind('reminder-enabled', remSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
        remGroup.add(remSwitch);

        const hourRow = new Adw.SpinRow({
            title: 'Reminder time (hour, 24h)',
            adjustment: new Gtk.Adjustment({lower: 0, upper: 23, step_increment: 1}),
        });
        settings.bind('reminder-hour', hourRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('reminder-enabled', hourRow, 'sensitive', Gio.SettingsBindFlags.GET);
        remGroup.add(hourRow);

        // --- Advanced ---
        const advGroup = new Adw.PreferencesGroup({title: 'Advanced'});
        page.add(advGroup);

        const areaRow = new Adw.EntryRow({title: 'ReCollect area (for address search)'});
        settings.bind('area', areaRow, 'text', Gio.SettingsBindFlags.DEFAULT);
        advGroup.add(areaRow);

        const placeRow = new Adw.EntryRow({title: 'Place ID'});
        settings.bind('place-id', placeRow, 'text', Gio.SettingsBindFlags.DEFAULT);
        advGroup.add(placeRow);

        const serviceRow = new Adw.SpinRow({
            title: 'Service ID',
            adjustment: new Gtk.Adjustment({lower: 0, upper: 100000, step_increment: 1}),
        });
        settings.bind('service-id', serviceRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        advGroup.add(serviceRow);

        window.connect('close-request', () => {
            cancellable?.cancel();
            session.abort();
        });
    }
}
