const DAY = 86400000;
const MODULES = ['email', 'discussion', 'repeat', 'interview'];
const RATINGS = ['again', 'hard', 'good'];
const UNSAFE = new Set(['__proto__', 'prototype', 'constructor']);
const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const clone = value => structuredClone(value);
const emptyDay = () => ({ seconds: 0, newIds: [], reviewIds: [], attempts: 0, correct: 0, completed: false });
const ensureDay = (state, key) => state.days[key] ??= emptyDay();
const addUnique = (items, value) => { if (!items.includes(value)) items.push(value); };

export function createState() {
  return { version: 1, settings: { dailyMinutes: 30, newLimit: 16, planVersion: 3 }, cards: {}, days: {}, session: null };
}

export function dayKey(dateOrTimestamp = new Date()) {
  const date = new Date(dateOrTimestamp);
  if (!Number.isFinite(date.getTime())) throw new TypeError('Invalid date');
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function timestamp(now) {
  if (typeof now !== 'number' || !Number.isFinite(now)) throw new TypeError('Invalid timestamp');
  return now;
}

export function buildQueue(cards, state, now = Date.now(), options = {}) {
  timestamp(now);
  const filtered = cards.filter(card => (options.module == null || options.module === 'all' || options.module === card.module)
    && (options.domain == null || options.domain === 'all' || options.domain === card.domain));
  const due = filtered.filter(card => has(state.cards, card.id) && state.cards[card.id].dueAt <= now);
  due.sort((a, b) => Number(state.cards[b.id].weak) - Number(state.cards[a.id].weak)
    || state.cards[a.id].dueAt - state.cards[b.id].dueAt || a.id.localeCompare(b.id));
  const key = dayKey(now);
  const sunday = new Date(`${key}T00:00:00Z`).getUTCDay() === 0;
  const quota = options.reviewOnly || sunday ? 0 : Math.max(0, state.settings.newLimit - (state.days[key]?.newIds.length ?? 0));
  const candidates = filtered.filter(card => !has(state.cards, card.id));
  const fresh = [];
  const pattern = ['email', 'discussion', 'repeat', 'email', 'interview', 'discussion', 'email', 'interview',
    'discussion', 'repeat', 'email', 'discussion', 'interview', 'email', 'discussion', 'interview'];
  let previousDomain = due.at(-1)?.domain;
  let turn = cards.filter(card => has(state.cards, card.id)).length;
  while (fresh.length < quota && candidates.length) {
    const preferred = pattern[turn++ % pattern.length];
    let index = candidates.findIndex(card => card.module === preferred && card.domain !== previousDomain);
    if (index < 0) index = candidates.findIndex(card => card.module === preferred);
    if (index < 0) index = candidates.findIndex(card => card.domain !== previousDomain);
    if (index < 0) index = 0;
    const [card] = candidates.splice(index, 1);
    fresh.push(card); previousDomain = card.domain;
  }
  const limit = options.limit ?? (due.length + fresh.length);
  if (!Number.isInteger(limit) || limit < 0) throw new TypeError('Invalid queue limit');
  return [...due, ...fresh].slice(0, limit);
}

export function recordReview(state, cardId, rating, now = Date.now(), options = {}) {
  timestamp(now);
  if (typeof cardId !== 'string' || !cardId.trim() || UNSAFE.has(cardId)) throw new TypeError('Invalid card id');
  if (!RATINGS.includes(rating)) throw new TypeError('Unsupported rating');
  const next = clone(state);
  const key = dayKey(now);
  const day = ensureDay(next, key);
  const existing = has(next.cards, cardId);
  const record = existing ? next.cards[cardId] : {
    introducedAt: now, lastReviewedAt: now, dueAt: now, intervalDays: 0,
    streak: 0, correctDates: [], weak: false, lastRating: rating,
  };
  if (existing) addUnique(day.reviewIds, cardId); else addUnique(day.newIds, cardId);
  day.attempts += 1;
  record.lastReviewedAt = now;
  record.lastRating = rating;
  if (rating === 'again') {
    record.streak = 0; record.weak = true; record.intervalDays = 10 / 1440; record.dueAt = now + 600000;
  } else if (rating === 'hard') {
    record.streak = 0; record.weak = true; record.intervalDays = 1; record.dueAt = now + DAY;
  } else {
    record.streak += 1; record.weak = false;
    record.intervalDays = [1, 3, 7, 14, 30][Math.min(record.streak - 1, 4)];
    record.dueAt = now + record.intervalDays * DAY;
    addUnique(record.correctDates, key);
    day.correct += 1;
    if (options.transfer === true) record.transferAt = now;
  }
  next.cards[cardId] = record;
  return next;
}

export function progressCounts(state, cards, now = Date.now()) {
  timestamp(now);
  const knownIds = new Set(cards.map(card => card.id));
  const known = cards.filter(card => has(state.cards, card.id));
  const records = known.map(card => state.cards[card.id]);
  const key = dayKey(now);
  const today = state.days[key] ?? emptyDay();
  const modules = Object.fromEntries(MODULES.map(module => [module, {
    learned: known.filter(card => card.module === module).length,
    total: cards.filter(card => card.module === module).length,
  }]));
  const week = Array.from({ length: 7 }, (_, index) => {
    const date = dayKey(Date.parse(`${key}T04:00:00Z`) - (6 - index) * DAY);
    const day = state.days[date] ?? emptyDay();
    return { date, seconds: day.seconds, completed: day.completed };
  });
  return {
    learned: records.length,
    weak: records.filter(record => record.weak).length,
    stable: records.filter(record => record.streak >= 2 && new Set(record.correctDates).size >= 2).length,
    transfer: records.filter(record => Number.isFinite(record.transferAt)).length,
    due: records.filter(record => record.dueAt <= now).length,
    today: { seconds: today.seconds, newCards: today.newIds.filter(id => knownIds.has(id)).length,
      reviewed: today.reviewIds.filter(id => knownIds.has(id)).length, attempts: today.attempts,
      correct: today.correct, accuracy: today.attempts ? Math.round(today.correct / today.attempts * 100) : 0, completed: today.completed },
    modules, week,
  };
}

export function addStudySeconds(state, seconds, now = Date.now()) {
  timestamp(now);
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) throw new TypeError('Invalid study seconds');
  const next = clone(state);
  const day = ensureDay(next, dayKey(now));
  day.seconds = Math.min(86400, day.seconds + Math.min(seconds, 5));
  return next;
}

