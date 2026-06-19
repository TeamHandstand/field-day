// Admins allowed to delete an entire event. Deleting an event is destructive and
// irreversible, so it's gated to these accounts both in the UI and on the API.
export const EVENT_DELETE_ALLOWED_EMAILS = [
  "sam@handstandwith.us",
  "kaitlin@handstandwith.us",
];

export function canDeleteEvent(email: string | undefined | null): boolean {
  if (!email) return false;
  return EVENT_DELETE_ALLOWED_EMAILS.includes(email.trim().toLowerCase());
}

// Admins allowed to reset *another* admin's password. This bypasses the normal
// "prove your current password" check, so it's gated to a short allowlist and
// enforced both in the UI and on the API.
export const PASSWORD_RESET_ALLOWED_EMAILS = [
  "sam@handstandwith.us",
];

// Default value used when resetting a password without specifying one. It's
// intentionally simple for quick hand-offs; admins should change it after login.
export const DEFAULT_RESET_PASSWORD = "loveya";

export function canResetAdminPasswords(email: string | undefined | null): boolean {
  if (!email) return false;
  return PASSWORD_RESET_ALLOWED_EMAILS.includes(email.trim().toLowerCase());
}
