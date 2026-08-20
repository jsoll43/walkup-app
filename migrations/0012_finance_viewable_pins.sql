-- Retain an encrypted copy of each Board-member PIN for authenticated admins.
-- The PBKDF2 hash remains the source used for sign-in verification.

ALTER TABLE finance_board_members
  ADD COLUMN pin_ciphertext TEXT;