export function makeCloze(card) {
  const answer = String(card.phrase ?? '');
  const example = String(card.example ?? '');
  const index = answer ? example.toLowerCase().indexOf(answer.toLowerCase()) : -1;
  return index < 0 ? { before: '', after: '', answer }
    : { before: example.slice(0, index), after: example.slice(index + answer.length), answer };
}

export function normalizeAnswer(text) {
  return String(text ?? '').normalize('NFKC').toLowerCase().replace(/[’‘ʼ`]/g, "'")
    .trim().replace(/\s+/g, ' ').replace(/[.!?,;:。！？、，；：…]+$/u, '').trim();
}

function invalid(message) { throw new TypeError(`Invalid backup: ${message}`); }
function plain(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) invalid(label);
}
function safeTree(value, seen = new Set(), depth = 0) {
  if (depth > 30) invalid('nested data');
  if (value === null || ['string', 'boolean', 'number'].includes(typeof value)) return;
  if (typeof value !== 'object' || seen.has(value)) invalid('non-JSON data');
  seen.add(value);
  if (!Array.isArray(value)) plain(value, 'non-plain object');
  for (const key of Object.keys(value)) {
    if (UNSAFE.has(key)) invalid('unsafe property');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.get || descriptor.set) invalid('accessor property');
    safeTree(value[key], seen, depth + 1);
  }
  seen.delete(value);
}
function fields(object, allowed, label) {
  plain(object, label);
  if (Object.keys(object).some(key => !allowed.includes(key))) invalid(`${label} fields`);
}
function number(value, min, max, label, integer = false) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) invalid(label);
  return value;
}
function time(value, label) { return number(value, Date.UTC(2000, 0, 1), Date.UTC(2100, 0, 1), label); }
function date(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) invalid('date format');
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value
    || value < '2000-01-01' || value > '2100-01-01') invalid('date value');
  return value;
}
function boolean(value, label) { if (typeof value !== 'boolean') invalid(label); return value; }
function idList(value, known, label) {
  if (!Array.isArray(value) || value.some(id => typeof id !== 'string' || !known.has(id)) || new Set(value).size !== value.length) invalid(label);
  return [...value];
}

export function validateImport(data, knownIdsArray) {
  safeTree(data);
  plain(data, 'state');
  let source = data;
  if (has(data, 'app')) {
    fields(data, ['app', 'version', 'state', 'exportedAt'], 'envelope');
    if (data.app !== 'toefl-card-studio' || data.version !== 1) invalid('app or version');
    if (has(data, 'exportedAt')) {
      if (typeof data.exportedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(data.exportedAt)) invalid('export timestamp format');
      const exportedAt = time(Date.parse(data.exportedAt), 'export timestamp');
      if (new Date(exportedAt).toISOString() !== data.exportedAt) invalid('export timestamp value');
    }
    source = data.state;
  }
  fields(source, ['version', 'settings', 'cards', 'days', 'session'], 'state');
  if (source.version !== 1) invalid('version');
  fields(source.settings, ['dailyMinutes', 'newLimit', 'planVersion'], 'settings');
  if (has(source.settings, 'planVersion') && ![2, 3].includes(source.settings.planVersion)) invalid('plan version');
  if (![20, 30].includes(source.settings.dailyMinutes)) invalid('daily minutes');
  number(source.settings.newLimit, 0, 16, 'new limit', true);
  const known = new Set(knownIdsArray);
  const result = createState();
  // Upgrade the former default once; later manual choices keep their own quota.
  const previousPlan = source.settings.planVersion ?? 1;
  const upgradeDefault = (previousPlan === 1 && source.settings.newLimit === 4)
    || (previousPlan === 2 && source.settings.newLimit === 12);
  result.settings = { dailyMinutes: upgradeDefault ? 30 : source.settings.dailyMinutes,
    newLimit: upgradeDefault ? 16 : source.settings.newLimit, planVersion: 3 };
  plain(source.cards, 'cards');
  for (const [id, record] of Object.entries(source.cards)) {
    if (!known.has(id)) invalid('unknown card');
    fields(record, ['introducedAt', 'lastReviewedAt', 'dueAt', 'intervalDays', 'streak', 'correctDates', 'weak', 'lastRating', 'transferAt'], 'card');
    const introducedAt = time(record.introducedAt, 'introduced time');
    const lastReviewedAt = time(record.lastReviewedAt, 'review time');
    const dueAt = time(record.dueAt, 'due time');
    if (lastReviewedAt < introducedAt || dueAt < lastReviewedAt) invalid('timestamp order');
    const intervalDays = number(record.intervalDays, 0, 30, 'interval');
    const streak = number(record.streak, 0, 1000000, 'streak', true);
    if (!Array.isArray(record.correctDates) || record.correctDates.length > 36600) invalid('correct dates');
    const correctDates = record.correctDates.map(date);
    if (new Set(correctDates).size !== correctDates.length) invalid('duplicate correct dates');
    if (correctDates.some(value => value < dayKey(introducedAt) || value > dayKey(lastReviewedAt))) invalid('correct date order');
    if (!RATINGS.includes(record.lastRating)) invalid('rating');
    result.cards[id] = { introducedAt, lastReviewedAt, dueAt, intervalDays, streak, correctDates,
      weak: boolean(record.weak, 'weak flag'), lastRating: record.lastRating };
    if (has(record, 'transferAt')) {
      const transferAt = time(record.transferAt, 'transfer time');
      if (transferAt < introducedAt || transferAt > lastReviewedAt) invalid('transfer timestamp order');
      result.cards[id].transferAt = transferAt;
    }
  }
  plain(source.days, 'days');
  for (const [key, day] of Object.entries(source.days)) {
    date(key);
    fields(day, ['seconds', 'newIds', 'reviewIds', 'attempts', 'correct', 'completed'], 'day');
    const seconds = number(day.seconds, 0, 86400, 'seconds');
    const attempts = number(day.attempts, 0, 1000000, 'attempts', true);
    const correct = number(day.correct, 0, attempts, 'correct count', true);
    result.days[key] = { seconds, newIds: idList(day.newIds, known, 'new ids'), reviewIds: idList(day.reviewIds, known, 'review ids'),
      attempts, correct, completed: boolean(day.completed, 'completed flag') };
  }
  return result;
}
