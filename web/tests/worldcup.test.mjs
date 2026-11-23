import assert from 'node:assert/strict';
import test from 'node:test';
import { pickCandidates, startCup, pick, currentPair, progressLabel, CUP_MIN } from '../src/worldcup.ts';

const n = (i, extra = {}) => ({ id: `n${i}`, title: `공지 ${i}`, board: '게시판', deadline: null, saved: false, ...extra });
const list = (count, from = 0) => Array.from({ length: count }, (_, i) => n(from + i));

test('fewer than 8 candidates hides the game, 8 to 15 make an 8-cup, 16 or more a 16-cup', () => {
  assert.equal(CUP_MIN, 8);
  assert.deepEqual(pickCandidates([], list(7)), []);
  assert.equal(pickCandidates([], list(8)).length, 8);
  assert.equal(pickCandidates([], list(15)).length, 8);
  assert.equal(pickCandidates([], list(16)).length, 16);
  assert.equal(pickCandidates([], list(40)).length, 16);
});
test('saved notices come first, duplicates count once, passed deadlines are dropped', () => {
  const now = Date.parse('2026-11-23T00:00:00+09:00');
  const saved = [n(100, { saved: true }), n(101, { saved: true, deadline: '2026-11-01T00:00:00+09:00' })];
  const recent = [n(100), ...list(9)];
  const picked = pickCandidates(saved, recent, now);
  assert.equal(picked[0].id, 'n100');
  assert.ok(!picked.some((item) => item.id === 'n101'));
  assert.equal(new Set(picked.map((item) => item.id)).size, picked.length);
  assert.equal(picked.length, 8);
});
test('a tournament plays 7 matches for 8 notices, labels progress, and ends with the picked champion', () => {
  let cup = startCup(list(8), () => 0.5);
  const labels = [];
  let plays = 0;
  while (!cup.champion) {
    labels.push(progressLabel(cup));
    const pair = currentPair(cup);
    assert.equal(pair.length, 2);
    assert.notEqual(pair[0].id, pair[1].id);
    cup = pick(cup, 0); plays += 1;
  }
  assert.equal(plays, 7);
  assert.deepEqual(labels, ['8강 1/4', '8강 2/4', '8강 3/4', '8강 4/4', '4강 1/2', '4강 2/2', '결승 1/1']);
  assert.equal(currentPair(cup), null);
});
test('choosing the second card advances that notice, 16 notices take 15 matches', () => {
  let cup = startCup(list(16), () => 0.9);
  const first = currentPair(cup);
  cup = pick(cup, 1);
  assert.equal(cup.winners[0].id, first[1].id);
  let plays = 1;
  while (!cup.champion) { cup = pick(cup, 1); plays += 1; }
  assert.equal(plays, 15);
});
