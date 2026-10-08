import test from 'node:test';
import assert from 'node:assert/strict';
import { chaptersByClass, chapterChoices, matchChapter, studentForDoubt, UNTAGGED } from '../utils/doubtTagging.js';

const row = (class_id, chapter_name, in_window) => ({ class_id, chapter_name, in_window });

test('a class with dated chapters offers only the current ones', () => {
  const byClass = chaptersByClass([row(6, 'Whole Numbers', false), row(6, 'Fractions and Decimals', true), row(6, 'Fractions and Decimals', true)]);
  assert.deepEqual(byClass.get(6), ['Fractions and Decimals']);
});

test('a class with nothing in the current window offers its whole syllabus', () => {
  const byClass = chaptersByClass([row(7, 'Integers', false), row(7, ' Algebra ', false), row(7, null, false), row(7, '  ', true)]);
  assert.deepEqual(byClass.get(7), ['Integers', 'Algebra']); // was an empty list, so every doubt was "Untagged"
});

test('a parent with two children gets both classes\' chapters to choose from', () => {
  const byClass = chaptersByClass([row(6, 'Fractions and Decimals', true), row(8, 'Linear Equations', true), row(8, 'fractions and decimals', true)]);
  assert.deepEqual(chapterChoices(byClass), ['Fractions and Decimals', 'Linear Equations']);
  assert.deepEqual(chapterChoices(new Map()), []);
});

test('the AI reply is held to the syllabus spelling', () => {
  const choices = ['Fractions', 'Fractions and Decimals', 'Linear Equations'];
  assert.equal(matchChapter('Fractions and Decimals', choices), 'Fractions and Decimals');
  assert.equal(matchChapter(' "fractions and decimals." ', choices), 'Fractions and Decimals');
  assert.equal(matchChapter('Chapter: Linear Equations', choices), 'Linear Equations');
  assert.equal(matchChapter('The best match is Fractions and Decimals', choices), 'Fractions and Decimals');
  assert.equal(matchChapter('Fractions', choices), 'Fractions');
});

test('anything that is not one chapter from the list is Untagged', () => {
  const choices = ['Fractions and Decimals', 'Linear Equations'];
  assert.equal(matchChapter('Untagged', choices), UNTAGGED);
  assert.equal(matchChapter('Photosynthesis', choices), UNTAGGED);
  assert.equal(matchChapter('', choices), UNTAGGED);
  assert.equal(matchChapter(null, choices), UNTAGGED);
  assert.equal(matchChapter('Linear Equations or Fractions and Decimals', ['Linear Equationz', 'Fractions and Decimalz']), UNTAGGED);
  assert.equal(matchChapter('Fractions and Decimals', []), UNTAGGED);
});

test('the doubt is linked to a child only when that is certain', () => {
  const byClass = chaptersByClass([row(6, 'Fractions and Decimals', true), row(8, 'Linear Equations', true), row(8, 'Area', true), row(6, 'Area', true)]);
  const two = [{ id: 11, class_id: 6 }, { id: 12, class_id: 8 }];
  assert.equal(studentForDoubt([{ id: 11, class_id: 6 }], byClass, UNTAGGED), 11); // one child: always that child
  assert.equal(studentForDoubt(two, byClass, 'Linear Equations'), 12); // only class 8 teaches it
  assert.equal(studentForDoubt(two, byClass, 'Area'), null); // both classes teach it
  assert.equal(studentForDoubt(two, byClass, UNTAGGED), null);
  assert.equal(studentForDoubt([], byClass, 'Area'), null);
});
