// Server-side validation. Each function returns { errors, value }:
// errors is {} when valid, otherwise { field: 'plain-language message' }.
import { QUALIFICATION_LEVELS, LANGUAGE_TESTS, LANGUAGE_TEST_TYPES, NO_TEST } from './criteria.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const NAME_RE = /^[\p{L}][\p{L} '\-.]*$/u;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const text = (v) => (typeof v === 'string' ? v.trim() : '');
export const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);

export function validateEnquiry(body = {}) {
  const errors = {};
  const value = {
    full_name: text(body.full_name),
    email: text(body.email).toLowerCase(),
    phone: text(body.phone).replace(/[\s\-()]/g, ''),
    address: text(body.address) || null,
    program_id: text(body.program_id),
    message: text(body.message) || null,
    consent: body.consent === true,
  };

  if (value.full_name.length < 2 || value.full_name.length > 100 || !NAME_RE.test(value.full_name)) {
    errors.full_name = 'Enter your full name (2 to 100 letters).';
  }
  if (!EMAIL_RE.test(value.email) || value.email.length > 254) {
    errors.email = 'Enter a valid email address.';
  }
  if (!/^\+?\d{8,15}$/.test(value.phone)) {
    errors.phone = 'Enter a valid phone number (8 to 15 digits).';
  }
  if (value.address && value.address.length > 250) {
    errors.address = 'Address must be 250 characters or fewer.';
  }
  if (!isUuid(value.program_id)) {
    errors.program_id = 'Select a program.';
  }
  if (value.message && value.message.length > 1000) {
    errors.message = 'Message must be 1,000 characters or fewer.';
  }
  if (!value.consent) {
    errors.consent = 'You need to agree before we can contact you.';
  }
  return { errors, value };
}

export function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 10 || password.length > 72) {
    return 'Password must be between 10 and 72 characters.';
  }
  return null;
}

/**
 * Qualification form. With requireAll = false (saving a draft) only the
 * format of the fields that are present is checked.
 */
export function validateQualification(body = {}, { requireAll }) {
  const errors = {};
  const blank = (v) => v === undefined || v === null || v === '';
  const value = {
    highest_qualification: text(body.highest_qualification) || null,
    institution: text(body.institution) || null,
    year_completed: blank(body.year_completed) ? null : Number(body.year_completed),
    result: text(body.result) || null,
    language_test_type: text(body.language_test_type) || null,
    language_score: blank(body.language_score) ? null : Number(body.language_score),
    test_date: text(body.test_date) || null,
    intake_id: text(body.intake_id) || null,
  };
  const thisYear = new Date().getFullYear();

  if (value.highest_qualification && !(value.highest_qualification in QUALIFICATION_LEVELS)) {
    errors.highest_qualification = 'Select a qualification from the list.';
  } else if (requireAll && !value.highest_qualification) {
    errors.highest_qualification = 'Select your highest qualification.';
  }

  if (value.institution && value.institution.length > 150) {
    errors.institution = 'Institution must be 150 characters or fewer.';
  } else if (requireAll && !value.institution) {
    errors.institution = 'Enter the institution name.';
  }

  if (value.year_completed !== null) {
    if (!Number.isInteger(value.year_completed) || value.year_completed < 1970 || value.year_completed > thisYear) {
      errors.year_completed = `Enter a year between 1970 and ${thisYear}.`;
    }
  } else if (requireAll) {
    errors.year_completed = 'Enter the year you completed it.';
  }

  if (value.result && value.result.length > 50) {
    errors.result = 'Result must be 50 characters or fewer.';
  }

  if (value.language_test_type && !LANGUAGE_TEST_TYPES.includes(value.language_test_type)) {
    errors.language_test_type = 'Select a test from the list.';
  } else if (requireAll && !value.language_test_type) {
    errors.language_test_type = 'Select a language test, or "None taken".';
  }

  const range = LANGUAGE_TESTS[value.language_test_type];
  if (value.language_test_type === NO_TEST) {
    value.language_score = null;
    value.test_date = null;
  } else if (range) {
    if (value.language_score !== null) {
      if (Number.isNaN(value.language_score) || value.language_score < range.min || value.language_score > range.max) {
        errors.language_score = `Enter a ${value.language_test_type} score between ${range.min} and ${range.max}.`;
      }
    } else if (requireAll) {
      errors.language_score = 'Enter your overall score.';
    }

    if (value.test_date) {
      const date = new Date(`${value.test_date}T00:00:00Z`);
      const twoYearsAgo = new Date();
      twoYearsAgo.setUTCFullYear(twoYearsAgo.getUTCFullYear() - 2);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value.test_date) || Number.isNaN(date.getTime())) {
        errors.test_date = 'Enter a valid date.';
      } else if (date > new Date()) {
        errors.test_date = 'Test date cannot be in the future.';
      } else if (date < twoYearsAgo) {
        errors.test_date = 'Test results must be less than 2 years old.';
      }
    } else if (requireAll) {
      errors.test_date = 'Enter the date of your test.';
    }
  }

  if (value.intake_id && !isUuid(value.intake_id)) {
    errors.intake_id = 'Select an intake.';
  } else if (requireAll && !value.intake_id) {
    errors.intake_id = 'Select your preferred intake.';
  }

  return { errors, value };
}
