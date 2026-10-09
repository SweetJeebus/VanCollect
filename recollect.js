// Thin client for the public ReCollect API (used by City of Vancouver waste collection).
// Shared by extension.js and prefs.js, so it must not import any Shell or GTK modules.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

Gio._promisify(Soup.Session.prototype, 'send_and_read_async', 'send_and_read_finish');

const API = 'https://api.recollect.net/api';
const DAYS_AHEAD = 45;

export function newSession() {
    const session = new Soup.Session({timeout: 20});
    session.user_agent = 'gnome-shell-garbage-day/1';
    return session;
}

async function getJson(session, url, cancellable = null) {
    const msg = Soup.Message.new('GET', url);
    const bytes = await session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, cancellable);
    if (msg.get_status() !== Soup.Status.OK)
        throw new Error(`HTTP ${msg.get_status()} from ${url}`);
    return JSON.parse(new TextDecoder().decode(bytes.get_data()));
}

/** Returns [{name, placeId, serviceId}] for an address search string. */
export async function suggestAddresses(session, area, query, cancellable = null) {
    const url = `${API}/areas/${encodeURIComponent(area)}/services/waste/address-suggest` +
        `?q=${encodeURIComponent(query)}&locale=en`;
    const results = await getJson(session, url, cancellable);
    return results
        .filter(r => r.place_id)
        .map(r => ({name: r.name, placeId: r.place_id, serviceId: r.service_id}));
}

/**
 * Fetches upcoming events and reduces them to
 *   {fetched: ISO time, pickups: [{day, items: [{name, subject, color}]}], holidays: [{day, endDay, subject}]}
 * sorted by day. Calendar-only noise ("Services", "Bin service – …") is dropped.
 */
export async function fetchSchedule(session, placeId, serviceId, cancellable = null) {
    const now = GLib.DateTime.new_now_local();
    const after = now.format('%F');
    const before = now.add_days(DAYS_AHEAD).format('%F');
    const url = `${API}/places/${encodeURIComponent(placeId)}/services/${serviceId}/events` +
        `?after=${after}&before=${before}&locale=en`;
    const data = await getJson(session, url, cancellable);
    return {fetched: now.format_iso8601(), ...parseEvents(data.events ?? [])};
}

export function parseEvents(events) {
    const byDay = new Map();
    const holidays = [];

    for (const ev of events) {
        if (ev.type === 'holiday' || ev.is_holiday) {
            holidays.push({
                day: ev.day,
                endDay: ev.end_day ?? ev.day,
                subject: ev.flags?.[0]?.subject ?? ev.title ?? 'Holiday',
            });
            continue;
        }
        for (const f of ev.flags ?? []) {
            if (f.event_type !== 'pickup')
                continue;
            const proto = f.opts?.event_proto ?? {};
            if (proto.calendar_only || proto.reminder_only)
                continue;
            if (!byDay.has(ev.day))
                byDay.set(ev.day, []);
            const items = byDay.get(ev.day);
            if (!items.some(i => i.name === f.name))
                items.push({name: f.name, subject: f.subject, color: f.color ?? f.backgroundColor ?? '#888888'});
        }
    }

    const pickups = [...byDay.entries()]
        .map(([day, items]) => ({day, items}))
        .sort((a, b) => a.day.localeCompare(b.day));
    holidays.sort((a, b) => a.day.localeCompare(b.day));
    return {pickups, holidays};
}

/** YYYY-MM-DD for today in local time, offset by `days`. */
export function localDay(days = 0) {
    return GLib.DateTime.new_now_local().add_days(days).format('%F');
}

function dateFromDay(day) {
    const [y, m, d] = day.split('-').map(Number);
    return GLib.DateTime.new_local(y, m, d, 0, 0, 0);
}

/** "Today", "Tomorrow", "Wed" (within a week) or "Oct 14". */
export function relativeDayLabel(day) {
    if (day === localDay(0))
        return 'Today';
    if (day === localDay(1))
        return 'Tomorrow';
    const dt = dateFromDay(day);
    const diff = dt.difference(dateFromDay(localDay(0))) / GLib.TIME_SPAN_DAY;
    return diff > 0 && diff < 7 ? dt.format('%a') : dt.format('%b %-d');
}

/** "Wed, Oct 14" */
export function longDayLabel(day) {
    return dateFromDay(day).format('%a, %b %-d');
}
