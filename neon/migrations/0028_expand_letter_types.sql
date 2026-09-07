-- =============================================================================
-- 0028 — Expand Letter Types
--
-- Adds comprehensive HR letter types to letter_type_enum:
--   joining        Confirmation of Joining / Joining Letter
--   internship     Internship Offer & Engagement Letter
--   promotion      Promotion & Increment Letter
--   appraisal      Annual Salary Revision / Appraisal Letter
--   confirmation   Probation Confirmation Letter
--   warning        Formal Warning / Performance Improvement Notice
--   termination    Letter of Termination
-- =============================================================================

alter type public.letter_type_enum add value if not exists 'joining';
alter type public.letter_type_enum add value if not exists 'internship';
alter type public.letter_type_enum add value if not exists 'promotion';
alter type public.letter_type_enum add value if not exists 'appraisal';
alter type public.letter_type_enum add value if not exists 'confirmation';
alter type public.letter_type_enum add value if not exists 'warning';
alter type public.letter_type_enum add value if not exists 'termination';
