// Entry criteria check (step 4). Pure functions, no database access.

export const QUALIFICATION_LEVELS = {
  'Year 12 or equivalent': 1,
  'Certificate': 2,
  'Diploma': 3,
  "Bachelor's degree": 4,
  "Master's degree or higher": 5,
};

// Valid score range per test, and how far below the minimum still goes to a
// human instead of failing outright.
export const LANGUAGE_TESTS = {
  IELTS: { min: 0, max: 9, margin: 0.5 },
  PTE: { min: 10, max: 90, margin: 5 },
  TOEFL: { min: 0, max: 120, margin: 5 },
};
export const NO_TEST = 'None taken';
export const LANGUAGE_TEST_TYPES = [...Object.keys(LANGUAGE_TESTS), NO_TEST];

/**
 * Compare a submitted qualification with a program's criteria.
 * Returns { result: 'Pass' | 'Fail' | 'Review', reasons: string[] }.
 * Fail never closes a record by itself: staff confirm it.
 */
export function evaluateCriteria(program, q) {
  const requirements = program.language_requirements;
  if (program.min_qualification_level == null || !requirements) {
    return { result: 'Review', reasons: ['No entry criteria are configured for this program.'] };
  }

  const fails = [];
  const reviews = [];

  const level = QUALIFICATION_LEVELS[q.highest_qualification];
  if (level == null) {
    reviews.push('Highest qualification is not recognised.');
  } else if (level < program.min_qualification_level) {
    const needed = Object.keys(QUALIFICATION_LEVELS).find(
      (name) => QUALIFICATION_LEVELS[name] === program.min_qualification_level,
    );
    fails.push(`Highest qualification (${q.highest_qualification}) is below the minimum (${needed}).`);
  }

  const type = q.language_test_type;
  if (type === NO_TEST) {
    reviews.push('No language test taken.');
  } else if (requirements[type] == null) {
    reviews.push(`${type} is not an accepted test for this program.`);
  } else {
    const minimum = Number(requirements[type]);
    const score = Number(q.language_score);
    const margin = LANGUAGE_TESTS[type].margin;
    if (Number.isNaN(score)) {
      reviews.push('Language score is missing.');
    } else if (score < minimum - margin) {
      fails.push(`${type} score ${score} is below the minimum ${minimum}.`);
    } else if (score < minimum) {
      reviews.push(`${type} score ${score} is just below the minimum ${minimum}.`);
    }
  }

  if (fails.length) return { result: 'Fail', reasons: [...fails, ...reviews] };
  if (reviews.length) return { result: 'Review', reasons: reviews };
  return { result: 'Pass', reasons: ['All entry criteria met.'] };
}
