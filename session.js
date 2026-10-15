import {dayKey} from './core.js';

export function isSessionCurrent(session, now = Date.now()) {
 return Boolean(session && session.day === dayKey(now));
}
