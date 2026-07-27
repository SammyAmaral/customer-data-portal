/* Pure-logic tests for _map.js. Run with: npm run test:mapping (plain Node). */
import assert from 'node:assert';
import {
  businessDaysBetween, feedBucket, derivePhase, PHASES, ragValue, stripPrefix,
  sampleDatesFromChangelog, customerName, adfLines, mapFeed,
} from './_map.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log(`  ✓ ${name}`); }

console.log('_map.js');

test('businessDaysBetween skips weekends, exclusive of start', () => {
  // Mon 2026-06-01 → Mon 2026-06-08 = 5 business days after the start.
  assert.equal(businessDaysBetween('2026-06-01', '2026-06-08'), 5);
  assert.equal(businessDaysBetween('2026-06-01', '2026-06-01'), 0);
  assert.equal(businessDaysBetween('bad', '2026-06-08'), 0);
});

test('feedBucket classifies workflow statuses', () => {
  assert.equal(feedBucket('In Progress - Standard'), 'progress');
  assert.equal(feedBucket('QA Passed'), 'qa');
  assert.equal(feedBucket('Customer Feedback - Sample'), 'review');
  assert.equal(feedBucket('Done'), 'done');
  assert.equal(feedBucket('Blocked'), 'blocked');
  assert.equal(feedBucket('To Do'), 'todo');
  assert.equal(feedBucket('Rejected / Cancelled'), 'rejected');
});

test('derivePhase reflects the furthest active feed; In Production only when all done', () => {
  assert.equal(derivePhase([]), 0);
  assert.equal(derivePhase(['To Do', 'To Do']), 0);
  assert.equal(derivePhase(['To Do'], true), 1); // kickoff done nudges to Development
  assert.equal(derivePhase(['In Progress - Standard', 'To Do']), 1);
  assert.equal(derivePhase(['QA Passed', 'In Progress - Standard']), 2);
  assert.equal(derivePhase(['Customer Feedback - Sample', 'QA Passed']), 3);
  assert.equal(derivePhase(['Done', 'Customer Feedback - Sample']), 3); // not all done
  assert.equal(derivePhase(['Done', 'Done']), 4);
  assert.equal(PHASES[derivePhase(['Done', 'Done'])], 'In Production');
});

test('ragValue handles single-select, array, and string shapes', () => {
  assert.equal(ragValue({ value: 'Green' }), 'green');
  assert.equal(ragValue([{ value: 'Amber' }]), 'amber');
  assert.equal(ragValue('Red'), 'red');
  assert.equal(ragValue(null), null);
});

test('stripPrefix removes the [Customer - Month] tag', () => {
  assert.equal(stripPrefix('[Grupo Boticario - Jun 2026] - amazon.com.br (Product)'), 'amazon.com.br (Product)');
  assert.equal(stripPrefix('plain summary'), 'plain summary');
});

test('customerName prefers the Salesforce name, else parses the summary', () => {
  assert.equal(customerName({ fields: { customfield_15128: 'Grupo Boticario', summary: 'x' } }), 'Grupo Boticario');
  assert.equal(customerName({ fields: { summary: 'Netflix, Inc. - Jul 2026' } }), 'Netflix, Inc.');
});

test('sampleDatesFromChangelog picks first sample-sent and first approval', () => {
  const histories = [
    { created: '2026-06-25T10:00:00.000+0000', items: [{ field: 'status', toString: 'In Progress - Standard' }] },
    { created: '2026-07-01T10:00:00.000+0000', items: [{ field: 'status', toString: 'Customer Feedback - Sample' }] },
    { created: '2026-07-10T10:00:00.000+0000', items: [{ field: 'status', toString: 'Done' }] },
  ];
  const { firstSampleSent, sampleApproved } = sampleDatesFromChangelog(histories);
  assert.equal(firstSampleSent, '2026-07-01');
  assert.equal(sampleApproved, '2026-07-10');
  assert.deepEqual(sampleDatesFromChangelog([]), { firstSampleSent: null, sampleApproved: null });
});

test('adfLines splits ADF paragraphs into non-empty lines', () => {
  const adf = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }, { type: 'hardBreak' }, { type: 'text', text: 'b' }] }] };
  assert.deepEqual(adfLines(adf), ['a', 'b']);
});

test('mapFeed shapes a feed row with derived days-open', () => {
  const issue = { key: 'DOD-1', fields: { summary: '[X - Jun] - site.com (Product)', status: { name: 'Done' }, created: '2026-06-01T09:00:00.000+0000', resolutiondate: '2026-06-08T09:00:00.000+0000' } };
  const row = mapFeed(issue, [], '2026-07-01T00:00:00.000Z');
  assert.equal(row.name, 'site.com (Product)');
  assert.equal(row.bucket, 'done');
  assert.equal(row.daysOpen, 5); // Jun 1 → Jun 8, business days
});

console.log(`\n${passed} tests passed.`);
