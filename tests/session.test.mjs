import test from 'node:test';
import assert from 'node:assert/strict';
import {dayKey} from '../core.js';
let session = {};
try { session = await import('../session.js'); } catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }
const {isSessionCurrent} = session;

test('exports the session day guard', () => {
 assert.equal(typeof isSessionCurrent, 'function');
});
test('accepts a session throughout the same Shanghai day', () => {
 const current = Object.freeze({day:'2026-10-15'});
 assert.equal(isSessionCurrent(current,Date.parse('2026-10-14T16:00:00Z')),true);
 assert.equal(isSessionCurrent(current,Date.parse('2026-10-15T15:59:59.999Z')),true);
});
test('expires the previous queue exactly at Shanghai midnight, 16:00 UTC', () => {
 const previous = {day:'2026-10-14'};
 assert.equal(isSessionCurrent(previous,Date.parse('2026-10-14T15:59:59.999Z')),true);
 assert.equal(isSessionCurrent(previous,Date.parse('2026-10-14T16:00:00Z')),false);
});
test('expires a Saturday queue at the Sunday review-only boundary', () => {
 const saturday = {day:'2026-10-17'};
 assert.equal(isSessionCurrent(saturday,Date.parse('2026-10-17T15:59:59.999Z')),true);
 assert.equal(isSessionCurrent(saturday,Date.parse('2026-10-17T16:00:00Z')),false);
 assert.equal(isSessionCurrent({day:'2026-10-18'},Date.parse('2026-10-17T16:00:00Z')),true);
});
test('missing sessions and day values are never current', () => {
 const now=Date.parse('2026-10-15T04:00:00Z');
 for(const missing of [null,undefined,{}, {day:null}]) assert.equal(isSessionCurrent(missing,now),false);
});
test('future session days are not current', () => {
 assert.equal(isSessionCurrent({day:'2026-10-16'},Date.parse('2026-10-15T04:00:00Z')),false);
});
test('defaults to the current timestamp', t => {
 const now=Date.parse('2026-10-15T04:00:00Z');
 t.mock.method(Date,'now',()=>now);
 assert.equal(isSessionCurrent({day:dayKey(now)}),true);
});
